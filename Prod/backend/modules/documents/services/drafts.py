from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP

from django.db import transaction

from modules.auditlog.services import record_action
from modules.identity.permissions import require_warehouse
from ..models import DocumentKind, DocumentSequence, DocumentStatus, NeighborSupply, ReceiptExtraCost, TradeDocument, TradeLine


MONEY_STEP = Decimal("0.01")


def _next_number(warehouse, kind: str, effective_date) -> str:
    sequence, _ = DocumentSequence.objects.select_for_update().get_or_create(warehouse=warehouse, kind=kind, year=effective_date.year)
    sequence.value += 1
    sequence.save(update_fields=["value"])
    tags = {
        DocumentKind.OPENING: "OPN", DocumentKind.RECEIPT: "REC", DocumentKind.SALE: "SAL",
        DocumentKind.CUSTOMER_RETURN: "CRN", DocumentKind.SUPPLIER_RETURN: "SRN", DocumentKind.CUSTOMER_ORDER: "ORD",
    }
    return f"{tags[kind]}-{effective_date.year}-{sequence.value:06d}"


def _line_values(product, raw, position):
    quantity = Decimal(str(raw["quantity"]))
    price = Decimal(str(raw["unit_price"])).quantize(MONEY_STEP, rounding=ROUND_HALF_UP)
    discount = Decimal(str(raw.get("discount_amount", "0"))).quantize(MONEY_STEP, rounding=ROUND_HALF_UP)
    gross = (quantity * price).quantize(MONEY_STEP, rounding=ROUND_HALF_UP)
    if product.unit == product.Unit.PIECE and quantity != quantity.to_integral_value():
        raise ValueError("Для штучного товара количество должно быть целым.")
    if quantity <= 0 or price < 0 or discount < 0 or discount > gross:
        raise ValueError("Некорректные количество, цена или скидка.")
    return TradeLine(position=position, product=product, source_line=raw.get("source_line"), product_name=product.name, unit=product.unit, quantity=quantity, unit_price=price, discount_amount=discount, line_total=gross - discount)


def _allocate_document_discount(lines, amount):
    amount = Decimal(str(amount or "0")).quantize(MONEY_STEP, rounding=ROUND_HALF_UP)
    subtotal = sum((line.line_total for line in lines), Decimal("0.00"))
    if amount < 0 or amount > subtotal:
        raise ValueError("Скидка документа превышает сумму строк.")
    if not amount:
        return
    if subtotal == 0:
        raise ValueError("Нельзя распределить скидку по нулевой сумме.")
    allocations = []
    assigned = Decimal("0.00")
    for index, line in enumerate(lines):
        raw = amount * line.line_total / subtotal
        rounded = raw.quantize(MONEY_STEP, rounding=ROUND_DOWN)
        allocations.append([index, rounded, raw - rounded])
        assigned += rounded
    cents = int(((amount - assigned) / MONEY_STEP).to_integral_value())
    for index, _, _ in sorted(allocations, key=lambda item: (-item[2], item[0]))[:cents]:
        allocations[index][1] += MONEY_STEP
    for index, allocated, _ in allocations:
        lines[index].discount_amount += allocated
        lines[index].line_total -= allocated


def _validate_return_sources(document, created):
    expected = {
        DocumentKind.CUSTOMER_RETURN: DocumentKind.SALE,
        DocumentKind.SUPPLIER_RETURN: DocumentKind.RECEIPT,
    }.get(document.kind)
    if not expected:
        if any(line.source_line_id for line in created):
            raise ValueError("Исходная строка допустима только для возврата.")
        return
    if any(not line.source_line_id for line in created):
        raise ValueError("Каждая строка возврата должна ссылаться на исходную строку.")
    source_documents = {line.source_line.document_id for line in created}
    if len(source_documents) != 1:
        raise ValueError("Один возврат должен относиться к одному исходному документу.")
    source_document = TradeDocument.objects.get(pk=next(iter(source_documents)))
    if source_document.kind != expected or source_document.status != DocumentStatus.POSTED:
        raise ValueError("Исходный документ не проведён или имеет неверный вид.")
    for line in created:
        source = line.source_line
        if source.product_id != line.product_id:
            raise ValueError("Товар возврата не совпадает с исходной строкой.")
        previous = source.return_lines.filter(document__status=DocumentStatus.POSTED)
        returned_quantity = sum((item.quantity for item in previous), Decimal("0.000"))
        returned_amount = sum((item.line_total for item in previous), Decimal("0.00"))
        remaining_quantity = source.quantity - returned_quantity
        if line.quantity > remaining_quantity:
            raise ValueError("Количество возврата превышает остаток исходной строки.")
        remaining_amount = source.line_total - returned_amount
        amount = remaining_amount if line.quantity == remaining_quantity else (source.line_total * line.quantity / source.quantity).quantize(MONEY_STEP, rounding=ROUND_HALF_UP)
        gross = (line.quantity * source.unit_price).quantize(MONEY_STEP, rounding=ROUND_HALF_UP)
        line.unit_price = source.unit_price
        line.discount_amount = gross - amount
        line.line_total = amount
    document.source_document_id = next(iter(source_documents))
    document.save(update_fields=["source_document", "updated_at"])


def _replace_lines(document, lines, *, document_discount_amount=Decimal("0.00"), extra_costs=()):
    TradeLine.objects.filter(document=document).delete()
    created = []
    supplies = []
    for position, item in enumerate(lines, start=1):
        line = _line_values(item["product"], item, position)
        line.document = document
        created.append(line)
        supply = item.get("neighbor_supply")
        if supply:
            quantity = Decimal(str(supply["quantity"]))
            unit_price = Decimal(str(supply["unit_price"])).quantize(MONEY_STEP, rounding=ROUND_HALF_UP)
            if document.kind not in {DocumentKind.SALE, DocumentKind.CUSTOMER_ORDER}:
                raise ValueError("Товар от соседа допустим только в продаже или заказе покупателя.")
            if quantity <= 0 or quantity > line.quantity or unit_price <= 0:
                raise ValueError("Некорректные условия товара от соседа.")
            supplies.append((line, supply["supplier"], quantity, unit_price))
    _allocate_document_discount(created, document_discount_amount)
    _validate_return_sources(document, created)
    TradeLine.objects.bulk_create(created)
    NeighborSupply.objects.bulk_create([
        NeighborSupply(
            line=line,
            supplier=supplier,
            quantity=quantity,
            unit_price=unit_price,
            amount=(quantity * unit_price).quantize(MONEY_STEP, rounding=ROUND_HALF_UP),
        )
        for line, supplier, quantity, unit_price in supplies
    ])
    document.amount_total = sum((line.line_total for line in created), Decimal("0.00"))
    document.document_discount_amount = Decimal(str(document_discount_amount or "0")).quantize(MONEY_STEP, rounding=ROUND_HALF_UP)
    document.save(update_fields=["amount_total", "document_discount_amount", "updated_at"])
    ReceiptExtraCost.objects.filter(document=document).delete()
    ReceiptExtraCost.objects.bulk_create([
        ReceiptExtraCost(document=document, name=item["name"].strip(), amount=item["amount"])
        for item in extra_costs
    ])


@transaction.atomic
def create_document(*, actor, warehouse, kind, effective_date, party=None, note="", lines=(), document_discount_amount=Decimal("0.00"), extra_costs=()):
    capability = "can_sell" if kind in {DocumentKind.SALE, DocumentKind.CUSTOMER_RETURN, DocumentKind.CUSTOMER_ORDER} else "can_manage_stock"
    require_warehouse(actor, warehouse, capability)
    document = TradeDocument.objects.create(kind=kind, number=_next_number(warehouse, kind, effective_date), effective_date=effective_date, warehouse=warehouse, party=party, note=note, created_by=actor)
    _replace_lines(document, lines, document_discount_amount=document_discount_amount, extra_costs=extra_costs)
    record_action(actor=actor, action="document.created", entity=document, warehouse_id=warehouse.pk, after={"kind": kind, "number": document.number, "amount_total": document.amount_total})
    return document


@transaction.atomic
def update_document(*, actor, document, expected_version, effective_date, party=None, note="", lines=(), document_discount_amount=Decimal("0.00"), extra_costs=()):
    document = TradeDocument.objects.select_for_update().get(pk=document.pk)
    require_warehouse(actor, document.warehouse, "can_sell" if document.kind in {DocumentKind.SALE, DocumentKind.CUSTOMER_RETURN, DocumentKind.CUSTOMER_ORDER} else "can_manage_stock")
    if document.status != DocumentStatus.DRAFT:
        from modules.common.errors import Conflict
        raise Conflict("Редактировать можно только черновик.")
    if document.version != expected_version:
        from modules.common.errors import Conflict
        raise Conflict("Документ уже изменён другим пользователем. Обновите страницу.")
    before = {"version": document.version, "amount_total": document.amount_total}
    document.effective_date = effective_date
    document.party = party
    document.note = note
    document.version += 1
    document.save(update_fields=["effective_date", "party", "note", "version", "updated_at"])
    _replace_lines(document, lines, document_discount_amount=document_discount_amount, extra_costs=extra_costs)
    record_action(actor=actor, action="document.updated", entity=document, warehouse_id=document.warehouse_id, before=before, after={"version": document.version, "amount_total": document.amount_total})
    return document


@transaction.atomic
def delete_draft(*, actor, document):
    document = TradeDocument.objects.select_for_update().get(pk=document.pk)
    require_warehouse(actor, document.warehouse, "can_sell" if document.kind in {DocumentKind.SALE, DocumentKind.CUSTOMER_RETURN, DocumentKind.CUSTOMER_ORDER} else "can_manage_stock")
    if document.status != DocumentStatus.DRAFT:
        from modules.common.errors import Conflict
        raise Conflict("Удалить можно только черновик.")
    snapshot = {"number": document.number, "kind": document.kind, "amount_total": document.amount_total}
    record_action(actor=actor, action="document.draft_deleted", entity=document, warehouse_id=document.warehouse_id, before=snapshot)
    document.delete()

