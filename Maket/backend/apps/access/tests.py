from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from apps.catalog.models import Product
from apps.inventory.models import StockBalance
from apps.partners.models import Counterparty
from apps.warehouses.models import Warehouse, WarehouseAccess


class AccessMatrixTests(APITestCase):
    def setUp(self):
        self.viewer = get_user_model().objects.create_user(username="viewer", password="test")
        self.seller = get_user_model().objects.create_user(username="seller-access", password="test")
        self.first = Warehouse.objects.create(code="A1", name="Доступный склад")
        self.second = Warehouse.objects.create(code="A2", name="Чужой склад")
        WarehouseAccess.objects.create(user=self.viewer, warehouse=self.first, role=WarehouseAccess.Role.VIEWER)
        WarehouseAccess.objects.create(user=self.seller, warehouse=self.first, role=WarehouseAccess.Role.SELLER)
        self.product = Product.objects.create(code="ACCESS-P", name="Товар доступа", unit=Product.Unit.PIECE)
        self.customer = Counterparty.objects.create(code="ACCESS-C", name="Клиент доступа")
        StockBalance.objects.create(warehouse=self.first, product=self.product, quantity=Decimal("2"), cost=Decimal("20"))
        StockBalance.objects.create(warehouse=self.second, product=self.product, quantity=Decimal("7"), cost=Decimal("70"))

    def test_anonymous_api_is_rejected(self):
        self.assertEqual(self.client.get("/api/v1/products/").status_code, status.HTTP_401_UNAUTHORIZED)

    def test_viewer_reads_only_own_warehouse_and_cannot_write(self):
        self.client.force_authenticate(self.viewer)
        report = self.client.get("/api/v1/reports/stock/")
        self.assertEqual(report.status_code, status.HTTP_200_OK)
        self.assertEqual(len(report.data["results"]), 1)
        self.assertEqual(report.data["results"][0]["warehouse_id"], str(self.first.id))
        denied_product = self.client.post("/api/v1/products/", {
            "code": "DENIED", "name": "Запрещённый", "unit": "pcs",
            "purchase_price": "0", "retail_price": "0", "wholesale_price": "0",
        }, format="json")
        self.assertEqual(denied_product.status_code, status.HTTP_403_FORBIDDEN)
        denied_sale = self.client.post("/api/v1/sales/", {
            "number": "DENIED-SALE", "warehouse": str(self.first.id),
            "counterparty": str(self.customer.id),
            "lines": [{"product": str(self.product.id), "quantity": "1", "price": "10"}],
        }, format="json")
        self.assertEqual(denied_sale.status_code, status.HTTP_403_FORBIDDEN)

    def test_seller_cannot_write_another_warehouse(self):
        self.client.force_authenticate(self.seller)
        response = self.client.post("/api/v1/sales/", {
            "number": "OTHER-WAREHOUSE", "warehouse": str(self.second.id),
            "counterparty": str(self.customer.id),
            "lines": [{"product": str(self.product.id), "quantity": "1", "price": "10"}],
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class TokenLoginAndCorsTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="kassir", password="s3cret-pass")

    def test_login_returns_token_that_authenticates_and_logout_revokes_it(self):
        bad = self.client.post("/api/v1/auth/token/", {"username": "kassir", "password": "wrong"}, format="json")
        self.assertEqual(bad.status_code, status.HTTP_401_UNAUTHORIZED)
        good = self.client.post("/api/v1/auth/token/", {"username": "kassir", "password": "s3cret-pass"}, format="json")
        self.assertEqual(good.status_code, status.HTTP_200_OK)
        token = good.data["token"]
        me = self.client.get("/api/v1/auth/me/", HTTP_AUTHORIZATION=f"Token {token}")
        self.assertEqual(me.data["username"], "kassir")
        self.assertEqual(self.client.post("/api/v1/auth/logout/", HTTP_AUTHORIZATION=f"Token {token}").status_code, 204)
        self.assertEqual(self.client.get("/api/v1/auth/me/", HTTP_AUTHORIZATION=f"Token {token}").status_code, status.HTTP_401_UNAUTHORIZED)

    def test_cors_only_for_listed_origins(self):
        from django.test import override_settings
        from config import middleware
        with override_settings(CORS_ALLOWED_ORIGINS=["tauri://localhost"]):
            handler = middleware.CorsMiddleware(lambda request: __import__("django.http", fromlist=["HttpResponse"]).HttpResponse("ok"))
            from django.test import RequestFactory
            factory = RequestFactory()
            preflight = handler(factory.options("/api/v1/products/", HTTP_ORIGIN="tauri://localhost", HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST"))
            self.assertEqual(preflight.status_code, 204)
            self.assertEqual(preflight["Access-Control-Allow-Origin"], "tauri://localhost")
            self.assertIn("Idempotency-Key", preflight["Access-Control-Allow-Headers"])
            foreign = handler(factory.get("/api/v1/products/", HTTP_ORIGIN="https://evil.example"))
            self.assertNotIn("Access-Control-Allow-Origin", foreign)
