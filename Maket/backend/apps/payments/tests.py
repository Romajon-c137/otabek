from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from apps.documents.models import Document
from apps.partners.models import Counterparty
from apps.settlements.models import Obligation, SettlementAllocation, SettlementMovement
from apps.settlements.services import apply_auto_offset
from apps.warehouses.models import Warehouse, WarehouseAccess


class PaymentPostingTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="cashier", password="test")
        self.warehouse = Warehouse.objects.create(code="CASH", name="Касса")
        WarehouseAccess.objects.create(user=self.user, warehouse=self.warehouse, role=WarehouseAccess.Role.SELLER)
        self.counterparty = Counterparty.objects.create(code="PAY-CP", name="Клиент оплаты")
        self.client.force_authenticate(self.user)

    def obligation(self, number, amount, side=Obligation.Side.RECEIVABLE):
        source = Document.objects.create(
            type=Document.Type.SALE if side == Obligation.Side.RECEIVABLE else Document.Type.RECEIPT,
            number=number, status=Document.Status.POSTED, version=2,
            warehouse=self.warehouse, counterparty=self.counterparty, author=self.user,
        )
        return Obligation.objects.create(
            counterparty=self.counterparty, source_document=source, side=side,
            original_amount=amount, open_amount=amount,
        )

    def create_payment(self, number="PAY-1", amount="1000.00"):
        response = self.client.post("/api/v1/payments/", {
            "number": number,
            "counterparty": str(self.counterparty.id),
            "direction": "incoming",
            "amount": amount,
            "breakdown": [
                {"method": "cash", "amount": "500.00"},
                {"method": "mbank", "amount": str(Decimal(amount) - Decimal("500.00"))},
            ],
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        return response

    def test_payment_closes_selected_obligations_and_keeps_method_details(self):
        first = self.obligation("SALE-P1", Decimal("600.00"))
        second = self.obligation("SALE-P2", Decimal("400.00"))
        payment = self.create_payment()
        posted = self.client.post(
            f"/api/v1/payments/{payment.data['id']}/post/",
            {"version": 1, "allocations": [
                {"obligation": str(first.id), "amount": "600.00"},
                {"obligation": str(second.id), "amount": "400.00"},
            ]}, format="json", HTTP_IDEMPOTENCY_KEY="payment-1",
        )
        self.assertEqual(posted.status_code, status.HTTP_200_OK, posted.data)
        first.refresh_from_db(); second.refresh_from_db()
        self.assertEqual(first.open_amount, Decimal("0.00"))
        self.assertEqual(second.open_amount, Decimal("0.00"))
        self.assertEqual(SettlementAllocation.objects.filter(kind="payment").count(), 2)
        self.assertEqual(sum(
            (item.signed_amount for item in SettlementMovement.objects.filter(document_id=payment.data["id"])),
            Decimal("0.00"),
        ), Decimal("-1000.00"))

    def test_overpayment_is_rejected_without_partial_allocation(self):
        obligation = self.obligation("SALE-SMALL", Decimal("900.00"))
        payment = self.create_payment(number="PAY-OVER")
        response = self.client.post(
            f"/api/v1/payments/{payment.data['id']}/post/",
            {"version": 1}, format="json", HTTP_IDEMPOTENCY_KEY="payment-over",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        obligation.refresh_from_db()
        self.assertEqual(obligation.open_amount, Decimal("900.00"))
        self.assertEqual(SettlementAllocation.objects.count(), 0)

    def test_auto_offset_keeps_net_balance_and_closes_oldest_opposite_debt(self):
        receivable = self.obligation("SALE-OFFSET", Decimal("10000.00"))
        payable = self.obligation("RECEIPT-OFFSET", Decimal("4000.00"), Obligation.Side.PAYABLE)
        offset = apply_auto_offset(
            counterparty=self.counterparty, trigger_document=payable.source_document, actor=self.user,
        )
        self.assertIsNotNone(offset)
        receivable.refresh_from_db(); payable.refresh_from_db()
        self.assertEqual(receivable.open_amount, Decimal("6000.00"))
        self.assertEqual(payable.open_amount, Decimal("0.00"))
        movements = SettlementMovement.objects.filter(document=offset)
        self.assertEqual(sum((item.signed_amount for item in movements), Decimal("0.00")), Decimal("0.00"))
        self.assertEqual(SettlementAllocation.objects.filter(source_document=offset).count(), 2)
