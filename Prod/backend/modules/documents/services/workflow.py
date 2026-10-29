from decimal import Decimal, ROUND_DOWN

from django.db import transaction
from django.utils import timezone

from modules.auditlog.services import record_action
from modules.common.commands import acquire_command, complete_command
from modules.common.errors import Conflict
from modules.finance.models import ObligationSide, Payment
from modules.finance.services import create_obligation, create_payment_locked
from modules.identity.permissions import require_warehouse
from modules.parties.models import Party
from modules.inventory.services import issue_line, issue_supplier_return, receive_customer_return, receive_line, release_order_reservations, reserve_order_line, reverse_inbound_document, reverse_outbound_document
from ..models import DocumentKind, DocumentStatus, TradeDocument
from .drafts import create_document


INBOUND = {DocumentKind.OPENING, DocumentKind.RECEIPT, DocumentKind.CUSTOMER_RETURN}
OUTBOUND = {DocumentKind.SALE, DocumentKind.SUPPLIER_RETURN}


def _ensure_party(document, paid_amount):
    if document.kind == DocumentKind.SALE and document.party_id is None and paid_amount == document.amount_total:
        party, _ = Party.objects.get_or_create(system_key="retail", defaults={"code": "SYSTEM-RETAIL", "name": "Розничный покупатель", "kind": Party.Kind.CUSTOMER, "is_system": True})
        document.party = party
        document.save(update_fields=["party", "updated_at"])
    if document.kind != DocumentKind.OPENING and document.party_id is None:
        raise Conflict("Для этого документа обязателен контрагент.")


def _allocate_receipt_costs(document, lines):
    total_extra = sum((item.amount for item in document.extra_costs.all()), Decimal("0.00"))
    if not total_extra:
        return {line.pk: Decimal("0.00") for line in lines}
    base = sum((line.line_total for line in lines), Decimal("0.00"))
    if base <= 0:
        raise Conflict("Нельзя распределить дополнительные расходы при нулевой стоимости товаров.")
    allocations = []
    assigned = Decimal("0.00")
    for line in lines:
        raw = total_extra * line.line_total / base
        rounded = raw.quantize(Decimal("0.01"), rounding=ROUND_DOWN)
        allocations.append([line, rounded, raw - rounded])
        assigned += rounded
    cents = int(((total_extra - assigned) / Decimal("0.01")).to_integral_value())
    for line, _, _ in sorted(allocations, key=lambda item: (-item[2], item[0].position))[:cents]:
        for item in allocations:
            if item[0].pk == line.pk:
                item[1] += Decimal("0.01")
                break
    result = {}
    for line, amount, _ in allocations:
        line.allocated_extra_cost = amount
        line.save(update_fields=["allocated_extra_cost"])
        result[line.pk] = amount
    return result


def _payment_parts(*, paid_amount, payment_method, payments):
    if payments is not None:
        return list(payments)
    if paid_amount:
        return [{"method": payment_method, "amount": paid_amount}]
    return []


def _post_locked(document, actor, *, paid_amount=Decimal("0.00"), payment_method=Payment.Method.CASH, payments=None):
    if document.status != DocumentStatus.DRAFT:
        raise Conflict("Провести можно только черновик.")
    if document.kind == DocumentKind.CUSTOMER_ORDER:
        raise Conflict("Заказ нужно подтвердить, а не проводить.")
    payment_parts = _payment_parts(paid_amount=paid_amount, payment_method=payment_method, payments=payments)
    total_paid = sum((item["amount"] for item in payment_parts), Decimal("0.00"))
    _ensure_party(document, total_paid)
    lines = list(document.lines.select_related("product", "neighbor_supply__supplier"))
    if not lines:
        raise Conflict("В документе нет позиций.")
    if total_paid < 0 or total_paid > document.amount_total:
        raise Conflict("Оплата должна быть от нуля до суммы документа.")
    if total_paid and document.kind not in {DocumentKind.SALE, DocumentKind.RECEIPT}:
        raise Conflict("Связанная оплата поддерживается только для продажи и поступления.")
    if document.kind == DocumentKind.RECEIPT:
        allocated = _allocate_receipt_costs(document, lines)
        for line in lines:
            unit_cost = (line.line_total + allocated[line.pk]) / line.quantity
            receive_line(line, unit_cost=unit_cost)
    elif document.kind == DocumentKind.OPENING:
        for line in lines:
            receive_line(line)
    elif document.kind == DocumentKind.CUSTOMER_RETURN:
        for line in lines:
            receive_customer_return(line)
    elif document.kind == DocumentKind.SUPPLIER_RETURN:
        for line in lines:
            issue_supplier_return(line)
    elif document.kind == DocumentKind.SALE:
        for line in lines:
            issue_line(line)
    side_by_kind = {
        DocumentKind.SALE: ObligationSide.RECEIVABLE,
        DocumentKind.RECEIPT: ObligationSide.PAYABLE,
        DocumentKind.CUSTOMER_RETURN: ObligationSide.PAYABLE,
        DocumentKind.SUPPLIER_RETURN: ObligationSide.RECEIVABLE,
    }
    if document.amount_total > 0 and document.kind in side_by_kind:
        create_obligation(party=document.party, warehouse=document.warehouse, side=side_by_kind[document.kind], amount=document.amount_total, effective_date=document.effective_date, actor=actor, source_document=document, reason=document.get_kind_display())
    if document.kind == DocumentKind.SALE:
        for line in lines:
            supply = getattr(line, "neighbor_supply", None)
            if supply:
                create_obligation(
                    party=supply.supplier,
                    warehouse=document.warehouse,
                    side=ObligationSide.PAYABLE,
                    amount=supply.amount,
                    effective_date=document.effective_date,
                    actor=actor,
                    source_document=document,
                    product=line.product,
                    original_quantity=supply.quantity,
                    unit_price=supply.unit_price,
                    reason=f"Взяли у соседа по {document.number}: {line.product_name}",
                )
    if payment_parts:
        direction = Payment.Direction.INCOMING if document.kind == DocumentKind.SALE else Payment.Direction.OUTGOING
        for part in payment_parts:
            create_payment_locked(
                actor=actor,
                warehouse=document.warehouse,
                party=document.party,
                direction=direction,
                method=part["method"],
                amount=part["amount"],
                effective_date=document.effective_date,
                note=f"Оплата по {document.number}",
                source_document=document,
            )
    document.status = DocumentStatus.POSTED
    document.posted_by = actor
    document.posted_at = timezone.now()
    document.version += 1
    document.save(update_fields=["status", "posted_by", "posted_at", "version", "updated_at"])
    return document


@transaction.atomic
def post_document(*, actor, document, idempotency_key, paid_amount=Decimal("0.00"), payment_method=Payment.Method.CASH, payments=None):
    document = TradeDocument.objects.select_for_update(of=("self",)).select_related("warehouse", "party").get(pk=document.pk)
    require_warehouse(actor, document.warehouse, "can_sell" if document.kind in {DocumentKind.SALE, DocumentKind.CUSTOMER_RETURN} else "can_manage_stock")
    command = acquire_command(actor=actor, operation="post_document", key=idempotency_key, payload={"document": document.pk, "paid_amount": paid_amount, "payment_method": payment_method, "payments": payments or []})
    if command.replayed:
        return TradeDocument.objects.get(pk=command.receipt.result_id)
    _post_locked(document, actor, paid_amount=paid_amount, payment_method=payment_method, payments=payments)
    record_action(actor=actor, action="document.posted", entity=document, warehouse_id=document.warehouse_id, after={"status": document.status, "amount_total": document.amount_total})
    complete_command(command.receipt, result_kind="documents.tradedocument", result_id=document.pk)
    return document


@transaction.atomic
def confirm_order(*, actor, document, idempotency_key):
    document = TradeDocument.objects.select_for_update(of=("self",)).select_related("warehouse", "party").get(pk=document.pk)
    require_warehouse(actor, document.warehouse, "can_sell")
    command = acquire_command(actor=actor, operation="confirm_order", key=idempotency_key, payload={"document": document.pk})
    if command.replayed:
        return TradeDocument.objects.get(pk=command.receipt.result_id)
    if document.kind != DocumentKind.CUSTOMER_ORDER or document.status != DocumentStatus.DRAFT:
        raise Conflict("Подтвердить можно только черновик заказа.")
    _ensure_party(document, Decimal("0.00"))
    lines = list(document.lines.select_related("product"))
    if not lines:
        raise Conflict("В заказе нет позиций.")
    for line in lines:
        reserve_order_line(line)
    document.status = DocumentStatus.CONFIRMED
    document.version += 1
    document.save(update_fields=["status", "version", "updated_at"])
    record_action(actor=actor, action="order.confirmed", entity=document, warehouse_id=document.warehouse_id, after={"status": document.status})
    complete_command(command.receipt, result_kind="documents.tradedocument", result_id=document.pk)
    return document


@transaction.atomic
def set_order_assembled(*, actor, document, assembled, idempotency_key):
    document = TradeDocument.objects.select_for_update(of=("self",)).select_related("warehouse", "party").get(pk=document.pk)
    require_warehouse(actor, document.warehouse, "can_sell")
    command = acquire_command(actor=actor, operation="set_order_assembled", key=idempotency_key, payload={"document": document.pk, "assembled": assembled})
    if command.replayed:
        return TradeDocument.objects.get(pk=command.receipt.result_id)
    expected = DocumentStatus.CONFIRMED if assembled else DocumentStatus.ASSEMBLED
    if document.kind != DocumentKind.CUSTOMER_ORDER or document.status != expected:
        raise Conflict("Заказ находится на другом этапе.")
    document.status = DocumentStatus.ASSEMBLED if assembled else DocumentStatus.CONFIRMED
    document.version += 1
    document.save(update_fields=["status", "version", "updated_at"])
    record_action(actor=actor, action="order.assembled" if assembled else "order.returned_to_assembly", entity=document, warehouse_id=document.warehouse_id, after={"status": document.status})
    complete_command(command.receipt, result_kind="documents.tradedocument", result_id=document.pk)
    return document


@transaction.atomic
def fulfill_order(*, actor, document, idempotency_key):
    order = TradeDocument.objects.select_for_update(of=("self",)).select_related("warehouse", "party").get(pk=document.pk)
    require_warehouse(actor, order.warehouse, "can_sell")
    command = acquire_command(actor=actor, operation="fulfill_order", key=idempotency_key, payload={"document": order.pk})
    if command.replayed:
        return TradeDocument.objects.get(pk=command.receipt.result_id)
    if order.kind != DocumentKind.CUSTOMER_ORDER or order.status not in {DocumentStatus.CONFIRMED, DocumentStatus.ASSEMBLED}:
        raise Conflict("Выполнить можно только заказ на сборке или собранный заказ.")
    line_data = []
    for line in order.lines.select_related("product", "neighbor_supply__supplier"):
        item = {"product": line.product, "quantity": line.quantity, "unit_price": line.unit_price, "discount_amount": line.discount_amount}
        supply = getattr(line, "neighbor_supply", None)
        if supply:
            item["neighbor_supply"] = {"supplier": supply.supplier, "quantity": supply.quantity, "unit_price": supply.unit_price}
        line_data.append(item)
    release_order_reservations(order)
    sale = create_document(actor=actor, warehouse=order.warehouse, kind=DocumentKind.SALE, effective_date=timezone.localdate(), party=order.party, note=f"По заказу {order.number}", lines=line_data)
    sale.source_document = order
    sale.save(update_fields=["source_document"])
    _post_locked(sale, actor)
    order.status = DocumentStatus.FULFILLED
    order.version += 1
    order.save(update_fields=["status", "version", "updated_at"])
    record_action(actor=actor, action="order.fulfilled", entity=order, warehouse_id=order.warehouse_id, after={"sale_id": sale.pk})
    complete_command(command.receipt, result_kind="documents.tradedocument", result_id=sale.pk)
    return sale


@transaction.atomic
def cancel_document(*, actor, document, reason, idempotency_key):
    document = TradeDocument.objects.select_for_update(of=("self",)).select_related("warehouse", "party").get(pk=document.pk)
    capability = "can_sell" if document.kind in {DocumentKind.SALE, DocumentKind.CUSTOMER_RETURN, DocumentKind.CUSTOMER_ORDER} else "can_manage_stock"
    require_warehouse(actor, document.warehouse, capability)
    command = acquire_command(actor=actor, operation="cancel_document", key=idempotency_key, payload={"document": document.pk, "reason": reason})
    if command.replayed:
        return TradeDocument.objects.get(pk=command.receipt.result_id)
    if document.status in {DocumentStatus.CONFIRMED, DocumentStatus.ASSEMBLED} and document.kind == DocumentKind.CUSTOMER_ORDER:
        release_order_reservations(document)
    elif document.status == DocumentStatus.POSTED:
        obligations = list(document.obligations.select_for_update())
        if any(item.open_amount != item.original_amount for item in obligations):
            raise Conflict("Нельзя отменить документ после оплаты или взаимозачёта. Сначала отмените связанные операции.")
        if document.kind in INBOUND:
            reverse_inbound_document(document)
        elif document.kind in OUTBOUND:
            reverse_outbound_document(document)
        now = timezone.now()
        for obligation in obligations:
            obligation.open_amount = Decimal("0.00")
            obligation.reversed_at = now
            obligation.save(update_fields=["open_amount", "reversed_at"])
    elif document.status != DocumentStatus.DRAFT:
        raise Conflict("Документ в этом состоянии нельзя отменить.")
    document.status = DocumentStatus.CANCELLED
    document.cancelled_by = actor
    document.cancelled_at = timezone.now()
    document.cancellation_reason = reason
    document.version += 1
    document.save(update_fields=["status", "cancelled_by", "cancelled_at", "cancellation_reason", "version", "updated_at"])
    record_action(actor=actor, action="document.cancelled", entity=document, warehouse_id=document.warehouse_id, after={"reason": reason})
    complete_command(command.receipt, result_kind="documents.tradedocument", result_id=document.pk)
    return document

