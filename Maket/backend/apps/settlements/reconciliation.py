from decimal import Decimal

from django.db.models import Sum

from .models import Obligation, SettlementMovement


def verify_settlements() -> list[str]:
    errors = []
    for obligation in Obligation.objects.all():
        movement_total = obligation.movements.aggregate(value=Sum("signed_amount"))["value"] or Decimal("0.00")
        expected = obligation.open_amount if obligation.side == Obligation.Side.RECEIVABLE else -obligation.open_amount
        if movement_total != expected:
            errors.append(
                f"Обязательство {obligation.id}: движения={movement_total}, открыто={expected}"
            )
    return errors
