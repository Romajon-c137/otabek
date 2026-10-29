from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from modules.parties.models import Party
from modules.warehouses.models import Warehouse


class FinanceApiTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_superuser("money-owner", "money@example.test", "correct-horse-123")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.warehouse = Warehouse.objects.create(code="MONEY", name="Касса")
        self.party = Party.objects.create(code="M-C", name="Должник", kind=Party.Kind.CUSTOMER)

    def test_manual_debt_and_partial_payment_api(self):
        debt = self.client.post("/api/v1/finance/obligations/", {"warehouse_id": self.warehouse.pk, "party_id": self.party.pk, "side": "receivable", "amount": "125.50", "effective_date": "2026-10-25", "reason": "Перенос долга"}, format="json", HTTP_IDEMPOTENCY_KEY="api-debt")
        self.assertEqual(debt.status_code, 201, debt.data)
        payment = self.client.post("/api/v1/finance/payments/", {"warehouse_id": self.warehouse.pk, "party_id": self.party.pk, "direction": "incoming", "method": "cash", "amount": "25.50", "effective_date": "2026-10-25", "note": "Частично"}, format="json", HTTP_IDEMPOTENCY_KEY="api-payment")
        self.assertEqual(payment.status_code, 201, payment.data)
        open_items = self.client.get(f"/api/v1/finance/obligations/?party={self.party.pk}&open=true")
        self.assertEqual(open_items.status_code, 200)
        self.assertEqual(open_items.data["results"][0]["open_amount"], "100.00")

