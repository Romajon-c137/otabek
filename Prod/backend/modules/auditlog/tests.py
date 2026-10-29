from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from modules.catalog.models import Product
from modules.identity.models import UserProfile, UserRole, WarehouseGrant
from modules.warehouses.models import Warehouse

from .models import AuditRecord
from .services import record_action


class AuditLogTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user("audit-owner", password="audit-pass-2026")
        UserProfile.objects.create(user=self.user, role=UserRole.OWNER)
        self.warehouse = Warehouse.objects.create(code="AUDIT", name="Аудит склад")
        WarehouseGrant.objects.create(user=self.user, warehouse=self.warehouse, can_view=True)
        self.product = Product.objects.create(name="Глобальный товар", sku="AUDIT-1", purchase_price="10", retail_price="20")

    def test_global_and_warehouse_actions_are_visible(self):
        record_action(actor=self.user, action="product.updated", entity=self.product, after={"name": self.product.name})
        record_action(actor=self.user, action="stock.checked", entity=self.warehouse, warehouse_id=self.warehouse.pk)
        client = APIClient()
        client.force_authenticate(self.user)

        response = client.get("/api/v1/audit/?page_size=50")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual({row["action"] for row in response.data["results"]}, {"product.updated", "stock.checked"})

    def test_records_cannot_be_changed_or_deleted_through_model_or_queryset(self):
        record = record_action(actor=self.user, action="product.updated", entity=self.product)

        with self.assertRaises(RuntimeError):
            AuditRecord.objects.filter(pk=record.pk).update(action="tampered")
        with self.assertRaises(RuntimeError):
            AuditRecord.objects.filter(pk=record.pk).delete()
        with self.assertRaises(RuntimeError):
            record.delete()

        self.assertEqual(AuditRecord.objects.get(pk=record.pk).action, "product.updated")
