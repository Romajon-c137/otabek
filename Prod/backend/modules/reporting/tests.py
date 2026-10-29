from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from modules.catalog.models import Product
from modules.documents.models import DocumentKind
from modules.documents.services import create_document, post_document
from modules.parties.models import Party
from modules.warehouses.models import Warehouse


class ReportTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_superuser("report", "report@example.test", "correct-horse-123")
        self.warehouse = Warehouse.objects.create(code="R", name="Отчётный")
        self.product = Product.objects.create(name="Товар", sku="R-1", purchase_price="10", retail_price="20")
        self.party = Party.objects.create(code="RC", name="Покупатель", kind=Party.Kind.CUSTOMER)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        opening = create_document(actor=self.user, warehouse=self.warehouse, kind=DocumentKind.OPENING, effective_date=date(2026, 10, 25), lines=[{"product": self.product, "quantity": "10", "unit_price": "10"}])
        post_document(actor=self.user, document=opening, idempotency_key="report-opening")
        sale = create_document(actor=self.user, warehouse=self.warehouse, kind=DocumentKind.SALE, effective_date=date(2026, 10, 25), party=self.party, lines=[{"product": self.product, "quantity": "2", "unit_price": "20"}])
        post_document(actor=self.user, document=sale, idempotency_key="report-sale")

    def test_reports_include_server_side_totals(self):
        stock = self.client.get("/api/v1/reports/stock/").data
        sales = self.client.get("/api/v1/reports/sales/").data
        debts = self.client.get("/api/v1/reports/settlements/").data
        profit = self.client.get("/api/v1/reports/gross-profit/").data
        self.assertEqual(stock["totals"]["quantity"], 8)
        self.assertEqual(stock["totals"]["inventory_value"], 80)
        self.assertEqual(sales["totals"]["revenue"], 40)
        self.assertEqual(debts["totals"]["receivable"], 40)
        self.assertEqual(profit["totals"]["gross_profit"], 20)

