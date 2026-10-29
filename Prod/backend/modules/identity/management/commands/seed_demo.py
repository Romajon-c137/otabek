from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from modules.catalog.models import Category, Product
from modules.identity.models import UserProfile, UserRole, WarehouseGrant
from modules.parties.models import Party
from modules.warehouses.models import Warehouse


class Command(BaseCommand):
    help = "Отдельно создаёт минимальные демонстрационные справочники."

    @transaction.atomic
    def handle(self, *args, **options):
        warehouse, _ = Warehouse.objects.get_or_create(code="DEMO", defaults={"name": "Демонстрационный склад"})
        category, _ = Category.objects.get_or_create(name="Демонстрационные товары")
        Product.objects.get_or_create(sku="DEMO-001", defaults={"name": "Тестовый товар", "category": category, "unit": Product.Unit.PIECE, "purchase_price": "100.00", "retail_price": "150.00", "wholesale_price": "130.00"})
        Party.objects.get_or_create(code="DEMO-CUSTOMER", defaults={"name": "Тестовый покупатель", "kind": Party.Kind.CUSTOMER})
        user = get_user_model().objects.filter(is_superuser=True).order_by("id").first()
        if user:
            WarehouseGrant.objects.update_or_create(user=user, warehouse=warehouse, defaults={"can_view": True, "can_sell": True, "can_manage_stock": True, "can_manage_finance": True, "can_manage_settings": True})
            UserProfile.objects.get_or_create(user=user, defaults={"role": UserRole.OWNER})
        self.stdout.write(self.style.SUCCESS("Демонстрационные справочники созданы."))

