from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework import status
from rest_framework.test import APITestCase

from apps.catalog.models import Product
from apps.inventory.models import StockBalance
from apps.partners.models import Counterparty
from apps.warehouses.models import Warehouse, WarehouseAccess

from .models import ChangeEvent


class SyncFeedTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="kassa", password="test")
        self.phone = get_user_model().objects.create_user(username="phone", password="test")
        self.stranger = get_user_model().objects.create_user(username="stranger", password="test")
        self.warehouse = Warehouse.objects.create(code="SYNC", name="Склад синхронизации")
        self.other = Warehouse.objects.create(code="OTHER", name="Чужой склад")
        for user in (self.user, self.phone):
            WarehouseAccess.objects.create(user=user, warehouse=self.warehouse, role=WarehouseAccess.Role.SELLER)
        WarehouseAccess.objects.create(user=self.stranger, warehouse=self.other, role=WarehouseAccess.Role.SELLER)
        self.supplier = Counterparty.objects.create(code="SYNC-SUP", name="Поставщик")
        self.customer = Counterparty.objects.create(code="SYNC-BUY", name="Покупатель")
        self.product = Product.objects.create(code="SYNC-P", name="Ведро", unit=Product.Unit.PIECE)

    def changes(self, user, since=0, **params):
        self.client.force_authenticate(user)
        return self.client.get("/api/v1/sync/changes/", {"since": since, **params})

    def create_order(self, user, number="SYNC-ORDER-1"):
        self.client.force_authenticate(user)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post("/api/v1/orders/", {
                "number": number, "warehouse": str(self.warehouse.id), "counterparty": str(self.customer.id),
                "lines": [{"product": str(self.product.id), "quantity": "2.000", "price": "150.00"}],
            }, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        return response.data

    def test_order_from_phone_appears_in_feed_for_kassa(self):
        start = self.changes(self.user).data["last_seq"]
        order = self.create_order(self.phone)
        response = self.changes(self.user, since=start)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        events = [e for e in response.data["events"] if e["id"] == order["id"]]
        self.assertTrue(events)
        self.assertEqual(events[-1]["doc_type"], "order")
        self.assertEqual(events[-1]["status"], "draft")
        self.assertEqual(events[-1]["actor"], "phone")
        self.assertEqual(events[-1]["counterparty"], str(self.customer.id))
        # повторный запрос с новым курсором ничего не возвращает
        again = self.changes(self.user, since=response.data["last_seq"])
        self.assertEqual(again.data["events"], [])
        self.assertEqual(again.data["last_seq"], response.data["last_seq"])

    def test_sequence_is_strictly_increasing_and_paged(self):
        for index in range(3):
            self.create_order(self.phone, number=f"SYNC-PAGE-{index}")
        first = self.changes(self.user, limit=2)
        self.assertTrue(first.data["has_more"])
        self.assertEqual(len(first.data["events"]), 2)
        rest = self.changes(self.user, since=first.data["last_seq"], limit=1000)
        self.assertFalse(rest.data["has_more"])
        seqs = [e["seq"] for e in first.data["events"] + rest.data["events"]]
        self.assertEqual(seqs, sorted(set(seqs)))
        self.assertEqual(seqs[-1], rest.data["last_seq"])

    def test_foreign_warehouse_events_are_hidden_but_cursor_moves(self):
        self.create_order(self.phone)
        response = self.changes(self.stranger)
        self.assertFalse([e for e in response.data["events"] if e["entity"] == "document"])
        self.assertEqual(response.data["last_seq"], ChangeEvent.objects.order_by("-seq").first().seq)

    def test_rolled_back_change_emits_nothing(self):
        before = ChangeEvent.objects.count()
        with self.captureOnCommitCallbacks(execute=True):
            try:
                with transaction.atomic():
                    Product.objects.create(code="SYNC-ROLLBACK", name="Откат", unit=Product.Unit.PIECE)
                    raise RuntimeError("откат")
            except RuntimeError:
                pass
        self.assertEqual(ChangeEvent.objects.count(), before)

    def test_product_and_counterparty_changes_are_published(self):
        with self.captureOnCommitCallbacks(execute=True):
            Product.objects.create(code="SYNC-NEW", name="Новый товар", unit=Product.Unit.PIECE)
            Counterparty.objects.create(code="SYNC-NEW-CP", name="Новый человек")
        entities = {(e["entity"], e["number"]) for e in self.changes(self.user).data["events"]}
        self.assertIn(("product", "SYNC-NEW"), entities)
        self.assertIn(("counterparty", "SYNC-NEW-CP"), entities)

    def test_bad_cursor_is_rejected(self):
        self.assertEqual(self.changes(self.user, since="abc").status_code, status.HTTP_400_BAD_REQUEST)


class OrderShippingTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="ship-seller", password="test")
        self.warehouse = Warehouse.objects.create(code="SHIP", name="Склад отгрузки")
        WarehouseAccess.objects.create(user=self.user, warehouse=self.warehouse, role=WarehouseAccess.Role.SELLER)
        supplier = Counterparty.objects.create(code="SHIP-SUP", name="Поставщик")
        self.customer = Counterparty.objects.create(code="SHIP-BUY", name="Покупатель")
        self.product = Product.objects.create(code="SHIP-P", name="Таз", unit=Product.Unit.PIECE)
        self.client.force_authenticate(self.user)
        receipt = self.client.post("/api/v1/receipts/", {
            "number": "SHIP-R", "warehouse": str(self.warehouse.id), "counterparty": str(supplier.id),
            "lines": [{"product": str(self.product.id), "quantity": "10.000", "price": "100.00"}],
        }, format="json")
        self.client.post(f"/api/v1/receipts/{receipt.data['id']}/post/", {"version": 1}, format="json", HTTP_IDEMPOTENCY_KEY="ship-receipt")
        order = self.client.post("/api/v1/orders/", {
            "number": "SHIP-1", "warehouse": str(self.warehouse.id), "counterparty": str(self.customer.id),
            "lines": [{"product": str(self.product.id), "quantity": "4.000", "price": "150.00"}],
        }, format="json")
        self.order_id = order.data["id"]

    def command(self, action, version, key):
        return self.client.post(f"/api/v1/orders/{self.order_id}/{action}/", {"version": version}, format="json", HTTP_IDEMPOTENCY_KEY=key)

    def test_new_assembling_shipped_delivered(self):
        self.assertEqual(self.command("reserve", 1, "s-reserve").data["state"], "reserved")
        shipped = self.command("ship", 2, "s-ship")
        self.assertEqual(shipped.status_code, status.HTTP_200_OK, shipped.data)
        self.assertEqual(shipped.data["state"], "shipped")
        # резерв сохраняется в пути
        self.assertEqual(StockBalance.objects.get(product=self.product).reserved, Decimal("4.000"))
        delivered = self.command("sale", 3, "s-sale")
        self.assertEqual(delivered.status_code, status.HTTP_200_OK, delivered.data)
        self.assertEqual(delivered.data["state"], "completed")
        balance = StockBalance.objects.get(product=self.product)
        self.assertEqual((balance.quantity, balance.reserved), (Decimal("6.000"), Decimal("0.000")))

    def test_unship_returns_to_assembled_and_draft_cannot_ship(self):
        self.assertEqual(self.command("ship", 1, "d-ship").status_code, status.HTTP_400_BAD_REQUEST)
        self.command("reserve", 1, "u-reserve")
        self.command("ship", 2, "u-ship")
        back = self.command("unship", 3, "u-unship")
        self.assertEqual(back.data["state"], "assembled")
        cancelled = self.command("cancel", 4, "u-cancel")
        self.assertEqual(cancelled.data["state"], "cancelled")
        self.assertEqual(StockBalance.objects.get(product=self.product).reserved, Decimal("0.000"))

    def test_shipped_order_can_be_cancelled_with_reserve_release(self):
        self.command("reserve", 1, "c-reserve")
        self.command("ship", 2, "c-ship")
        self.assertEqual(self.command("cancel", 3, "c-cancel").data["state"], "cancelled")
        self.assertEqual(StockBalance.objects.get(product=self.product).reserved, Decimal("0.000"))
