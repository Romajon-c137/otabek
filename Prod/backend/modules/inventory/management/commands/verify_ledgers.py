from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Sum

from modules.finance.models import Obligation
from modules.inventory.models import StockLevel, StockLot, StockMovement


class Command(BaseCommand):
    help = "Проверяет согласованность складского и финансового регистров."

    def handle(self, *args, **options):
        errors = []
        for level in StockLevel.objects.select_related("warehouse", "product"):
            movement_total = StockMovement.objects.filter(warehouse=level.warehouse, product=level.product).aggregate(total=Sum("quantity_delta"))["total"] or Decimal("0.000")
            lot_total = StockLot.objects.filter(warehouse=level.warehouse, product=level.product).aggregate(total=Sum("remaining_quantity"))["total"] or Decimal("0.000")
            if level.quantity != movement_total:
                errors.append(f"Остаток {level.pk}: quantity={level.quantity}, движения={movement_total}")
            if level.quantity != lot_total:
                errors.append(f"Остаток {level.pk}: quantity={level.quantity}, партии={lot_total}")
            if level.reserved > level.quantity:
                errors.append(f"Остаток {level.pk}: резерв превышает количество")
        for obligation in Obligation.objects.prefetch_related("applications"):
            if obligation.reversed_at:
                expected = Decimal("0.00")
            else:
                applied = sum((entry.amount for entry in obligation.applications.all() if entry.reversed_at is None), Decimal("0.00"))
                expected = obligation.original_amount - applied
            if obligation.open_amount != expected:
                errors.append(f"Обязательство {obligation.pk}: open={obligation.open_amount}, расчёт={expected}")
        if errors:
            raise CommandError("\n".join(errors))
        self.stdout.write(self.style.SUCCESS("Регистры согласованы."))

