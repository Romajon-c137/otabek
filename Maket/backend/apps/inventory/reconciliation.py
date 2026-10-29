from decimal import Decimal

from django.db.models import Sum

from .models import Lot, StockBalance, StockMovement


def verify_inventory() -> list[str]:
    errors = []
    movement_totals = {
        (row["warehouse_id"], row["product_id"]): (
            row["quantity"] or Decimal("0.000"), row["cost"] or Decimal("0.00")
        )
        for row in StockMovement.objects.values("warehouse_id", "product_id").annotate(
            quantity=Sum("signed_quantity"), cost=Sum("signed_cost"),
        )
    }
    balance_totals = {
        (item.warehouse_id, item.product_id): (item.quantity, item.cost)
        for item in StockBalance.objects.all()
    }
    for key in sorted(set(movement_totals) | set(balance_totals), key=lambda item: (str(item[0]), str(item[1]))):
        expected = movement_totals.get(key, (Decimal("0.000"), Decimal("0.00")))
        actual = balance_totals.get(key, (Decimal("0.000"), Decimal("0.00")))
        if expected != actual:
            errors.append(f"Остаток {key}: движения={expected}, баланс={actual}")

    for lot in Lot.objects.all():
        totals = lot.movements.aggregate(quantity=Sum("signed_quantity"), cost=Sum("signed_cost"))
        expected = (totals["quantity"] or Decimal("0.000"), totals["cost"] or Decimal("0.00"))
        actual = (lot.remaining_quantity, lot.remaining_cost)
        if expected != actual:
            errors.append(f"Партия {lot.id}: движения={expected}, остаток={actual}")
    return errors
