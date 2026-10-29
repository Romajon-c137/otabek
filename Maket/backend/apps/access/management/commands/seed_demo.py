from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.catalog.models import Product
from apps.documents.calculations import money
from apps.documents.models import Document, Receipt, ReceiptLine, Sale, SaleLine
from apps.documents.services import post_receipt, post_sale
from apps.partners.models import Counterparty
from apps.warehouses.models import Warehouse


class Command(BaseCommand):
    help = "Создаёт небольшой идемпотентный набор демонстрационных данных через штатные сервисы."

    @transaction.atomic
    def handle(self, *args, **options):
        user = get_user_model().objects.filter(is_superuser=True).order_by("id").first()
        if not user:
            raise CommandError("Сначала выполните bootstrap_admin.")
        warehouse = Warehouse.objects.filter(active=True).order_by("created_at").first()
        if not warehouse:
            raise CommandError("Активный склад не найден.")
        supplier, _ = Counterparty.objects.get_or_create(code="DEMO-SUP", defaults={"name": "ОсОО Дом и быт"})
        customer, _ = Counterparty.objects.get_or_create(code="DEMO-BUY", defaults={"name": "Магазин у дома", "phone": "+996 555 010101"})
        specs = [
            ("000001", "Шуруповёрт", "оргон 36в", 7, 13, "pcs", "1100", "1100"),
            ("000002", "Шуруповёрт", "орта 48в", 7, 14, "pcs", "1800", "1800"),
            ("000003", "Монтажная коробка", "80х80", 6, 19, "pcs", "50", "50"),
            ("000004", "Монтажная коробка", "10х100", 6, 20, "pcs", "80", "80"),
            ("000005", "Вытяжка", "100 м", 3, 15, "pcs", "100", "100"),
        ]
        products = []
        for code, name, variant, external_product, external_size, unit, purchase, retail in specs:
            product, _ = Product.objects.update_or_create(code=code, defaults={
                "name": name, "variant_name": variant,
                "external_product_id": external_product, "external_size_id": external_size,
                "unit": unit,
                "purchase_price": Decimal(purchase), "retail_price": Decimal(retail),
                "wholesale_price": Decimal(retail) - Decimal("10"),
            })
            products.append(product)
        if not Document.objects.filter(type=Document.Type.RECEIPT, number="DEMO-RCPT-1").exists():
            document = Document.objects.create(
                type=Document.Type.RECEIPT, number="DEMO-RCPT-1", warehouse=warehouse,
                counterparty=supplier, author=user, reason="Демонстрационное поступление",
            )
            receipt = Receipt.objects.create(document=document)
            for position, product in enumerate(products, start=1):
                qty = Decimal("20.000")
                total = money(qty * product.purchase_price)
                ReceiptLine.objects.create(
                    receipt=receipt, position=position, product=product,
                    product_code=product.code, product_name=product.name, unit=product.unit,
                    quantity=qty, price=product.purchase_price, goods_amount=total,
                    allocated_extra_cost=0, total_cost=total,
                )
            post_receipt(receipt_id=receipt.pk, actor=user, version=1, idempotency_key="seed-demo-receipt")
        if not Document.objects.filter(type=Document.Type.SALE, number="DEMO-SALE-1").exists():
            document = Document.objects.create(
                type=Document.Type.SALE, number="DEMO-SALE-1", warehouse=warehouse,
                counterparty=customer, author=user, reason="Демонстрационная продажа",
            )
            sale = Sale.objects.create(document=document)
            product = products[0]; qty = Decimal("2.000")
            SaleLine.objects.create(
                sale=sale, position=1, product=product,
                product_code=product.code, product_name=product.name, unit=product.unit,
                quantity=qty, price=product.retail_price, discount=Decimal("20.00"),
                amount=money(qty * product.retail_price - Decimal("20.00")), cost=0,
            )
            post_sale(sale_id=sale.pk, actor=user, version=1, idempotency_key="seed-demo-sale")
        self.stdout.write(self.style.SUCCESS("Демонстрационные данные готовы."))
