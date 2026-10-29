from decimal import Decimal

from django.db import transaction
from rest_framework.exceptions import ValidationError

from apps.audit.models import AuditEvent
from apps.documents.models import Document
from apps.documents.services import Command, _check_version, _mark_posted
from apps.settlements.models import Obligation, SettlementAllocation, SettlementMovement
from .models import Payment


@transaction.atomic
def post_payment(*, payment_id, actor, version, idempotency_key, requested_allocations):
    payload = {
        "payment_id": str(payment_id), "version": version,
        "allocations": sorted(
            [{"obligation": str(item["obligation"].id), "amount": str(item["amount"])} for item in requested_allocations],
            key=lambda item: item["obligation"],
        ),
    }
    cmd = Command(actor, idempotency_key, "post_payment", payload)
    if cmd.prior is not None:
        return cmd.prior

    payment = Payment.objects.select_related("document", "document__counterparty").select_for_update().get(pk=payment_id)
    document = payment.document
    _check_version(document, version)
    if document.status == Document.Status.POSTED:
        return cmd.done(_result(payment))
    if document.status != Document.Status.DRAFT:
        raise ValidationError({"detail": "Провести можно только черновик платежа."})

    expected_side = (
        Obligation.Side.RECEIVABLE if payment.direction == Payment.Direction.INCOMING
        else Obligation.Side.PAYABLE
    )
    if requested_allocations:
        ids = [item["obligation"].id for item in requested_allocations]
        if len(ids) != len(set(ids)):
            raise ValidationError({"allocations": "Обязательство нельзя указывать дважды."})
        locked = {
            item.id: item for item in Obligation.objects.select_for_update().filter(id__in=ids).order_by("id")
        }
        allocations = [(locked.get(item["obligation"].id), item["amount"]) for item in requested_allocations]
        if sum((amount for _, amount in allocations), Decimal("0.00")) != payment.amount:
            raise ValidationError({"allocations": "Сумма распределений должна совпадать с платежом."})
    else:
        open_items = list(Obligation.objects.select_for_update().filter(
            counterparty=document.counterparty, side=expected_side, open_amount__gt=0,
        ).order_by("created_at", "id"))
        left = payment.amount
        allocations = []
        for obligation in open_items:
            if left <= 0:
                break
            amount = min(left, obligation.open_amount)
            allocations.append((obligation, amount))
            left -= amount
        if left > 0:
            raise ValidationError({"amount": "Платёж превышает открытый долг; авансы в первой версии не поддерживаются."})

    for obligation, amount in allocations:
        if obligation is None or obligation.counterparty_id != document.counterparty_id or obligation.side != expected_side:
            raise ValidationError({"allocations": "Выбрано обязательство другого контрагента или направления."})
        if amount > obligation.open_amount:
            raise ValidationError({"allocations": f"Сумма превышает остаток обязательства {obligation.id}."})

    signed_factor = Decimal("-1") if payment.direction == Payment.Direction.INCOMING else Decimal("1")
    for sequence, (obligation, amount) in enumerate(allocations, start=1):
        obligation.open_amount -= amount
        obligation.save(update_fields=["open_amount"])
        SettlementAllocation.objects.create(
            source_document=document, obligation=obligation,
            kind=SettlementAllocation.Kind.PAYMENT, sequence=sequence, amount=amount,
        )
        SettlementMovement.objects.create(
            document=document, counterparty=document.counterparty,
            obligation=obligation, signed_amount=signed_factor * amount,
        )

    _mark_posted(document)
    AuditEvent.objects.create(
        actor=actor, action="payment.posted", document=document,
        payload={"direction": payment.direction, "amount": str(payment.amount)},
    )
    return cmd.done(_result(payment))


def _result(payment):
    return {
        "document_id": str(payment.document_id),
        "status": payment.document.status,
        "version": payment.document.version,
        "amount": str(payment.amount),
        "direction": payment.direction,
    }
