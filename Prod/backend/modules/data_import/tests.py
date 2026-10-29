from io import BytesIO

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase

from modules.catalog.models import Product
from modules.finance.models import Obligation
from modules.inventory.models import StockLevel
from modules.parties.models import Party
from modules.warehouses.models import Warehouse
from .services import apply_batch, make_template, validate_workbook


class ProductImportTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_superuser("importer", "importer@example.test", "correct-horse-123")
        self.warehouse = Warehouse.objects.create(code="MAIN", name="Основной")

    def test_template_validation_and_apply(self):
        content = make_template()
        batch = validate_workbook(SimpleUploadedFile("products.xlsx", content, content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), self.user)
        self.assertEqual(batch.errors, [])
        result = apply_batch(batch, self.user, self.warehouse)
        self.assertEqual(result["products_created"], 1)
        self.assertEqual(result["parties_created"], 1)
        product = Product.objects.get(sku="P-001", retail_price="150.00")
        self.assertEqual(StockLevel.objects.get(product=product).quantity, 10)
        self.assertTrue(Party.objects.filter(code="C-001").exists())
        self.assertEqual(Obligation.objects.get(product=product).open_amount, 300)

    def test_same_file_cannot_be_applied_twice(self):
        content = make_template()
        first = validate_workbook(SimpleUploadedFile("first.xlsx", content), self.user)
        second = validate_workbook(SimpleUploadedFile("second.xlsx", content), self.user)
        apply_batch(first, self.user, self.warehouse)
        with self.assertRaisesMessage(ValueError, "уже был применён"):
            apply_batch(second, self.user, self.warehouse)

