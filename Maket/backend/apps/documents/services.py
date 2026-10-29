import hashlib
import json
from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from apps.audit.models import AuditEvent
from apps.inventory.models import (FifoAllocation, Lot, Reservation, ReturnLotAllocation,
                                   StockBalance, StockMovement, SupplierReturnLotAllocation)
from apps.partners.models import Counterparty
from apps.settlements.models import Obligation, SettlementAllocation, SettlementMovement
from config.exceptions import VersionConflict
from .calculations import allocate_money, money, unit_cost, validate_product_quantity
from .models import (BuyerReturn, CommandResult, CustomerOrder, Document, OpeningStock,
                     Receipt, ReceiptLine, Sale, SaleLine, SupplierReturn)

ZERO_QTY = Decimal("0.000")
ZERO_MONEY = Decimal("0.00")


def _tracks_inventory(product):
    """Otabek positions are a price catalogue, not an on-hand stock ledger."""
    return getattr(product, "external_size_id", None) is None


class IdempotencyConflict(APIException):
    status_code = 409
    default_code = "IDEMPOTENCY_CONFLICT"
    default_detail = "Этот ключ команды уже использован с другими данными."


class InsufficientStock(APIException):
    status_code = 409
    default_code = "INSUFFICIENT_STOCK"

    def __init__(self, *, product_id, stock, reserved, requested):
        available = stock - reserved
        super().__init__({
            "code": self.default_code,
            "product_id": str(product_id),
            "stock": str(stock),
            "reserved": str(reserved),
            "available": str(available),
            "requested": str(requested),
            "missing": str(requested - available),
        })


class DependentOperation(APIException):
    status_code = 409
    default_code = "DEPENDENT_OPERATION"
    default_detail = "Документ имеет зависимые операции и не может быть сторнирован автоматически."


# ---------- общие части команд ----------

def _payload_hash(payload: dict) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


class Command:
    """Идемпотентная команда: повтор с тем же ключом возвращает прежний результат, с другими данными — конфликт.

    cmd = Command(actor, key, "post_sale", payload)
    if cmd.prior is not None: return cmd.prior
    ...
    return cmd.done(result)
    """

    def __init__(self, actor, key, operation, payload):
        self.actor, self.key, self.operation = actor, key, operation
        self.payload_hash = _payload_hash(payload)
        prior = CommandResult.objects.select_for_update().filter(principal=actor, key=key).first()
        self.prior = None
        if prior:
            if prior.operation != operation or prior.payload_hash != self.payload_hash:
                raise IdempotencyConflict()
            self.prior = prior.result

    def done(self, result):
        CommandResult.objects.create(
            principal=self.actor, key=self.key, operation=self.operation,
            payload_hash=self.payload_hash, result=result,
        )
        return result


def _check_version(document, version):
    if document.version != version:
        raise VersionConflict()


def _mark_posted(document, posted_at=None):
    document.status = Document.Status.POSTED
    document.posted_at = posted_at or timezone.now()
    document.version += 1
    document.save(update_fields=["status", "posted_at", "version", "updated_at"])


def _lock_balances(warehouse, product_ids):
    """Остатки товаров под блокировкой (создаются при первом поступлении). Порядок блокировки постоянный."""
    balances = {}
    for product_id in sorted(set(product_ids), key=str):
        StockBalance.objects.get_or_create(
            warehouse=warehouse, product_id=product_id, defaults={"quantity": 0, "reserved": 0, "cost": 0},
        )
        balances[product_id] = StockBalance.objects.select_for_update().get(warehouse=warehouse, product_id=product_id)
    return balances


def _lock_available(warehouse, requested, own_reserved=None):
    """Остатки под блокировкой с проверкой доступного количества (остаток минус чужие резервы)."""
    own_reserved = own_reserved or {}
    balances = {}
    for product_id in sorted(requested, key=str):
        balance = StockBalance.objects.select_for_update().filter(warehouse=warehouse, product_id=product_id).first()
        stock = balance.quantity if balance else ZERO_QTY
        reserved = (balance.reserved - own_reserved.get(product_id, ZERO_QTY)) if balance else ZERO_QTY
        if balance is None or stock - reserved < requested[product_id]:
            raise InsufficientStock(product_id=product_id, stock=stock, reserved=reserved, requested=requested[product_id])
        balances[product_id] = balance
    return balances


def _add_to_balance(balance, quantity, cost):
    balance.quantity += quantity
    balance.cost = money(balance.cost + cost)
    if balance.quantity == 0:
        balance.cost = ZERO_MONEY
    balance.save(update_fields=["quantity", "cost", "updated_at"])


def _requested(lines):
    totals = {}
    for line in lines:
        totals[line.product_id] = totals.get(line.product_id, ZERO_QTY) + line.quantity
    return totals


def _take_from_lots(lots, quantity):
    """Списание из партий по порядку: [(партия, количество, себестоимость)] и непокрытый остаток."""
    left = quantity
    taken_list = []
    for lot in lots:
        if left <= 0:
            break
        taken = min(left, lot.remaining_quantity)
        cost = lot.remaining_cost if taken == lot.remaining_quantity else money(lot.remaining_cost * taken / lot.remaining_quantity)
        lot.remaining_quantity -= taken
        lot.remaining_cost = money(lot.remaining_cost - cost)
        lot.save(update_fields=["remaining_quantity", "remaining_cost"])
        taken_list.append((lot, taken, cost))
        left -= taken
    return taken_list, left


def _open_lots(warehouse, product):
    return list(Lot.objects.select_for_update().filter(
        warehouse=warehouse, product=product, remaining_quantity__gt=0,
    ).order_by("received_at", "created_at", "id"))


def _new_lot(document, line, quantity, cost, kind, received_at):
    lot = Lot.objects.create(
        warehouse=document.warehouse, product=line.product, source_document=document, source_line_id=line.id,
        initial_quantity=quantity, remaining_quantity=quantity, initial_cost=cost, remaining_cost=cost,
        unit_cost=unit_cost(cost / quantity), received_at=received_at,
    )
    StockMovement.objects.create(
        document=document, source_line_id=line.id, warehouse=document.warehouse,
        product=line.product, lot=lot, kind=kind, signed_quantity=quantity, signed_cost=cost,
    )
    return lot


def _new_obligation(document, side, amount):
    """Обязательство документа и движение расчётов (+ нам должны, − мы должны)."""
    obligation = Obligation.objects.create(
        counterparty=document.counterparty, source_document=document,
        side=side, original_amount=amount, open_amount=amount,
    )
    SettlementMovement.objects.create(
        document=document, counterparty=document.counterparty, obligation=obligation,
        signed_amount=amount if side == Obligation.Side.RECEIVABLE else -amount,
    )
    return obligation


def _reduce_source_obligation(document, source_document, kind, signed):
    """Возврат уменьшает долг исходного документа на сумму возврата (не больше остатка). Возвращает уменьшение."""
    def apply(amount):
        obligation = Obligation.objects.select_for_update().filter(source_document=source_document).first()
        if not obligation or obligation.open_amount <= 0 or amount <= 0:
            return ZERO_MONEY
        reduced = min(amount, obligation.open_amount)
        obligation.open_amount -= reduced
        obligation.save(update_fields=["open_amount"])
        SettlementAllocation.objects.create(
            source_document=document, obligation=obligation, kind=kind, sequence=1, amount=reduced,
        )
        SettlementMovement.objects.create(
            document=document, counterparty=document.counterparty, obligation=obligation, signed_amount=signed * reduced,
        )
        return reduced
    return apply


def _auto_offset(document, actor):
    from apps.settlements.services import apply_auto_offset
    return apply_auto_offset(counterparty=document.counterparty, trigger_document=document, actor=actor)


def _related(*documents):
    return [str(item.id) for item in documents if item]


# ---------- начальные остатки ----------

@transaction.atomic
def post_opening_stock(*, opening_id, actor, version, idempotency_key):
    cmd = Command(actor, idempotency_key, "post_opening_stock", {"opening_id": str(opening_id), "version": version})
    if cmd.prior is not None:
        return cmd.prior

    opening = OpeningStock.objects.select_related("document", "document__warehouse").select_for_update().get(pk=opening_id)
    document = opening.document
    _check_version(document, version)
    if document.status == Document.Status.POSTED:
        return cmd.done(_opening_result(opening))
    if document.status != Document.Status.DRAFT:
        raise ValidationError({"detail": "Провести можно только черновик начальных остатков."})
    lines = list(opening.lines.select_related("product").order_by("position"))
    if not lines:
        raise ValidationError({"lines": "Добавьте хотя бы одну строку."})

    balances = _lock_balances(document.warehouse, [line.product_id for line in lines])
    posted_at = timezone.now()
    total_cost = ZERO_MONEY
    for line in lines:
        try:
            line.quantity = validate_product_quantity(line.product, line.quantity)
        except DjangoValidationError as exc:
            raise ValidationError({"lines": {line.position: exc.messages}}) from exc
        line.total_cost = money(line.quantity * line.unit_cost)
        line.save(update_fields=["quantity", "total_cost"])
        _new_lot(document, line, line.quantity, line.total_cost, StockMovement.Kind.OPENING, posted_at)
        _add_to_balance(balances[line.product_id], line.quantity, line.total_cost)
        total_cost += line.total_cost

    _mark_posted(document, posted_at)
    AuditEvent.objects.create(
        actor=actor, action="opening_stock.posted", document=document,
        payload={"cost": str(money(total_cost))},
    )
    return cmd.done(_opening_result(opening, money(total_cost)))


def _opening_result(opening, total_cost=None):
    if total_cost is None:
        total_cost = money(sum((line.total_cost for line in opening.lines.all()), ZERO_MONEY))
    return {
        "document_id": str(opening.document_id), "status": opening.document.status,
        "version": opening.document.version, "totals": {"cost": str(total_cost)},
    }


# ---------- возврат покупателя ----------

@transaction.atomic
def post_buyer_return(*, return_id, actor, version, idempotency_key, apply_offset=True):
    cmd = Command(actor, idempotency_key, "post_buyer_return", {"return_id": str(return_id), "version": version})
    if cmd.prior is not None:
        return cmd.prior

    buyer_return = BuyerReturn.objects.select_related(
        "document", "document__warehouse", "document__counterparty", "source_sale__document",
    ).select_for_update().get(pk=return_id)
    document = buyer_return.document
    _check_version(document, version)
    if document.status == Document.Status.POSTED:
        return cmd.done(_buyer_return_result(buyer_return))
    if document.status != Document.Status.DRAFT:
        raise ValidationError({"detail": "Провести можно только черновик возврата."})
    if buyer_return.source_sale.document.status != Document.Status.POSTED:
        raise ValidationError({"source_sale": "Исходная продажа больше не доступна для возврата."})

    return_lines = list(buyer_return.lines.select_related("source_line", "product").order_by("position"))
    locked_sources = {
        item.id: item for item in SaleLine.objects.select_for_update().filter(
            id__in={line.source_line_id for line in return_lines},
        ).order_by("id")
    }
    balances = _lock_balances(document.warehouse, [line.product_id for line in return_lines])

    total_amount = ZERO_MONEY
    total_cost = ZERO_MONEY
    for return_line in return_lines:
        source = locked_sources[return_line.source_line_id]
        previous = source.return_lines.filter(
            buyer_return__document__status=Document.Status.POSTED,
        ).aggregate(quantity=Sum("quantity"), amount=Sum("amount"))
        previous_quantity = previous["quantity"] or ZERO_QTY
        previous_amount = previous["amount"] or ZERO_MONEY
        remaining_quantity = source.quantity - previous_quantity
        if return_line.quantity > remaining_quantity:
            raise ValidationError({
                "lines": {return_line.position: f"Можно вернуть не более {remaining_quantity}."},
            })
        if return_line.quantity == remaining_quantity:
            return_line.amount = money(source.amount - previous_amount)
        else:
            return_line.amount = money(source.amount * return_line.quantity / source.quantity)

        # товар возвращается в те партии, из которых был списан, начиная с последнего списания
        quantity_left = return_line.quantity
        restored_cost = ZERO_MONEY
        original_allocations = list(FifoAllocation.objects.select_related("lot").select_for_update().filter(
            sale_line=source,
        ).order_by("-ordinal"))
        ordinal = 1
        for original in original_allocations:
            if quantity_left <= 0:
                break
            returned = original.return_allocations.filter(
                return_line__buyer_return__document__status=Document.Status.POSTED,
            ).aggregate(quantity=Sum("quantity"), cost=Sum("cost"))
            returned_quantity = returned["quantity"] or ZERO_QTY
            returned_cost = returned["cost"] or ZERO_MONEY
            available_quantity = original.quantity - returned_quantity
            if available_quantity <= 0:
                continue
            taken = min(quantity_left, available_quantity)
            if taken == available_quantity:
                allocated_cost = money(original.cost - returned_cost)
            else:
                allocated_cost = money(original.cost * taken / original.quantity)
            lot = Lot.objects.select_for_update().get(pk=original.lot_id)
            ReturnLotAllocation.objects.create(
                return_line=return_line, original_allocation=original,
                ordinal=ordinal, quantity=taken, cost=allocated_cost,
            )
            lot.remaining_quantity += taken
            lot.remaining_cost = money(lot.remaining_cost + allocated_cost)
            lot.save(update_fields=["remaining_quantity", "remaining_cost"])
            StockMovement.objects.create(
                document=document, source_line_id=return_line.id,
                warehouse=document.warehouse, product=return_line.product,
                lot=lot, kind=StockMovement.Kind.BUYER_RETURN,
                signed_quantity=taken, signed_cost=allocated_cost,
            )
            restored_cost += allocated_cost
            quantity_left -= taken
            ordinal += 1
        if quantity_left > 0:
            raise ValidationError({"lines": {return_line.position: "Не найдены исходные FIFO-списания."}})
        return_line.cost = money(restored_cost)
        return_line.save(update_fields=["amount", "cost"])
        _add_to_balance(balances[return_line.product_id], return_line.quantity, return_line.cost)
        total_amount += return_line.amount
        total_cost += return_line.cost

    total_amount = money(total_amount)
    reduced = _reduce_source_obligation(
        document, buyer_return.source_sale.document, SettlementAllocation.Kind.BUYER_RETURN, Decimal("-1"),
    )(total_amount)
    refund_due = money(total_amount - reduced)
    if refund_due > 0:
        _new_obligation(document, Obligation.Side.PAYABLE, refund_due)

    _mark_posted(document)
    offset = _auto_offset(document, actor) if apply_offset else None
    AuditEvent.objects.create(
        actor=actor, action="buyer_return.posted", document=document,
        payload={"amount": str(total_amount), "cost": str(money(total_cost)), "refund_due": str(refund_due)},
    )
    result = _buyer_return_result(buyer_return, total_amount, money(total_cost), refund_due)
    result["related_documents"] = _related(offset)
    return cmd.done(result)


def _buyer_return_result(buyer_return, amount=None, cost=None, refund_due=None):
    if amount is None:
        amount = money(sum((line.amount for line in buyer_return.lines.all()), ZERO_MONEY))
    if cost is None:
        cost = money(sum((line.cost for line in buyer_return.lines.all()), ZERO_MONEY))
    if refund_due is None:
        refund_due = Obligation.objects.filter(
            source_document=buyer_return.document, side=Obligation.Side.PAYABLE,
        ).values_list("original_amount", flat=True).first() or ZERO_MONEY
    return {
        "document_id": str(buyer_return.document_id), "status": buyer_return.document.status,
        "version": buyer_return.document.version,
        "totals": {"amount": str(amount), "cost": str(cost), "refund_due": str(refund_due)},
    }


# ---------- сторно ----------

@transaction.atomic
def reverse_document(*, document_id, actor, version, reason, idempotency_key):
    cmd = Command(actor, idempotency_key, "reverse_document", {"document_id": str(document_id), "version": version, "reason": reason})
    if cmd.prior is not None:
        return cmd.prior

    document = Document.objects.select_for_update().select_related("warehouse", "counterparty").get(pk=document_id)
    _check_version(document, version)
    if document.status == Document.Status.REVERSED and hasattr(document, "reversal"):
        return cmd.done({"document_id": str(document.id), "status": document.status, "reversal_id": str(document.reversal.id)})
    if document.status != Document.Status.POSTED:
        raise ValidationError({"detail": "Сторнировать можно только проведённый документ."})
    if document.type not in [Document.Type.OPENING_STOCK, Document.Type.RECEIPT, Document.Type.SALE]:
        raise DependentOperation("Для этого типа документа автоматическое сторно ещё не допускается.")

    movements = list(document.stock_movements.select_related("lot", "product").select_for_update().order_by("created_at", "id"))
    if not movements:
        raise DependentOperation("У документа отсутствуют складские движения.")
    if document.type in [Document.Type.OPENING_STOCK, Document.Type.RECEIPT]:
        for movement in movements:
            lot = Lot.objects.select_for_update().get(pk=movement.lot_id)
            if lot.remaining_quantity != lot.initial_quantity or lot.remaining_cost != lot.initial_cost:
                raise DependentOperation("Товар из поступления уже использован; сначала отмените зависимые операции.")
    if document.type == Document.Type.SALE:
        if getattr(document, "sale", None) and document.sale.buyer_returns.filter(
            document__status=Document.Status.POSTED,
        ).exists():
            raise DependentOperation("По продаже уже есть возврат покупателя.")

    obligation = Obligation.objects.select_for_update().filter(source_document=document).first()
    if obligation and obligation.open_amount != obligation.original_amount:
        raise DependentOperation("Долг документа уже погашен, зачтён или возвращён.")

    reversal = Document.objects.create(
        type=document.type, number=f"REV-{document.number}", status=Document.Status.POSTED, version=2,
        warehouse=document.warehouse, counterparty=document.counterparty, author=actor,
        posted_at=timezone.now(), reversal_of=document, reason=reason,
    )
    balance_keys = sorted({(movement.warehouse_id, movement.product_id) for movement in movements}, key=lambda item: (str(item[0]), str(item[1])))
    balances = {
        key: StockBalance.objects.select_for_update().get(warehouse_id=key[0], product_id=key[1])
        for key in balance_keys
    }
    for movement in movements:
        lot = Lot.objects.select_for_update().get(pk=movement.lot_id)
        inverse_quantity = -movement.signed_quantity
        inverse_cost = -movement.signed_cost
        lot.remaining_quantity += inverse_quantity
        lot.remaining_cost = money(lot.remaining_cost + inverse_cost)
        if lot.remaining_quantity == 0:
            lot.remaining_cost = ZERO_MONEY
        if lot.remaining_quantity < 0 or lot.remaining_cost < 0:
            raise DependentOperation("Сторно привело бы к отрицательному остатку партии.")
        lot.save(update_fields=["remaining_quantity", "remaining_cost"])
        StockMovement.objects.create(
            document=reversal, source_line_id=movement.source_line_id,
            warehouse=movement.warehouse, product=movement.product, lot=lot,
            kind=StockMovement.Kind.REVERSAL,
            signed_quantity=inverse_quantity, signed_cost=inverse_cost,
            reversal_of=movement,
        )
        balance = balances[(movement.warehouse_id, movement.product_id)]
        if balance.quantity + inverse_quantity < 0 or balance.cost + inverse_cost < 0:
            raise DependentOperation("Сторно привело бы к отрицательному складскому остатку.")
        _add_to_balance(balance, inverse_quantity, inverse_cost)

    if obligation:
        signed = -obligation.open_amount if obligation.side == Obligation.Side.RECEIVABLE else obligation.open_amount
        amount = obligation.open_amount
        obligation.open_amount = ZERO_MONEY
        obligation.save(update_fields=["open_amount"])
        SettlementAllocation.objects.create(
            source_document=reversal, obligation=obligation,
            kind=SettlementAllocation.Kind.REVERSAL, sequence=1, amount=amount,
        )
        SettlementMovement.objects.create(
            document=reversal, counterparty=obligation.counterparty,
            obligation=obligation, signed_amount=signed,
        )

    document.status = Document.Status.REVERSED
    document.reversed_at = timezone.now()
    document.version += 1
    document.save(update_fields=["status", "reversed_at", "version", "updated_at"])
    AuditEvent.objects.create(
        actor=actor, action="document.reversed", document=document, reason=reason,
        payload={"reversal_id": str(reversal.id)},
    )
    return cmd.done({"document_id": str(document.id), "status": document.status, "reversal_id": str(reversal.id)})


# ---------- поступление ----------

def calculate_receipt(receipt: Receipt) -> dict:
    lines = list(receipt.lines.select_related("product").order_by("position"))
    if not lines:
        raise ValidationError({"lines": "Добавьте хотя бы одну строку."})

    goods_amounts = []
    for line in lines:
        try:
            normalized_quantity = validate_product_quantity(line.product, line.quantity)
        except DjangoValidationError as exc:
            raise ValidationError({"lines": {line.position: exc.messages}}) from exc
        if line.price < 0:
            raise ValidationError({"lines": {line.position: "Цена не может быть отрицательной."}})
        line.quantity = normalized_quantity
        line.goods_amount = money(normalized_quantity * line.price)
        goods_amounts.append(line.goods_amount)

    extra_total = money(sum((cost.amount for cost in receipt.extra_costs.all()), ZERO_MONEY))
    try:
        allocations = allocate_money(extra_total, goods_amounts)
    except DjangoValidationError as exc:
        raise ValidationError({"extra_costs": exc.messages}) from exc

    rows = []
    for line, allocated in zip(lines, allocations, strict=True):
        line.allocated_extra_cost = allocated
        line.total_cost = money(line.goods_amount + allocated)
        rows.append({
            "line_id": str(line.id),
            "position": line.position,
            "goods_amount": str(line.goods_amount),
            "allocated_extra_cost": str(line.allocated_extra_cost),
            "total_cost": str(line.total_cost),
        })
    return {
        "goods_total": str(money(sum(goods_amounts, ZERO_MONEY))),
        "extra_cost_total": str(extra_total),
        "inventory_cost_total": str(money(sum((line.total_cost for line in lines), ZERO_MONEY))),
        "lines": rows,
        "_line_objects": lines,
    }


def _apply_receipt_prices(line):
    """Цены, введённые при приходе, становятся текущими ценами товара (закупочная, оптовая, розничная)."""
    product = line.product
    fields = ["purchase_price"]
    product.purchase_price = line.price
    if line.wholesale_price is not None:
        product.wholesale_price = line.wholesale_price
        fields.append("wholesale_price")
    if line.retail_price is not None:
        product.retail_price = line.retail_price
        fields.append("retail_price")
    product.save(update_fields=fields + ["updated_at"])


@transaction.atomic
def post_receipt(*, receipt_id, actor, version: int, idempotency_key: str, apply_offset: bool = True) -> dict:
    cmd = Command(actor, idempotency_key, "post_receipt", {"receipt_id": str(receipt_id), "version": version})
    if cmd.prior is not None:
        return cmd.prior

    receipt = Receipt.objects.select_related(
        "document", "document__warehouse", "document__counterparty"
    ).select_for_update().get(pk=receipt_id)
    document = receipt.document
    _check_version(document, version)
    if document.status == Document.Status.POSTED:
        return cmd.done(_receipt_result(receipt))
    if document.status != Document.Status.DRAFT:
        raise ValidationError({"detail": "Провести можно только черновик поступления."})
    if document.type != Document.Type.RECEIPT or not document.warehouse or not document.counterparty:
        raise ValidationError({"detail": "Поступление должно содержать склад и поставщика."})

    calculation = calculate_receipt(receipt)
    lines = calculation.pop("_line_objects")
    for line in lines:
        line.save(update_fields=["quantity", "goods_amount", "allocated_extra_cost", "total_cost"])

    balances = _lock_balances(document.warehouse, [line.product_id for line in lines])
    posted_at = timezone.now()
    for line in lines:
        _new_lot(document, line, line.quantity, line.total_cost, StockMovement.Kind.RECEIPT, posted_at)
        _add_to_balance(balances[line.product_id], line.quantity, line.total_cost)
        _apply_receipt_prices(line)

    goods_total = Decimal(calculation["goods_total"])
    if goods_total > 0:
        _new_obligation(document, Obligation.Side.PAYABLE, goods_total)

    _mark_posted(document, posted_at)
    offset = _auto_offset(document, actor) if apply_offset else None
    AuditEvent.objects.create(
        actor=actor, action="receipt.posted", document=document,
        payload={key: value for key, value in calculation.items() if key != "lines"},
    )
    result = _receipt_result(receipt, calculation)
    result["related_documents"] = _related(offset)
    return cmd.done(result)


def _receipt_result(receipt: Receipt, calculation: dict | None = None) -> dict:
    if calculation is None:
        calculation = calculate_receipt(receipt)
        calculation.pop("_line_objects", None)
    return {
        "document_id": str(receipt.document_id),
        "status": receipt.document.status,
        "version": receipt.document.version,
        "totals": {
            "goods": calculation["goods_total"],
            "extra_costs": calculation["extra_cost_total"],
            "inventory_cost": calculation["inventory_cost_total"],
        },
    }


# ---------- продажа ----------

def calculate_sale(sale: Sale) -> dict:
    lines = list(sale.lines.select_related("product").order_by("position"))
    if not lines:
        raise ValidationError({"lines": "Добавьте хотя бы одну строку."})
    rows = []
    total = ZERO_MONEY
    for line in lines:
        try:
            normalized_quantity = validate_product_quantity(line.product, line.quantity)
        except DjangoValidationError as exc:
            raise ValidationError({"lines": {line.position: exc.messages}}) from exc
        gross = money(normalized_quantity * line.price)
        discount = money(line.discount)
        if discount < 0 or discount > gross:
            raise ValidationError({"lines": {line.position: "Скидка не может превышать сумму строки."}})
        line.quantity = normalized_quantity
        line.amount = money(gross - discount)
        total += line.amount
        rows.append({
            "line_id": str(line.id), "position": line.position,
            "gross": str(gross), "discount": str(discount), "amount": str(line.amount),
        })
    return {"amount_total": str(money(total)), "lines": rows, "_line_objects": lines}


@transaction.atomic
def post_sale(*, sale_id, actor, version: int, idempotency_key: str,
              allow_retail: bool = False, apply_offset: bool = True,
              source_order: CustomerOrder | None = None) -> dict:
    cmd = Command(actor, idempotency_key, "post_sale", {
        "sale_id": str(sale_id), "version": version, "source_order": str(source_order.pk) if source_order else None,
    })
    if cmd.prior is not None:
        return cmd.prior

    sale = Sale.objects.select_related(
        "document", "document__warehouse", "document__counterparty"
    ).select_for_update().get(pk=sale_id)
    document = sale.document
    _check_version(document, version)
    if document.status == Document.Status.POSTED:
        return cmd.done(_sale_result(sale))
    if document.status != Document.Status.DRAFT:
        raise ValidationError({"detail": "Провести можно только черновик продажи."})
    if document.type != Document.Type.SALE or not document.warehouse or not document.counterparty:
        raise ValidationError({"detail": "Продажа должна содержать склад и покупателя."})
    if document.counterparty.system_key == Counterparty.RETAIL_SYSTEM_KEY and not allow_retail:
        raise ValidationError({"counterparty": "Розничную продажу необходимо провести вместе с полной оплатой."})

    calculation = calculate_sale(sale)
    lines = calculation.pop("_line_objects")
    for line in lines:
        line.save(update_fields=["quantity", "amount"])
    tracked_lines = [line for line in lines if _tracks_inventory(line.product)]
    requested = _requested(tracked_lines)

    # собственный резерв заказа не мешает его продаже
    own_reserved = {}
    active_reservations = []
    if source_order:
        if source_order.state not in CustomerOrder.ACTIVE_STATES:
            raise ValidationError({"order": "Заказ должен быть зарезервирован или собран."})
        active_reservations = list(Reservation.objects.select_for_update().filter(
            order_line__order=source_order, released_at__isnull=True,
        ).order_by("product_id", "id"))
        active_reservations = [item for item in active_reservations if _tracks_inventory(item.product)]
        for reservation in active_reservations:
            own_reserved[reservation.product_id] = own_reserved.get(reservation.product_id, ZERO_QTY) + reservation.quantity
    balances = _lock_available(document.warehouse, requested, own_reserved) if requested else {}
    if active_reservations:
        balances.update(_lock_balances(document.warehouse, [item.product_id for item in active_reservations if item.product_id not in balances]))
        released_at = timezone.now()
        for reservation in active_reservations:
            balance = balances[reservation.product_id]
            balance.reserved -= reservation.quantity
            balance.save(update_fields=["reserved", "updated_at"])
            reservation.released_at = released_at
            reservation.save(update_fields=["released_at"])

    total_cost = ZERO_MONEY
    for line in lines:
        if not _tracks_inventory(line.product):
            line.cost = ZERO_MONEY
            line.save(update_fields=["cost"])
            continue
        taken_list, left = _take_from_lots(_open_lots(document.warehouse, line.product), line.quantity)
        if left > 0:
            balance = balances[line.product_id]
            raise InsufficientStock(product_id=line.product_id, stock=balance.quantity, reserved=balance.reserved, requested=requested[line.product_id])
        for ordinal, (lot, taken, cost) in enumerate(taken_list, start=1):
            FifoAllocation.objects.create(sale_line=line, lot=lot, ordinal=ordinal, quantity=taken, cost=cost)
            StockMovement.objects.create(
                document=document, source_line_id=line.id, warehouse=document.warehouse,
                product=line.product, lot=lot, kind=StockMovement.Kind.SALE,
                signed_quantity=-taken, signed_cost=-cost,
            )
        line.cost = money(sum((cost for _, _, cost in taken_list), ZERO_MONEY))
        line.save(update_fields=["cost"])
        _add_to_balance(balances[line.product_id], -line.quantity, -line.cost)
        total_cost += line.cost

    amount_total = Decimal(calculation["amount_total"])
    if amount_total > 0:
        _new_obligation(document, Obligation.Side.RECEIVABLE, amount_total)

    _mark_posted(document)
    if source_order:
        source_order.state = CustomerOrder.State.COMPLETED
        source_order.completed_sale = sale
        source_order.save(update_fields=["state", "completed_sale"])
        _mark_posted(source_order.document, document.posted_at)
    offset = _auto_offset(document, actor) if apply_offset else None
    AuditEvent.objects.create(
        actor=actor, action="sale.posted", document=document,
        payload={"amount": str(amount_total), "cost": str(money(total_cost))},
    )
    result = _sale_result(sale, amount_total=amount_total, total_cost=money(total_cost))
    result["related_documents"] = _related(offset)
    return cmd.done(result)


def _sale_result(sale: Sale, *, amount_total=None, total_cost=None) -> dict:
    if amount_total is None:
        amount_total = money(sum((line.amount for line in sale.lines.all()), ZERO_MONEY))
    if total_cost is None:
        total_cost = money(sum((line.cost for line in sale.lines.all()), ZERO_MONEY))
    return {
        "document_id": str(sale.document_id),
        "status": sale.document.status,
        "version": sale.document.version,
        "totals": {
            "amount": str(amount_total),
            "cost": str(total_cost),
            "gross_profit": str(money(amount_total - total_cost)),
        },
    }


# ---------- заказы ----------

def _lock_order(order_id, version, *related):
    order = CustomerOrder.objects.select_related("document", *related).select_for_update().get(pk=order_id)
    _check_version(order.document, version)
    return order


def _order_done(cmd, order, actor, action):
    order.save(update_fields=["state"])
    order.document.version += 1
    order.document.save(update_fields=["version", "updated_at"])
    AuditEvent.objects.create(actor=actor, action=f"order.{action}", document=order.document)
    return cmd.done(_order_result(order))


@transaction.atomic
def reserve_order(*, order_id, actor, version, idempotency_key):
    cmd = Command(actor, idempotency_key, "reserve_order", {"order_id": str(order_id), "version": version})
    if cmd.prior is not None:
        return cmd.prior
    order = _lock_order(order_id, version, "document__warehouse")
    if order.state != CustomerOrder.State.DRAFT:
        raise ValidationError({"state": "Резервировать можно только черновик заказа."})
    lines = list(order.lines.select_related("product").order_by("position"))
    tracked_lines = [line for line in lines if _tracks_inventory(line.product)]
    balances = _lock_available(order.document.warehouse, _requested(tracked_lines)) if tracked_lines else {}
    for line in lines:
        if not _tracks_inventory(line.product):
            continue
        Reservation.objects.update_or_create(
            order_line=line,
            defaults={
                "warehouse": order.document.warehouse, "product": line.product,
                "quantity": line.quantity, "released_at": None,
            },
        )
        balance = balances[line.product_id]
        balance.reserved += line.quantity
        balance.save(update_fields=["reserved", "updated_at"])
    order.state = CustomerOrder.State.RESERVED
    return _order_done(cmd, order, actor, "reserved")


def _release_reservations(order):
    reservations = list(Reservation.objects.select_for_update().filter(
        order_line__order=order, released_at__isnull=True,
    ).order_by("product_id", "id"))
    balances = {
        product_id: StockBalance.objects.select_for_update().get(warehouse=order.document.warehouse, product_id=product_id)
        for product_id in sorted({item.product_id for item in reservations}, key=str)
    }
    released_at = timezone.now()
    for reservation in reservations:
        balance = balances[reservation.product_id]
        balance.reserved -= reservation.quantity
        balance.save(update_fields=["reserved", "updated_at"])
        reservation.released_at = released_at
        reservation.save(update_fields=["released_at"])


@transaction.atomic
def transition_order(*, order_id, actor, version, idempotency_key, action):
    cmd = Command(actor, idempotency_key, f"order_{action}", {"order_id": str(order_id), "version": version, "action": action})
    if cmd.prior is not None:
        return cmd.prior
    order = _lock_order(order_id, version)
    state = CustomerOrder.State
    if action == "assembled":
        if order.state != state.RESERVED:
            raise ValidationError({"state": "Собрать можно только зарезервированный заказ."})
        order.state = state.ASSEMBLED
    elif action == "ship":
        if order.state not in [state.RESERVED, state.ASSEMBLED]:
            raise ValidationError({"state": "Отправить можно заказ на сборке или собранный."})
        order.state = state.SHIPPED
    elif action == "unship":
        if order.state != state.SHIPPED:
            raise ValidationError({"state": "Вернуть на сборку можно только отправленный заказ."})
        order.state = state.ASSEMBLED
    elif action == "cancel" and order.state == state.DRAFT:
        order.state = state.CANCELLED  # у черновика резерва нет — просто отменяем
    elif action in ["release", "cancel"]:
        if order.state not in CustomerOrder.ACTIVE_STATES:
            raise ValidationError({"state": "У заказа нет активного резерва."})
        _release_reservations(order)
        order.state = state.DRAFT if action == "release" else state.CANCELLED
    else:
        raise ValidationError({"action": "Неизвестный переход заказа."})
    return _order_done(cmd, order, actor, action)


@transaction.atomic
def complete_order_sale(*, order_id, actor, version, idempotency_key, breakdown=None):
    breakdown = breakdown or []
    cmd = Command(actor, idempotency_key, "complete_order_sale", {
        "order_id": str(order_id), "version": version, "breakdown": _breakdown_payload(breakdown),
    })
    if cmd.prior is not None:
        return cmd.prior
    order = _lock_order(order_id, version, "document__warehouse", "document__counterparty")
    if order.state not in CustomerOrder.ACTIVE_STATES:
        raise ValidationError({"state": "Продать можно зарезервированный или собранный заказ."})
    retail = order.document.counterparty.system_key == Counterparty.RETAIL_SYSTEM_KEY
    order_total = money(sum((line.amount for line in order.lines.all()), ZERO_MONEY))
    paid = _breakdown_total(breakdown)
    if paid > order_total:
        raise ValidationError({"breakdown": "Оплата больше суммы заказа: сдача и авансы не поддерживаются."})
    if retail and paid < order_total:
        raise ValidationError({"counterparty": "Для розничного заказа требуется продажа с полной оплатой."})
    sale_document = Document.objects.create(
        type=Document.Type.SALE, warehouse=order.document.warehouse, counterparty=order.document.counterparty,
        author=actor, reason=f"Продажа по заказу {order.document.number}",
    )
    sale = Sale.objects.create(document=sale_document)
    for line in order.lines.order_by("position"):
        SaleLine.objects.create(
            sale=sale, position=line.position, product=line.product,
            product_code=line.product_code, product_name=line.product_name, unit=line.unit,
            quantity=line.quantity, price=line.price, discount=line.discount,
            amount=line.amount, cost=0,
        )
    sale_result = post_sale(
        sale_id=sale.pk, actor=actor, version=1,
        idempotency_key=f"{idempotency_key}:sale", source_order=order,
        allow_retail=retail, apply_offset=not breakdown,
    )
    paid_result = _finish_with_payment(
        document=sale_document, base_result={}, actor=actor, breakdown=breakdown,
        idempotency_key=idempotency_key, direction="incoming", reason=f"Оплата продажи по заказу {order.document.number}",
    ) if breakdown else {}
    order.refresh_from_db()
    return cmd.done({**_order_result(order), "sale": sale_result, **paid_result})


def _order_result(order):
    return {
        "document_id": str(order.document_id), "state": order.state,
        "version": order.document.version,
        "completed_sale_id": str(order.completed_sale_id) if order.completed_sale_id else None,
    }


# ---------- возврат поставщику ----------

@transaction.atomic
def post_supplier_return(*, return_id, actor, version, idempotency_key, apply_offset=True):
    cmd = Command(actor, idempotency_key, "post_supplier_return", {"return_id": str(return_id), "version": version})
    if cmd.prior is not None:
        return cmd.prior
    supplier_return = SupplierReturn.objects.select_related(
        "document", "document__warehouse", "document__counterparty", "source_receipt__document",
    ).select_for_update().get(pk=return_id)
    document = supplier_return.document
    _check_version(document, version)
    if document.status == Document.Status.POSTED:
        return cmd.done(_supplier_return_result(supplier_return))
    if document.status != Document.Status.DRAFT:
        raise ValidationError({"detail": "Провести можно только черновик возврата поставщику."})

    lines = list(supplier_return.lines.select_related("source_line", "product").order_by("position"))
    sources = {item.id: item for item in ReceiptLine.objects.select_for_update().filter(id__in={line.source_line_id for line in lines}).order_by("id")}
    previous = {}
    for line in lines:
        source = sources[line.source_line_id]
        done = source.supplier_return_lines.filter(
            supplier_return__document__status=Document.Status.POSTED,
        ).aggregate(quantity=Sum("quantity"), amount=Sum("amount"))
        previous[line.id] = (done["quantity"] or ZERO_QTY, done["amount"] or ZERO_MONEY)
        if line.quantity > source.quantity - previous[line.id][0]:
            raise ValidationError({"lines": {line.position: f"Можно вернуть не более {source.quantity - previous[line.id][0]}."}})
    requested = _requested(lines)
    balances = _lock_available(document.warehouse, requested)

    total_amount = ZERO_MONEY
    total_cost = ZERO_MONEY
    for line in lines:
        source = sources[line.source_line_id]
        previous_quantity, previous_amount = previous[line.id]
        if line.quantity == source.quantity - previous_quantity:
            line.amount = money(source.goods_amount - previous_amount)
        else:
            line.amount = money(source.goods_amount * line.quantity / source.quantity)

        # сначала из партии исходного поступления, затем по FIFO
        lots = _open_lots(document.warehouse, line.product)
        lots.sort(key=lambda lot: (lot.source_line_id != source.id, lot.received_at, lot.created_at, str(lot.id)))
        taken_list, left = _take_from_lots(lots, line.quantity)
        if left > 0:
            balance = balances[line.product_id]
            raise InsufficientStock(product_id=line.product_id, stock=balance.quantity, reserved=balance.reserved, requested=requested[line.product_id])
        for ordinal, (lot, taken, cost) in enumerate(taken_list, start=1):
            SupplierReturnLotAllocation.objects.create(return_line=line, lot=lot, ordinal=ordinal, quantity=taken, cost=cost)
            StockMovement.objects.create(
                document=document, source_line_id=line.id, warehouse=document.warehouse,
                product=line.product, lot=lot, kind=StockMovement.Kind.SUPPLIER_RETURN,
                signed_quantity=-taken, signed_cost=-cost,
            )
        line.cost = money(sum((cost for _, _, cost in taken_list), ZERO_MONEY))
        line.save(update_fields=["amount", "cost"])
        _add_to_balance(balances[line.product_id], -line.quantity, -line.cost)
        total_amount += line.amount
        total_cost += line.cost

    total_amount = money(total_amount)
    reduced = _reduce_source_obligation(
        document, supplier_return.source_receipt.document, SettlementAllocation.Kind.SUPPLIER_RETURN, Decimal("1"),
    )(total_amount)
    receivable = money(total_amount - reduced)
    if receivable > 0:
        _new_obligation(document, Obligation.Side.RECEIVABLE, receivable)
    _mark_posted(document)
    offset = _auto_offset(document, actor) if apply_offset else None
    AuditEvent.objects.create(
        actor=actor, action="supplier_return.posted", document=document,
        payload={"amount": str(total_amount), "cost": str(money(total_cost)), "receivable": str(receivable)},
    )
    result = _supplier_return_result(supplier_return, total_amount, money(total_cost), receivable)
    result["related_documents"] = _related(offset)
    return cmd.done(result)


def _supplier_return_result(supplier_return, amount=None, cost=None, receivable=None):
    if amount is None:
        amount = money(sum((line.amount for line in supplier_return.lines.all()), ZERO_MONEY))
    if cost is None:
        cost = money(sum((line.cost for line in supplier_return.lines.all()), ZERO_MONEY))
    if receivable is None:
        receivable = Obligation.objects.filter(
            source_document=supplier_return.document, side=Obligation.Side.RECEIVABLE,
        ).values_list("original_amount", flat=True).first() or ZERO_MONEY
    return {
        "document_id": str(supplier_return.document_id), "status": supplier_return.document.status,
        "version": supplier_return.document.version,
        "totals": {"amount": str(amount), "cost": str(cost), "receivable": str(receivable)},
    }


@transaction.atomic
def post_supplier_return_with_payment(*, return_id, actor, version, idempotency_key, breakdown):
    cmd = Command(actor, idempotency_key, "post_supplier_return_with_payment", {
        "return_id": str(return_id), "version": version, "breakdown": _breakdown_payload(breakdown),
    })
    if cmd.prior is not None:
        return cmd.prior
    supplier_return = SupplierReturn.objects.select_related(
        "document", "document__counterparty", "source_receipt__document",
    ).select_for_update().get(pk=return_id)
    payment_amount = _breakdown_total(breakdown)
    if payment_amount <= 0:
        raise ValidationError({"breakdown": "Сумма денежной части должна быть больше нуля."})
    return_result = post_supplier_return(
        return_id=return_id, actor=actor, version=version,
        idempotency_key=f"{idempotency_key}:return", apply_offset=False,
    )
    source_document = supplier_return.source_receipt.document
    source_obligation = Obligation.objects.select_for_update().get(source_document=source_document)
    if payment_amount > source_obligation.open_amount:
        raise ValidationError({"breakdown": "Денежная часть превышает остаток долга поставщику."})
    payment_document, payment_result = _pay_obligation(
        source_document=source_document, actor=actor, breakdown=breakdown, idempotency_key=idempotency_key,
        direction="outgoing", reason=f"Денежная часть возврата {supplier_return.document.number}", link_source=False,
    )
    offset = _auto_offset(payment_document, actor)
    return cmd.done({**return_result, "payment": payment_result, "related_documents": _related(payment_document, offset)})


# ---------- проведение с оплатой ----------

def _breakdown_total(breakdown):
    return money(sum((item["amount"] for item in breakdown), ZERO_MONEY))


def _breakdown_payload(breakdown):
    return sorted(
        [{"method": item["method"], "amount": str(item["amount"])} for item in breakdown],
        key=lambda item: item["method"],
    )


def _pay_obligation(*, source_document, actor, breakdown, idempotency_key, direction, reason, link_source=True):
    """Создать и провести платёж по обязательству документа на сумму способов оплаты."""
    from apps.payments.models import Payment, PaymentBreakdown
    from apps.payments.services import post_payment
    amount = _breakdown_total(breakdown)
    payment_document = Document.objects.create(
        type=Document.Type.PAYMENT, counterparty=source_document.counterparty, author=actor, reason=reason,
    )
    payment = Payment.objects.create(
        document=payment_document, direction=direction, amount=amount,
        source_document=source_document if link_source else None,
    )
    PaymentBreakdown.objects.bulk_create([
        PaymentBreakdown(payment=payment, method=item["method"], amount=item["amount"]) for item in breakdown
    ])
    AuditEvent.objects.create(actor=actor, action="payment.created", document=payment_document)
    obligation = Obligation.objects.select_for_update().get(source_document=source_document)
    result = post_payment(
        payment_id=payment.pk, actor=actor, version=1,
        idempotency_key=f"{idempotency_key}:payment",
        requested_allocations=[{"obligation": obligation, "amount": amount}],
    )
    return payment_document, result


def _finish_with_payment(*, document, base_result, actor, breakdown, idempotency_key, direction, reason):
    """Оплата сразу после проведения, затем автоматический взаимозачёт оставшихся встречных долгов."""
    payment_document, payment_result = (None, None)
    if breakdown:
        payment_document, payment_result = _pay_obligation(
            source_document=document, actor=actor, breakdown=breakdown,
            idempotency_key=idempotency_key, direction=direction, reason=reason,
        )
    offset = _auto_offset(document, actor)
    related = list(base_result.get("related_documents", [])) + _related(payment_document, offset)
    return {**base_result, "payment": payment_result, "related_documents": related}


@transaction.atomic
def post_sale_with_payment(*, sale_id, actor, version, idempotency_key, breakdown):
    """Проведение продажи с оплатой сразу. Оплата может быть частичной — остаток уходит в долг контрагента."""
    sale = Sale.objects.select_related("document", "document__counterparty").select_for_update().get(pk=sale_id)
    cmd = Command(actor, idempotency_key, "post_sale_with_payment", {
        "sale_id": str(sale_id), "version": version, "breakdown": _breakdown_payload(breakdown),
    })
    if cmd.prior is not None:
        return cmd.prior
    sale_amount = Decimal(calculate_sale(sale)["amount_total"])
    paid = _breakdown_total(breakdown)
    if paid > sale_amount:
        raise ValidationError({"breakdown": "Оплата больше суммы продажи: сдача и авансы не поддерживаются."})
    if paid < sale_amount and sale.document.counterparty.system_key == Counterparty.RETAIL_SYSTEM_KEY:
        raise ValidationError({"breakdown": "Розничная продажа без контрагента должна быть оплачена полностью."})
    sale_result = post_sale(
        sale_id=sale_id, actor=actor, version=version,
        idempotency_key=f"{idempotency_key}:sale", allow_retail=True, apply_offset=False,
    )
    return cmd.done(_finish_with_payment(
        document=sale.document, base_result=sale_result, actor=actor, breakdown=breakdown,
        idempotency_key=idempotency_key, direction="incoming", reason=f"Оплата продажи {sale.document.number}",
    ))


@transaction.atomic
def post_receipt_with_payment(*, receipt_id, actor, version, idempotency_key, breakdown):
    """Проведение прихода с оплатой поставщику сразу; неоплаченный остаток — наш долг."""
    receipt = Receipt.objects.select_related("document", "document__counterparty").select_for_update().get(pk=receipt_id)
    cmd = Command(actor, idempotency_key, "post_receipt_with_payment", {
        "receipt_id": str(receipt_id), "version": version, "breakdown": _breakdown_payload(breakdown),
    })
    if cmd.prior is not None:
        return cmd.prior
    goods_total = money(sum((line.quantity * line.price for line in receipt.lines.all()), ZERO_MONEY))
    if _breakdown_total(breakdown) > goods_total:
        raise ValidationError({"breakdown": "Оплата больше суммы закупки (допрасходы в расчёт с поставщиком не входят)."})
    # взаимозачёт — после оплаты, иначе он заберёт сумму, которую платим сейчас
    receipt_result = post_receipt(
        receipt_id=receipt_id, actor=actor, version=version,
        idempotency_key=f"{idempotency_key}:receipt", apply_offset=False,
    )
    return cmd.done(_finish_with_payment(
        document=receipt.document, base_result=receipt_result, actor=actor, breakdown=breakdown,
        idempotency_key=idempotency_key, direction="outgoing", reason=f"Оплата поступления {receipt.document.number}",
    ))


@transaction.atomic
def post_buyer_return_with_refund(*, return_id, actor, version, idempotency_key, breakdown):
    """Возврат покупателя и выдача денег сразу. Невыданная часть остаётся нашим долгом покупателю."""
    buyer_return = BuyerReturn.objects.select_related("document", "document__counterparty", "source_sale__document").select_for_update().get(pk=return_id)
    cmd = Command(actor, idempotency_key, "post_buyer_return_with_refund", {
        "return_id": str(return_id), "version": version, "breakdown": _breakdown_payload(breakdown),
    })
    if cmd.prior is not None:
        return cmd.prior
    # взаимозачёт — только после выдачи денег, иначе он заберёт сумму к выдаче
    return_result = post_buyer_return(
        return_id=return_id, actor=actor, version=version,
        idempotency_key=f"{idempotency_key}:return", apply_offset=False,
    )
    refund_obligation = Obligation.objects.filter(source_document=buyer_return.document).first()
    refund_due = refund_obligation.open_amount if refund_obligation else ZERO_MONEY
    paid = _breakdown_total(breakdown)
    if paid > refund_due:
        raise ValidationError({"breakdown": f"Нельзя выдать больше суммы к возврату ({refund_due})."})
    if paid < refund_due and buyer_return.document.counterparty.system_key == Counterparty.RETAIL_SYSTEM_KEY:
        raise ValidationError({"breakdown": "Продажа была без контрагента: выдайте покупателю всю сумму возврата сразу."})
    return cmd.done(_finish_with_payment(
        document=buyer_return.document, base_result=return_result, actor=actor, breakdown=breakdown,
        idempotency_key=idempotency_key, direction="outgoing", reason=f"Выдача денег за возврат {buyer_return.document.number}",
    ))
