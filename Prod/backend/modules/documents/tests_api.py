from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from modules.catalog.models import Product
from modules.documents.models import DocumentKind, DocumentStatus
from modules.documents.services import create_document, post_document
from modules.finance.models import Obligation, Payment
from modules.parties.models import Party
from modules.warehouses.models import Warehouse


class DocumentApiTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_superuser("api-owner", "api@example.test", "correct-horse-123")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.warehouse = Warehouse.objects.create(code="API", name="API склад")
        self.product = Product.objects.create(name="API товар", sku="API-1", purchase_price="10", retail_price="20")
        self.party = Party.objects.create(code="API-C", name="API покупатель", kind=Party.Kind.CUSTOMER)
        self.supplier = Party.objects.create(code="API-S", name="API сосед", kind=Party.Kind.SUPPLIER)
        opening = create_document(actor=self.user, warehouse=self.warehouse, kind=DocumentKind.OPENING, effective_date=date(2026, 10, 25), lines=[{"product": self.product, "quantity": "5", "unit_price": "10"}])
        post_document(actor=self.user, document=opening, idempotency_key="api-opening")

    def payload(self):
        return {
            "kind": "sale",
            "warehouse_id": self.warehouse.pk,
            "party_id": self.party.pk,
            "effective_date": "2026-10-25",
            "note": "API scenario",
            "lines": [{"product_id": self.product.pk, "quantity": "2.000", "unit_price": "20.00", "discount_amount": "1.00"}],
        }

    def test_create_update_post_and_replay_through_real_routes(self):
        created = self.client.post("/api/v1/documents/", self.payload(), format="json")
        self.assertEqual(created.status_code, 201, created.data)
        document_id = created.data["id"]
        changed = self.payload() | {"version": created.data["version"], "note": "updated"}
        updated = self.client.put(f"/api/v1/documents/{document_id}/", changed, format="json")
        self.assertEqual(updated.status_code, 200, updated.data)
        headers = {"HTTP_IDEMPOTENCY_KEY": "api-post-sale"}
        posted = self.client.post(f"/api/v1/documents/{document_id}/post/", {}, format="json", **headers)
        replay = self.client.post(f"/api/v1/documents/{document_id}/post/", {}, format="json", **headers)
        self.assertEqual(posted.status_code, 200, posted.data)
        self.assertEqual(replay.status_code, 200, replay.data)
        self.assertEqual(posted.data["status"], DocumentStatus.POSTED)
        self.assertEqual(posted.data["amount_total"], "39.00")

    def test_post_requires_idempotency_key(self):
        created = self.client.post("/api/v1/documents/", self.payload(), format="json")
        response = self.client.post(f"/api/v1/documents/{created.data['id']}/post/", {}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.data)

    def test_post_accepts_cash_and_mbank_in_one_sale(self):
        created = self.client.post("/api/v1/documents/", self.payload(), format="json")
        response = self.client.post(
            f"/api/v1/documents/{created.data['id']}/post/",
            {"payments": [
                {"method": "cash", "amount": "10.00"},
                {"method": "mbank", "amount": "20.00"},
            ]},
            format="json",
            HTTP_IDEMPOTENCY_KEY="api-split-payment",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Obligation.objects.get(source_document_id=created.data["id"]).open_amount, Decimal("9.00"))
        self.assertEqual(
            set(Payment.objects.filter(source_document_id=created.data["id"]).values_list("method", "amount")),
            {("cash", Decimal("10.00")), ("mbank", Decimal("20.00"))},
        )

    def test_update_requires_version_and_draft_can_be_deleted(self):
        created = self.client.post("/api/v1/documents/", self.payload(), format="json")
        document_id = created.data["id"]
        missing_version = self.client.put(f"/api/v1/documents/{document_id}/", self.payload(), format="json")
        self.assertEqual(missing_version.status_code, 400)
        deleted = self.client.delete(f"/api/v1/documents/{document_id}/")
        self.assertEqual(deleted.status_code, 204)
        self.assertFalse(self.client.get(f"/api/v1/documents/{document_id}/").status_code == 200)

    def test_list_supports_multiple_kinds_and_real_pagination(self):
        created = self.client.post("/api/v1/documents/", self.payload(), format="json")
        self.assertEqual(created.status_code, 201, created.data)
        response = self.client.get(
            f"/api/v1/documents/?warehouse={self.warehouse.pk}&kind=opening,sale&page_size=1&page=1"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 2)
        self.assertEqual(response.data["pages"], 2)
        self.assertEqual(len(response.data["results"]), 1)

    def test_api_persists_neighbor_terms_in_line(self):
        payload = self.payload()
        payload["lines"][0]["neighbor_supply"] = {
            "supplier_id": self.party.pk,
            "quantity": "1.000",
            "unit_price": "12.50",
        }
        created = self.client.post("/api/v1/documents/", payload, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data["lines"][0]["neighbor_supply"]["supplier_id"], self.party.pk)
        self.assertEqual(created.data["lines"][0]["neighbor_supply"]["amount"], "12.50")

