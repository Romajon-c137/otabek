from django.core.management.base import BaseCommand, CommandError

from apps.inventory.reconciliation import verify_inventory
from apps.settlements.reconciliation import verify_settlements


class Command(BaseCommand):
    help = "Сверяет складские и расчётные кэши с неизменяемыми движениями."

    def handle(self, *args, **options):
        errors = verify_inventory() + verify_settlements()
        if errors:
            raise CommandError("\n".join(errors))
        self.stdout.write(self.style.SUCCESS("Складской и расчётный журналы согласованы."))
