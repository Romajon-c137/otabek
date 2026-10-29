from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.catalog.models import Product
from apps.documents.models import Document
from apps.partners.models import Counterparty
from apps.settlements.models import Obligation, SettlementMovement
from apps.settlements.reconciliation import verify_settlements
from apps.warehouses.models import Warehouse
from .models import Lot, StockBalance, StockMovement
from .reconciliation import verify_inventory


class LedgerReconciliationTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="rebuild")
        self.warehouse = Warehouse.objects.create(code="VERIFY", name="Проверка")
        self.product = Product.objects.create(code="VERIFY-P", name="Проверка", unit=Product.Unit.PIECE)
        self.cp = Counterparty.objects.create(code="VERIFY-C", name="Проверка")
        self.document = Document.objects.create(
            type=Document.Type.OPENING_STOCK, number="VERIFY-D", status=Document.Status.POSTED,
            warehouse=self.warehouse, author=self.user,
        )

    def test_inventory_reconciliation_detects_balance_damage(self):
        lot = Lot.objects.create(
            warehouse=self.warehouse, product=self.product, source_document=self.document,
            source_line_id=self.document.id, initial_quantity=1, remaining_quantity=1,
            initial_cost=10, remaining_cost=10, unit_cost=10,
            received_at=self.document.created_at,
        )
        StockMovement.objects.create(
            document=self.document, source_line_id=self.document.id,
            warehouse=self.warehouse, product=self.product, lot=lot,
            kind=StockMovement.Kind.OPENING, signed_quantity=1, signed_cost=10,
        )
        balance = StockBalance.objects.create(
            warehouse=self.warehouse, product=self.product, quantity=1, cost=10,
        )
        self.assertEqual(verify_inventory(), [])
        balance.cost = Decimal("9.00"); balance.save(update_fields=["cost"])
        self.assertTrue(verify_inventory())

    def test_settlement_reconciliation_detects_open_amount_damage(self):
        sale = Document.objects.create(
            type=Document.Type.SALE, number="VERIFY-S", status=Document.Status.POSTED,
            warehouse=self.warehouse, counterparty=self.cp, author=self.user,
        )
        obligation = Obligation.objects.create(
            counterparty=self.cp, source_document=sale, side=Obligation.Side.RECEIVABLE,
            original_amount=100, open_amount=100,
        )
        SettlementMovement.objects.create(
            document=sale, counterparty=self.cp, obligation=obligation, signed_amount=100,
        )
        self.assertEqual(verify_settlements(), [])
        obligation.open_amount = Decimal("99.00"); obligation.save(update_fields=["open_amount"])
        self.assertTrue(verify_settlements())
