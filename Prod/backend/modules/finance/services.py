from __future__ import annotations

import uuid
from decimal import Decimal

from django.db import models, transaction
from django.db.models import Sum
from django.utils import timezone

from modules.auditlog.services import record_action
from modules.common.commands import acquire_command, complete_command
from modules.common.errors import Conflict
from modules.identity.permissions import require_warehouse
from modules.parties.models import Party
from .models import Obligation, ObligationSide, Payment, PaymentSequence, SettlementApplication, SettlementMovement


ZERO = Decimal("0.00")


def _delta_for(side: str, amount: Decimal) -> tuple[Decimal, Decimal]:
    return (amount, ZERO) if side == ObligationSide.RECEIVABLE else (ZERO, amount)


def create_obligation(*, party, warehouse, side: str, amount: Decimal, effective_date, actor, source_document=None, source_payment=None, product=None, original_quantity=None, unit_price=None, reason="") -> Obligation:
    # Serialize new obligations for one counterparty. Without this lock two
    # opposite obligations created concurrently could both miss the other's
    # uncommitted row and skip their automatic offset.
    party = Party.objects.select_for_update().get(pk=party.pk)
    obligation = Obligation.objects.create(
        party=party,
        warehouse=warehouse,
        side=side,
        original_amount=amount,
        open_amount=amount,
        effective_date=effective_date,
        source_document=source_document,
        source_payment=source_payment,
        product=product,
        original_quantity=original_quantity,
        unit_price=unit_price,
        reason=reason,
        created_by=actor,
    )
    receivable, payable = _delta_for(side, amount)
    SettlementMovement.objects.create(party=party, warehouse=warehouse, event_type="obligation_created", receivable_delta=receivable, payable_delta=payable, obligation=obligation, document=source_document, description=reason)
    auto_offset(party=party, warehouse=warehouse)
    return obligation


def auto_offset(*, party, warehouse) -> Decimal:
    receivables = Obligation.objects.select_for_update().filter(party=party, warehouse=warehouse, side=ObligationSide.RECEIVABLE, open_amount__gt=0, reversed_at__isnull=True).order_by("effective_date", "id")
    payables = Obligation.objects.select_for_update().filter(party=party, warehouse=warehouse, side=ObligationSide.PAYABLE, open_amount__gt=0, reversed_at__isnull=True).order_by("effective_date", "id")
    left = list(receivables)
    right = list(payables)
    total = ZERO
    i = j = 0
    while i < len(left) and j < len(right):
        receivable, payable = left[i], right[j]
        amount = min(receivable.open_amount, payable.open_amount)
        if amount <= 0:
            break
        receivable.open_amount -= amount
        payable.open_amount -= amount
        receivable.save(update_fields=["open_amount"])
        payable.save(update_fields=["open_amount"])
        pair = uuid.uuid4().hex
        SettlementApplication.objects.bulk_create([
            SettlementApplication(obligation=receivable, offset_pair=pair, amount=amount),
            SettlementApplication(obligation=payable, offset_pair=pair, amount=amount),
        ])
        SettlementMovement.objects.create(party=party, warehouse=warehouse, event_type="automatic_offset", receivable_delta=-amount, payable_delta=-amount, description=f"Автоматический взаимозачёт {pair}")
        total += amount
        if receivable.open_amount == 0:
            i += 1
        if payable.open_amount == 0:
            j += 1
    return total


def _next_payment_number(warehouse, effective_date) -> str:
    sequence, _ = PaymentSequence.objects.select_for_update().get_or_create(warehouse=warehouse, year=effective_date.year)
    sequence.value += 1
    sequence.save(update_fields=["value"])
    return f"PAY-{effective_date.year}-{sequence.value:06d}"


def create_payment_locked(*, actor, warehouse, party, direction: str, method: str, amount: Decimal, effective_date, note: str = "", source_document=None, applications=None) -> Payment:
    target_side = ObligationSide.RECEIVABLE if direction == Payment.Direction.INCOMING else ObligationSide.PAYABLE
    selected = []
    if applications:
        if sum((item["amount"] for item in applications), ZERO) != amount:
            raise Conflict("Сумма распределений должна совпадать с оплатой.")
        seen = set()
        for item in applications:
            if item["obligation_id"] in seen:
                raise Conflict("Один долг нельзя указывать дважды.")
            seen.add(item["obligation_id"])
            obligation = Obligation.objects.select_for_update().filter(pk=item["obligation_id"], party=party, warehouse=warehouse, side=target_side, reversed_at__isnull=True).first()
            if not obligation or item["amount"] > obligation.open_amount:
                raise Conflict("Выбранный долг недоступен или сумма превышает его остаток.")
            selected.append((obligation, item["amount"]))
    payment = Payment.objects.create(
        number=_next_payment_number(warehouse, effective_date), direction=direction, method=method,
        party=party, warehouse=warehouse, amount=amount, effective_date=effective_date,
        note=note, source_document=source_document, created_by=actor,
    )
    remainder = amount
    if selected:
        targets = selected
    else:
        obligations = Obligation.objects.select_for_update().filter(party=party, warehouse=warehouse, side=target_side, open_amount__gt=0, reversed_at__isnull=True).order_by("effective_date", "id")
        if source_document:
            obligations = obligations.order_by(models.Case(models.When(source_document=source_document, then=0), default=1), "effective_date", "id")
        targets = ((obligation, min(remainder, obligation.open_amount)) for obligation in obligations)
    for obligation, requested in targets:
        if remainder <= 0:
            break
        applied = min(remainder, requested)
        obligation.open_amount -= applied
        obligation.save(update_fields=["open_amount"])
        SettlementApplication.objects.create(obligation=obligation, payment=payment, amount=applied)
        remainder -= applied
    if remainder > 0:
        raise Conflict("Сумма оплаты превышает открытый долг.")
    rec_delta = -amount if direction == Payment.Direction.INCOMING else ZERO
    pay_delta = -amount if direction == Payment.Direction.OUTGOING else ZERO
    SettlementMovement.objects.create(party=party, warehouse=warehouse, event_type="payment", receivable_delta=rec_delta, payable_delta=pay_delta, payment=payment, document=source_document, description=note)
    return payment


@transaction.atomic
def post_payment(*, actor, warehouse, party, direction: str, method: str, amount: Decimal, effective_date, note: str, idempotency_key: str, applications=None) -> Payment:
    require_warehouse(actor, warehouse, "can_manage_finance")
    payload = {"warehouse": warehouse.pk, "party": party.pk, "direction": direction, "method": method, "amount": amount, "effective_date": effective_date, "note": note, "applications": applications or []}
    command = acquire_command(actor=actor, operation="post_payment", key=idempotency_key, payload=payload)
    if command.replayed:
        return Payment.objects.get(pk=command.receipt.result_id)
    payment = create_payment_locked(actor=actor, warehouse=warehouse, party=party, direction=direction, method=method, amount=amount, effective_date=effective_date, note=note, applications=applications)
    record_action(actor=actor, action="payment.posted", entity=payment, warehouse_id=warehouse.pk, after={"amount": amount, "direction": direction, "party": party.pk})
    complete_command(command.receipt, result_kind="finance.payment", result_id=payment.pk, snapshot={"number": payment.number})
    return payment


@transaction.atomic
def create_manual_debt(*, actor, warehouse, party, side: str, amount: Decimal, effective_date, reason: str, idempotency_key: str) -> Obligation:
    require_warehouse(actor, warehouse, "can_manage_finance")
    payload = {"warehouse": warehouse.pk, "party": party.pk, "side": side, "amount": amount, "effective_date": effective_date, "reason": reason}
    command = acquire_command(actor=actor, operation="manual_debt", key=idempotency_key, payload=payload)
    if command.replayed:
        return Obligation.objects.get(pk=command.receipt.result_id)
    obligation = create_obligation(party=party, warehouse=warehouse, side=side, amount=amount, effective_date=effective_date, actor=actor, reason=reason)
    record_action(actor=actor, action="obligation.manual_created", entity=obligation, warehouse_id=warehouse.pk, after=payload)
    complete_command(command.receipt, result_kind="finance.obligation", result_id=obligation.pk)
    return obligation


@transaction.atomic
def void_payment(*, actor, payment, reason: str, idempotency_key: str) -> Payment:
    payment = Payment.objects.select_for_update().select_related("warehouse", "party").get(pk=payment.pk)
    require_warehouse(actor, payment.warehouse, "can_manage_finance")
    command = acquire_command(actor=actor, operation="void_payment", key=idempotency_key, payload={"payment": payment.pk, "reason": reason})
    if command.replayed:
        return Payment.objects.get(pk=command.receipt.result_id)
    if payment.status != Payment.Status.POSTED:
        raise Conflict("Оплата уже отменена.")
    applications = list(SettlementApplication.objects.select_for_update().filter(payment=payment, reversed_at__isnull=True).select_related("obligation"))
    now = timezone.now()
    advances = list(Obligation.objects.select_for_update().filter(source_payment=payment, reversed_at__isnull=True))
    if any(item.open_amount != item.original_amount for item in advances):
        raise Conflict("Нельзя отменить оплату: созданный ею аванс уже использован.")
    for application in applications:
        obligation = Obligation.objects.select_for_update().get(pk=application.obligation_id)
        if obligation.reversed_at is not None or obligation.open_amount + application.amount > obligation.original_amount:
            raise Conflict("Нельзя отменить оплату после последующих взаиморасчётов.")
        obligation.open_amount += application.amount
        obligation.save(update_fields=["open_amount"])
        application.reversed_at = now
        application.save(update_fields=["reversed_at"])
    for advance in advances:
        advance.open_amount = ZERO
        advance.reversed_at = now
        advance.save(update_fields=["open_amount", "reversed_at"])
    payment.status = Payment.Status.VOIDED
    payment.voided_by = actor
    payment.voided_at = now
    payment.note = f"{payment.note}\nОтмена: {reason}".strip()
    payment.save(update_fields=["status", "voided_by", "voided_at", "note", "updated_at"])
    SettlementMovement.objects.create(party=payment.party, warehouse=payment.warehouse, event_type="payment_voided", receivable_delta=payment.amount if payment.direction == Payment.Direction.INCOMING else ZERO, payable_delta=payment.amount if payment.direction == Payment.Direction.OUTGOING else ZERO, payment=payment, description=reason)
    record_action(actor=actor, action="payment.voided", entity=payment, warehouse_id=payment.warehouse_id, after={"reason": reason})
    complete_command(command.receipt, result_kind="finance.payment", result_id=payment.pk)
    return payment

