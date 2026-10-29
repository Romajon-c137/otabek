from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.utils import timezone

from modules.common.errors import Conflict, InsufficientStock
from modules.documents.models import TradeLine
from .models import FifoAllocation, StockLevel, StockLot, StockMovement, StockReservation


ZERO_QTY = Decimal("0.000")
COST_STEP = Decimal("0.000001")


def _local_quantity(line: TradeLine) -> Decimal:
    supply = getattr(line, "neighbor_supply", None)
    return line.quantity - (supply.quantity if supply else ZERO_QTY)


def locked_level(warehouse, product) -> StockLevel:
    level, _ = StockLevel.objects.get_or_create(warehouse=warehouse, product=product)
    return StockLevel.objects.select_for_update().get(pk=level.pk)


def receive_line(line: TradeLine, *, unit_cost: Decimal | None = None, reversal_of=None) -> StockLot | None:
    if not line.product.track_stock:
        return None
    level = locked_level(line.document.warehouse, line.product)
    level.quantity += line.quantity
    level.save(update_fields=["quantity", "updated_at"])
    cost = (unit_cost if unit_cost is not None else line.unit_price).quantize(COST_STEP, rounding=ROUND_HALF_UP)
    lot = StockLot.objects.create(
        warehouse=line.document.warehouse,
        product=line.product,
        source_line=line,
        received_at=timezone.now(),
        initial_quantity=line.quantity,
        remaining_quantity=line.quantity,
        unit_cost=cost,
    )
    StockMovement.objects.create(
        warehouse=line.document.warehouse,
        product=line.product,
        document=line.document,
        line=line,
        quantity_delta=line.quantity,
        unit_cost=cost,
        reversal_of=reversal_of,
    )
    return lot


def issue_line(line: TradeLine) -> Decimal:
    if not line.product.track_stock:
        return Decimal("0.00")
    quantity = _local_quantity(line)
    if quantity <= ZERO_QTY:
        return Decimal("0.00")
    level = locked_level(line.document.warehouse, line.product)
    if level.available < quantity:
        raise InsufficientStock(product=line.product, stock=level.quantity, reserved=level.reserved, requested=quantity)
    remaining = quantity
    total_cost = Decimal("0.00")
    lots = StockLot.objects.select_for_update().filter(
        warehouse=line.document.warehouse,
        product=line.product,
        remaining_quantity__gt=0,
    ).order_by("received_at", "id")
    for lot in lots:
        if remaining <= 0:
            break
        taken = min(remaining, lot.remaining_quantity)
        lot.remaining_quantity -= taken
        lot.save(update_fields=["remaining_quantity"])
        FifoAllocation.objects.create(outbound_line=line, lot=lot, quantity=taken, unit_cost=lot.unit_cost)
        StockMovement.objects.create(
            warehouse=line.document.warehouse,
            product=line.product,
            document=line.document,
            line=line,
            quantity_delta=-taken,
            unit_cost=lot.unit_cost,
        )
        total_cost += taken * lot.unit_cost
        remaining -= taken
    if remaining > ZERO_QTY:
        raise InsufficientStock(f"Нарушена целостность партий товара «{line.product.name}».")
    level.quantity -= quantity
    level.save(update_fields=["quantity", "updated_at"])
    return total_cost.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def receive_customer_return(line: TradeLine) -> Decimal:
    if not line.product.track_stock:
        return Decimal("0.00")
    if not line.source_line_id:
        raise Conflict("Возврат покупателя должен ссылаться на строку продажи.")
    # Two return documents can be posted at the same time. Lock the original
    # sale line before calculating the already-returned quantity so only one
    # transaction can consume the remaining return allowance.
    source = TradeLine.objects.select_for_update().get(pk=line.source_line_id)
    already_returned = sum(
        (item.quantity for item in source.return_lines.filter(document__status="posted").exclude(pk=line.pk)),
        ZERO_QTY,
    )
    if already_returned + line.quantity > source.quantity:
        raise Conflict(f"Нельзя вернуть больше, чем продано по строке «{source.product_name}».")
    allocations = list(source.fifo_allocations.select_related("lot").order_by("-id"))
    skip = already_returned
    remaining = line.quantity
    pieces = []
    for allocation in allocations:
        available = allocation.quantity
        if skip >= available:
            skip -= available
            continue
        available -= skip
        skip = ZERO_QTY
        restored = min(available, remaining)
        if restored > 0:
            pieces.append((restored, allocation.unit_cost))
            remaining -= restored
        if remaining <= 0:
            break
    if remaining > ZERO_QTY:
        raise Conflict("Не удалось восстановить себестоимость возврата из исходного FIFO.")
    level = locked_level(line.document.warehouse, line.product)
    level.quantity += line.quantity
    level.save(update_fields=["quantity", "updated_at"])
    total_cost = Decimal("0.00")
    for quantity, unit_cost in pieces:
        StockLot.objects.create(
            warehouse=line.document.warehouse,
            product=line.product,
            source_line=line,
            received_at=timezone.now(),
            initial_quantity=quantity,
            remaining_quantity=quantity,
            unit_cost=unit_cost,
        )
        StockMovement.objects.create(
            warehouse=line.document.warehouse,
            product=line.product,
            document=line.document,
            line=line,
            quantity_delta=quantity,
            unit_cost=unit_cost,
        )
        total_cost += quantity * unit_cost
    return total_cost.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def issue_supplier_return(line: TradeLine) -> Decimal:
    if not line.product.track_stock:
        return Decimal("0.00")
    source = line.source_line
    if not source:
        raise Conflict("Возврат поставщику должен ссылаться на строку поступления.")
    level = locked_level(line.document.warehouse, line.product)
    if level.available < line.quantity:
        raise InsufficientStock(f"Недостаточно свободного товара «{line.product.name}» для возврата поставщику.")
    remaining = line.quantity
    total_cost = Decimal("0.00")
    lots = StockLot.objects.select_for_update().filter(source_line=source, remaining_quantity__gt=0).order_by("received_at", "id")
    for lot in lots:
        if remaining <= 0:
            break
        taken = min(remaining, lot.remaining_quantity)
        lot.remaining_quantity -= taken
        lot.save(update_fields=["remaining_quantity"])
        FifoAllocation.objects.create(outbound_line=line, lot=lot, quantity=taken, unit_cost=lot.unit_cost)
        StockMovement.objects.create(
            warehouse=line.document.warehouse,
            product=line.product,
            document=line.document,
            line=line,
            quantity_delta=-taken,
            unit_cost=lot.unit_cost,
        )
        total_cost += taken * lot.unit_cost
        remaining -= taken
    if remaining > ZERO_QTY:
        raise Conflict(f"Недостаточно остатка из исходного поступления для «{line.product.name}».")
    level.quantity -= line.quantity
    level.save(update_fields=["quantity", "updated_at"])
    return total_cost.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def reserve_order_line(line: TradeLine) -> StockReservation | None:
    if not line.product.track_stock:
        return None
    quantity = _local_quantity(line)
    if quantity <= ZERO_QTY:
        return None
    level = locked_level(line.document.warehouse, line.product)
    if level.available < quantity:
        raise InsufficientStock(product=line.product, stock=level.quantity, reserved=level.reserved, requested=quantity)
    level.reserved += quantity
    level.save(update_fields=["reserved", "updated_at"])
    return StockReservation.objects.create(order_line=line, warehouse=line.document.warehouse, product=line.product, quantity=quantity)


def release_order_reservations(document) -> None:
    reservations = StockReservation.objects.select_for_update().filter(order_line__document=document, released_at__isnull=True).select_related("product")
    for reservation in reservations:
        level = locked_level(reservation.warehouse, reservation.product)
        if level.reserved < reservation.quantity:
            raise Conflict("Нарушена целостность резерва.")
        level.reserved -= reservation.quantity
        level.save(update_fields=["reserved", "updated_at"])
        reservation.released_at = timezone.now()
        reservation.save(update_fields=["released_at"])


def reverse_inbound_document(document) -> None:
    for line in document.lines.select_related("product"):
        if not line.product.track_stock:
            continue
        lots = list(StockLot.objects.select_for_update().filter(source_line=line))
        if any(lot.remaining_quantity != lot.initial_quantity for lot in lots):
            raise Conflict(f"Нельзя отменить документ: товар «{line.product.name}» уже использован.")
        level = locked_level(document.warehouse, line.product)
        if level.quantity < line.quantity or level.available < line.quantity:
            raise Conflict(f"Нельзя отменить документ: недостаточный свободный остаток «{line.product.name}».")
        level.quantity -= line.quantity
        level.save(update_fields=["quantity", "updated_at"])
        original = StockMovement.objects.filter(line=line, quantity_delta__gt=0).order_by("id").first()
        StockMovement.objects.create(warehouse=document.warehouse, product=line.product, document=document, line=line, quantity_delta=-line.quantity, unit_cost=line.unit_price, reversal_of=original)
        StockLot.objects.filter(pk__in=[lot.pk for lot in lots]).update(remaining_quantity=ZERO_QTY)


def reverse_outbound_document(document) -> None:
    for line in document.lines.select_related("product", "neighbor_supply"):
        if not line.product.track_stock:
            continue
        quantity = _local_quantity(line)
        allocations = list(line.fifo_allocations.select_for_update().select_related("lot"))
        if sum((item.quantity for item in allocations), ZERO_QTY) != quantity:
            raise Conflict("Нарушена целостность исходного FIFO при отмене.")
        if quantity <= ZERO_QTY:
            continue
        level = locked_level(document.warehouse, line.product)
        level.quantity += quantity
        level.save(update_fields=["quantity", "updated_at"])
        originals = list(StockMovement.objects.filter(line=line, quantity_delta__lt=0).order_by("id"))
        for index, allocation in enumerate(allocations):
            lot = StockLot.objects.select_for_update().get(pk=allocation.lot_id)
            if lot.remaining_quantity + allocation.quantity > lot.initial_quantity:
                raise Conflict("Партия уже восстановлена другой операцией.")
            lot.remaining_quantity += allocation.quantity
            lot.save(update_fields=["remaining_quantity"])
            StockMovement.objects.create(warehouse=document.warehouse, product=line.product, document=document, line=line, quantity_delta=allocation.quantity, unit_cost=allocation.unit_cost, reversal_of=originals[index] if index < len(originals) else None)

