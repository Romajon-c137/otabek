from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from modules.auditlog.services import record_action
from modules.catalog.models import Product
from modules.identity.models import WarehouseGrant
from modules.warehouses.models import Warehouse


class SyncFeedTests(TestCase):
    def test_feed_advances_cursor_and_filters_warehouse(self):
        user = get_user_model().objects.create_user("cashier", password="correct-horse-123")
        own = Warehouse.objects.create(code="OWN", name="Свой")
        other = Warehouse.objects.create(code="OTHER", name="Чужой")
        WarehouseGrant.objects.create(user=user, warehouse=own, can_view=True)
        product = Product.objects.create(name="Тест", sku="SYNC-1")
        record_action(actor=user, action="product.changed", entity=product, warehouse_id=other.id, after={"name": product.name})
        record_action(actor=user, action="product.changed", entity=product, warehouse_id=own.id, after={"name": product.name})
        client = APIClient()
        client.force_authenticate(user)
        response = client.get("/api/v1/sync/changes/?since=0&wait=0")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["last_seq"], 2)
        self.assertEqual([item["seq"] for item in response.data["changes"]], [2])
