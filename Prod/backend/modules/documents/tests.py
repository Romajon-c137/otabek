from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from modules.auditlog.models import AuditRecord
from modules.catalog.models import Product
from modules.common.errors import Conflict, InsufficientStock
from modules.finance.models import Obligation, ObligationSide, Payment
from modules.finance.services import create_obligation
from modules.inventory.models import FifoAllocation, StockLevel, StockLot
from modules.parties.models import Party
from modules.warehouses.models import Warehouse
from .models import DocumentKind, DocumentStatus
from .services import cancel_document, confirm_order, create_document, fulfill_order, post_document, update_document


class DocumentWorkflowTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_superuser("owner", "owner@example.test", "correct-horse-123")
        self.warehouse = Warehouse.objects.create(code="MAIN", name="Основной")
        self.product = Product.objects.create(name="Краска", sku="PAINT-1", purchase_price="60.00", retail_price="100.00", wholesale_price="90.00")
        self.party = Party.objects.create(code="C-001", name="Покупатель", kind=Party.Kind.CUSTOMER)
        self.supplier = Party.objects.create(code="S-NEIGHBOR", name="Поставщик-сосед", kind=Party.Kind.SUPPLIER)

    def document(self, kind, quantity, price, party=None):
        return create_document(actor=self.user, warehouse=self.warehouse, kind=kind, effective_date=date(2026, 10, 25), party=party, lines=[{"product": self.product, "quantity": quantity, "unit_price": price, "discount_amount": "0.00"}])

    def put_stock(self, quantity="10.000", price="60.00"):
        opening = self.document(DocumentKind.OPENING, quantity, price)
        return post_document(actor=self.user, document=opening, idempotency_key=f"opening-{opening.pk}")

    def test_sale_uses_fifo_creates_debt_and_is_idempotent(self):
        self.put_stock("10.000", "60.00")
        sale = self.document(DocumentKind.SALE, "3.000", "100.00", self.party)
        first = post_document(actor=self.user, document=sale, idempotency_key="sale-once")
        second = post_document(actor=self.user, document=sale, idempotency_key="sale-once")
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(StockLevel.objects.get().quantity, Decimal("7.000"))
        self.assertEqual(FifoAllocation.objects.get().quantity, Decimal("3.000"))
        debt = Obligation.objects.get(source_document=sale)
        self.assertEqual(debt.side, ObligationSide.RECEIVABLE)
        self.assertEqual(debt.open_amount, Decimal("300.00"))
        self.assertEqual(AuditRecord.objects.filter(action="document.posted", entity_id=str(sale.pk)).count(), 1)

    def test_draft_update_checks_version_and_recalculates_money(self):
        sale = self.document(DocumentKind.SALE, "2.000", "100.00", self.party)
        updated = update_document(actor=self.user, document=sale, expected_version=1, effective_date=sale.effective_date, party=self.party, note="изменено", lines=[{"product": self.product, "quantity": "2.000", "unit_price": "99.995", "discount_amount": "10.00"}])
        self.assertEqual(updated.amount_total, Decimal("190.00"))
        with self.assertRaises(Conflict):
            update_document(actor=self.user, document=sale, expected_version=1, effective_date=sale.effective_date, party=self.party, lines=[{"product": self.product, "quantity": "1", "unit_price": "1"}])

    def test_sale_without_stock_rolls_back_everything(self):
        sale = self.document(DocumentKind.SALE, "1.000", "100.00", self.party)
        with self.assertRaises(InsufficientStock):
            post_document(actor=self.user, document=sale, idempotency_key="no-stock")
        sale.refresh_from_db()
        self.assertEqual(sale.status, DocumentStatus.DRAFT)
        self.assertFalse(Obligation.objects.exists())

    def test_sale_cancellation_returns_stock_and_reverses_unpaid_debt(self):
        self.put_stock("5.000")
        sale = self.document(DocumentKind.SALE, "2.000", "100.00", self.party)
        post_document(actor=self.user, document=sale, idempotency_key="post-sale")
        cancelled = cancel_document(actor=self.user, document=sale, reason="Ошибка кассира", idempotency_key="cancel-sale")
        self.assertEqual(cancelled.status, DocumentStatus.CANCELLED)
        self.assertEqual(StockLevel.objects.get().quantity, Decimal("5.000"))
        debt = Obligation.objects.get(source_document=sale)
        self.assertEqual(debt.open_amount, Decimal("0.00"))
        self.assertIsNotNone(debt.reversed_at)

    def test_order_reserves_then_fulfils_to_posted_sale(self):
        self.put_stock("5.000")
        order = self.document(DocumentKind.CUSTOMER_ORDER, "3.000", "100.00", self.party)
        confirm_order(actor=self.user, document=order, idempotency_key="confirm-order")
        level = StockLevel.objects.get()
        self.assertEqual((level.quantity, level.reserved), (Decimal("5.000"), Decimal("3.000")))
        sale = fulfill_order(actor=self.user, document=order, idempotency_key="fulfil-order")
        order.refresh_from_db()
        level.refresh_from_db()
        self.assertEqual(order.status, DocumentStatus.FULFILLED)
        self.assertEqual(sale.status, DocumentStatus.POSTED)
        self.assertEqual((level.quantity, level.reserved), (Decimal("2.000"), Decimal("0.000")))

    def test_receipt_extra_cost_is_allocated_to_lot_not_supplier_debt(self):
        supplier = Party.objects.create(code="S-001", name="Поставщик", kind=Party.Kind.SUPPLIER)
        receipt = create_document(
            actor=self.user, warehouse=self.warehouse, kind=DocumentKind.RECEIPT,
            effective_date=date(2026, 10, 25), party=supplier,
            lines=[{"product": self.product, "quantity": "2", "unit_price": "100"}],
            extra_costs=[{"name": "Доставка", "amount": "30.00"}],
        )
        post_document(actor=self.user, document=receipt, idempotency_key="receipt-extra")
        self.assertEqual(StockLot.objects.get(source_line__document=receipt).unit_cost, Decimal("115.000000"))
        self.assertEqual(Obligation.objects.get(source_document=receipt).original_amount, Decimal("200.00"))

    def test_document_discount_is_distributed_exactly(self):
        draft = create_document(
            actor=self.user, warehouse=self.warehouse, kind=DocumentKind.SALE,
            effective_date=date(2026, 10, 25), party=self.party,
            lines=[
                {"product": self.product, "quantity": "1", "unit_price": "100"},
                {"product": self.product, "quantity": "1", "unit_price": "50"},
            ],
            document_discount_amount="10.00",
        )
        self.assertEqual(draft.amount_total, Decimal("140.00"))
        self.assertEqual(sum((line.discount_amount for line in draft.lines.all()), Decimal("0.00")), Decimal("10.00"))

    def test_post_with_partial_payment_is_one_transaction(self):
        self.put_stock("3")
        sale = self.document(DocumentKind.SALE, "2", "100", self.party)
        post_document(actor=self.user, document=sale, idempotency_key="sale-paid", paid_amount=Decimal("75.00"), payment_method=Payment.Method.CASH)
        debt = Obligation.objects.get(source_document=sale)
        self.assertEqual(debt.open_amount, Decimal("125.00"))
        self.assertEqual(Payment.objects.get(source_document=sale).amount, Decimal("75.00"))

    def test_sale_accepts_split_payment_and_leaves_remainder_as_debt(self):
        self.put_stock("3")
        sale = self.document(DocumentKind.SALE, "2", "100", self.party)
        post_document(
            actor=self.user,
            document=sale,
            idempotency_key="sale-split-payment",
            payments=[
                {"method": Payment.Method.CASH, "amount": Decimal("50.00")},
                {"method": Payment.Method.MBANK, "amount": Decimal("70.00")},
            ],
        )
        debt = Obligation.objects.get(source_document=sale)
        self.assertEqual(debt.open_amount, Decimal("80.00"))
        self.assertEqual(
            list(Payment.objects.filter(source_document=sale).order_by("id").values_list("method", "amount")),
            [(Payment.Method.CASH, Decimal("50.00")), (Payment.Method.MBANK, Decimal("70.00"))],
        )

    def test_sale_payment_is_applied_before_offsetting_opposite_debt(self):
        self.put_stock("3")
        create_obligation(
            party=self.party,
            warehouse=self.warehouse,
            side=ObligationSide.PAYABLE,
            amount=Decimal("500.00"),
            effective_date=date(2026, 10, 24),
            actor=self.user,
            reason="Мы должны человеку",
        )
        sale = self.document(DocumentKind.SALE, "2", "100", self.party)

        post_document(
            actor=self.user,
            document=sale,
            idempotency_key="sale-payment-before-offset",
            payments=[{"method": Payment.Method.CASH, "amount": Decimal("75.00")}],
        )

        sale_debt = Obligation.objects.get(source_document=sale)
        old_payable = Obligation.objects.get(side=ObligationSide.PAYABLE)
        self.assertEqual(sale_debt.open_amount, Decimal("0.00"))
        self.assertEqual(old_payable.open_amount, Decimal("375.00"))
        self.assertEqual(Payment.objects.get(source_document=sale).amount, Decimal("75.00"))

    def test_customer_return_restores_original_fifo_cost_and_offsets_debt(self):
        self.put_stock("3", "60")
        sale = self.document(DocumentKind.SALE, "2", "100", self.party)
        post_document(actor=self.user, document=sale, idempotency_key="sale-return-source")
        source_line = sale.lines.get()
        returned = create_document(
            actor=self.user, warehouse=self.warehouse, kind=DocumentKind.CUSTOMER_RETURN,
            effective_date=date(2026, 10, 25), party=self.party,
            lines=[{"product": self.product, "source_line": source_line, "quantity": "1", "unit_price": "100"}],
        )
        post_document(actor=self.user, document=returned, idempotency_key="return-one")
        self.assertEqual(StockLevel.objects.get().quantity, Decimal("2.000"))
        self.assertEqual(StockLot.objects.filter(source_line__document=returned).get().unit_cost, Decimal("60.000000"))
        self.assertEqual(Obligation.objects.get(source_document=sale).open_amount, Decimal("100.00"))
        self.assertEqual(Obligation.objects.get(source_document=returned).open_amount, Decimal("0.00"))

    def test_fully_paid_retail_sale_creates_system_party_without_open_debt(self):
        self.put_stock("1")
        sale = self.document(DocumentKind.SALE, "1", "100", None)
        post_document(actor=self.user, document=sale, idempotency_key="retail-paid", paid_amount=Decimal("100.00"))
        sale.refresh_from_db()
        self.assertEqual(sale.party.system_key, "retail")
        self.assertEqual(Obligation.objects.get(source_document=sale).open_amount, Decimal("0.00"))

    def test_retail_sale_rejects_incomplete_payment(self):
        self.put_stock("1")
        sale = self.document(DocumentKind.SALE, "1", "100", None)
        with self.assertRaises(Conflict):
            post_document(
                actor=self.user,
                document=sale,
                idempotency_key="retail-partial",
                payments=[{"method": Payment.Method.CASH, "amount": Decimal("90.00")}],
            )
        sale.refresh_from_db()
        self.assertEqual(sale.status, DocumentStatus.DRAFT)
        self.assertFalse(Payment.objects.filter(source_document=sale).exists())

    def test_neighbor_supply_uses_only_local_stock_and_creates_supplier_payable(self):
        self.put_stock("2", "60")
        sale = create_document(
            actor=self.user,
            warehouse=self.warehouse,
            kind=DocumentKind.SALE,
            effective_date=date(2026, 10, 25),
            party=self.party,
            lines=[{
                "product": self.product,
                "quantity": "3",
                "unit_price": "100",
                "discount_amount": "15",
                "neighbor_supply": {"supplier": self.supplier, "quantity": "2", "unit_price": "60"},
            }],
        )
        post_document(actor=self.user, document=sale, idempotency_key="neighbor-sale")
        self.assertEqual(StockLevel.objects.get().quantity, Decimal("1.000"))
        customer_debt = Obligation.objects.get(source_document=sale, party=self.party)
        supplier_debt = Obligation.objects.get(source_document=sale, party=self.supplier)
        self.assertEqual((customer_debt.side, customer_debt.original_amount), (ObligationSide.RECEIVABLE, Decimal("285.00")))
        self.assertEqual((supplier_debt.side, supplier_debt.original_amount), (ObligationSide.PAYABLE, Decimal("120.00")))
        self.assertEqual((supplier_debt.product, supplier_debt.original_quantity, supplier_debt.unit_price), (self.product, Decimal("2.000"), Decimal("60.00")))
        cancel_document(actor=self.user, document=sale, reason="Проверка отмены", idempotency_key="cancel-neighbor-sale")
        self.assertEqual(StockLevel.objects.get().quantity, Decimal("2.000"))
        self.assertFalse(Obligation.objects.filter(source_document=sale, reversed_at__isnull=True).exists())

    def test_neighbor_supply_is_carried_from_order_to_fulfilled_sale(self):
        self.put_stock("1", "60")
        order = create_document(
            actor=self.user,
            warehouse=self.warehouse,
            kind=DocumentKind.CUSTOMER_ORDER,
            effective_date=date(2026, 10, 25),
            party=self.party,
            lines=[{
                "product": self.product,
                "quantity": "2",
                "unit_price": "100",
                "neighbor_supply": {"supplier": self.supplier, "quantity": "1", "unit_price": "65"},
            }],
        )
        confirm_order(actor=self.user, document=order, idempotency_key="confirm-neighbor-order")
        sale = fulfill_order(actor=self.user, document=order, idempotency_key="fulfill-neighbor-order")
        supply = sale.lines.get().neighbor_supply
        self.assertEqual((supply.supplier, supply.quantity, supply.amount), (self.supplier, Decimal("1.000"), Decimal("65.00")))
        self.assertEqual(Obligation.objects.get(source_document=sale, party=self.supplier).original_amount, Decimal("65.00"))

