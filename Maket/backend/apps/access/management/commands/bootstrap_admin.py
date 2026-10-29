import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.warehouses.models import Warehouse, WarehouseAccess


class Command(BaseCommand):
    help = "Создаёт или обновляет первого администратора и основной склад."

    def add_arguments(self, parser):
        parser.add_argument("--username", default=os.environ.get("HOZUCHET_ADMIN_USERNAME"))
        parser.add_argument("--password", default=os.environ.get("HOZUCHET_ADMIN_PASSWORD"))
        parser.add_argument("--warehouse-code", default="MAIN")
        parser.add_argument("--warehouse-name", default="Основной склад")

    @transaction.atomic
    def handle(self, *args, **options):
        username = options["username"]
        password = options["password"]
        if not username or not password:
            raise CommandError("Передайте --username/--password или HOZUCHET_ADMIN_USERNAME/HOZUCHET_ADMIN_PASSWORD.")
        if len(password) < 10:
            raise CommandError("Пароль администратора должен содержать не менее 10 символов.")
        user, _ = get_user_model().objects.get_or_create(username=username)
        user.is_staff = True
        user.is_superuser = True
        user.is_active = True
        user.set_password(password)
        user.save()
        warehouse, _ = Warehouse.objects.get_or_create(
            code=options["warehouse_code"], defaults={"name": options["warehouse_name"]},
        )
        WarehouseAccess.objects.update_or_create(
            user=user, warehouse=warehouse, defaults={"role": WarehouseAccess.Role.ADMIN},
        )
        self.stdout.write(self.style.SUCCESS(f"Администратор {username} и склад {warehouse.code} готовы."))
