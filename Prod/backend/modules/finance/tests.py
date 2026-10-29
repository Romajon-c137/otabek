from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from modules.catalog.models import Product
from modules.documents.models import DocumentKind
from modules.documents.services import create_document, post_document
from modules.parties.models import Party
from modules.warehouses.models import Warehouse
from .models import Obligation, ObligationSide, Payment
from .services import create_manual_debt, post_payment, void_payment


class SettlementTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_superuser("finance", "finance@example.test", "correct-horse-123")
        self.warehouse = Warehouse.objects.create(code="W1", name="Склад 1")
        self.party = Party.objects.create(code="P1", name="Контрагент", kind=Party.Kind.BOTH)

    def debt(self, amount="150.00"):
        return create_manual_debt(actor=self.user, warehouse=self.warehouse, party=self.party, side=ObligationSide.RECEIVABLE, amount=Decimal(amount), effective_date=date(2026, 10, 25), reason="Начальный долг", idempotency_key=f"debt-{amount}")

    def pay(self, amount, key):
        return post_payment(actor=self.user, warehouse=self.warehouse, party=self.party, direction=Payment.Direction.INCOMING, method=Payment.Method.CASH, amount=Decimal(amount), effective_date=date(2026, 10, 25), note="Оплата", idempotency_key=key)

    def test_partial_payment_and_overpayment_rejection(self):
        debt = self.debt()
        self.pay("50.00", "pay-1")
        debt.refresh_from_db()
        self.assertEqual(debt.open_amount, Decimal("100.00"))
        from modules.common.errors import Conflict
        with self.assertRaises(Conflict):
            self.pay("120.00", "pay-2")
        debt.refresh_from_db()
        self.assertEqual(debt.open_amount, Decimal("100.00"))

    def test_void_payment_restores_debt(self):
        debt = self.debt()
        second = self.pay("50.00", "pay-1")
        void_payment(actor=self.user, payment=second, reason="Ошибочная сумма", idempotency_key="void-2")
        debt.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(second.status, Payment.Status.VOIDED)
        self.assertEqual(debt.open_amount, Decimal("150.00"))

    def test_opposite_manual_debts_offset_fifo(self):
        receivable = self.debt("100.00")
        payable = create_manual_debt(actor=self.user, warehouse=self.warehouse, party=self.party, side=ObligationSide.PAYABLE, amount=Decimal("40.00"), effective_date=date(2026, 10, 26), reason="Встречный долг", idempotency_key="payable-40")
        receivable.refresh_from_db()
        payable.refresh_from_db()
        self.assertEqual(receivable.open_amount, Decimal("60.00"))
        self.assertEqual(payable.open_amount, Decimal("0.00"))

    def test_same_payment_key_does_not_duplicate_cash(self):
        self.debt("50.00")
        first = self.pay("20.00", "payment-repeat")
        second = self.pay("20.00", "payment-repeat")
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(Payment.objects.count(), 1)

    def test_payment_can_be_allocated_to_selected_debt_line(self):
        first = create_manual_debt(actor=self.user, warehouse=self.warehouse, party=self.party, side=ObligationSide.RECEIVABLE, amount=Decimal("80.00"), effective_date=date(2026, 10, 24), reason="Первый", idempotency_key="manual-first")
        second = create_manual_debt(actor=self.user, warehouse=self.warehouse, party=self.party, side=ObligationSide.RECEIVABLE, amount=Decimal("90.00"), effective_date=date(2026, 10, 25), reason="Второй", idempotency_key="manual-second")
        post_payment(actor=self.user, warehouse=self.warehouse, party=self.party, direction=Payment.Direction.INCOMING, method=Payment.Method.CASH, amount=Decimal("30.00"), effective_date=date(2026, 10, 25), note="На второй долг", idempotency_key="allocated-payment", applications=[{"obligation_id": second.pk, "amount": Decimal("30.00")}])
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.open_amount, Decimal("80.00"))
        self.assertEqual(second.open_amount, Decimal("60.00"))

