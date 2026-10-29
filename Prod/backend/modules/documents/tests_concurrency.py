import threading
from datetime import date

from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection, connections
from django.test import TransactionTestCase, skipUnlessDBFeature

from modules.catalog.models import Product
from modules.common.errors import Conflict, InsufficientStock
from modules.inventory.models import StockLevel
from modules.finance.models import Obligation, ObligationSide
from modules.finance.services import create_manual_debt
from modules.parties.models import Party
from modules.warehouses.models import Warehouse
from .models import DocumentKind, DocumentStatus, TradeDocument
from .services import create_document, post_document


class ConcurrentSaleTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        if connection.vendor != "postgresql":
            self.skipTest("Проверка блокировок выполняется только на PostgreSQL.")
        self.user = get_user_model().objects.create_superuser("race", "race@example.test", "correct-horse-123")
        self.warehouse = Warehouse.objects.create(code="RACE", name="Конкурентный")
        self.product = Product.objects.create(name="Последний товар", sku="LAST", purchase_price="10", retail_price="20")
        self.party = Party.objects.create(code="RACE-C", name="Покупатель", kind=Party.Kind.CUSTOMER)
        opening = create_document(actor=self.user, warehouse=self.warehouse, kind=DocumentKind.OPENING, effective_date=date.today(), lines=[{"product": self.product, "quantity": "1", "unit_price": "10"}])
        post_document(actor=self.user, document=opening, idempotency_key="race-opening")
        self.sales = [create_document(actor=self.user, warehouse=self.warehouse, kind=DocumentKind.SALE, effective_date=date.today(), party=self.party, lines=[{"product": self.product, "quantity": "1", "unit_price": "20"}]) for _ in range(2)]

    def test_only_one_concurrent_sale_can_consume_last_unit(self):
        barrier = threading.Barrier(2)
        outcomes = []

        def worker(document_id, index):
            close_old_connections()
            try:
                actor = get_user_model().objects.get(pk=self.user.pk)
                document = TradeDocument.objects.get(pk=document_id)
                barrier.wait(timeout=5)
                post_document(actor=actor, document=document, idempotency_key=f"race-sale-{index}")
                outcomes.append("posted")
            except InsufficientStock:
                outcomes.append("rejected")
            finally:
                # Connections are thread-local and CONN_MAX_AGE is enabled in
                # production settings; close explicitly so the test database
                # can be dropped after both workers finish.
                connections.close_all()

        threads = [threading.Thread(target=worker, args=(sale.pk, i)) for i, sale in enumerate(self.sales)]
        for thread in threads: thread.start()
        for thread in threads: thread.join(timeout=10)
        self.assertCountEqual(outcomes, ["posted", "rejected"])
        self.assertEqual(TradeDocument.objects.filter(pk__in=[s.pk for s in self.sales], status=DocumentStatus.POSTED).count(), 1)
        self.assertEqual(StockLevel.objects.get().quantity, 0)

    def test_only_one_concurrent_return_can_consume_source_line(self):
        sale = self.sales[0]
        post_document(actor=self.user, document=sale, idempotency_key="return-source-sale")
        source_line = sale.lines.get()
        returns = [
            create_document(
                actor=self.user,
                warehouse=self.warehouse,
                kind=DocumentKind.CUSTOMER_RETURN,
                effective_date=date.today(),
                party=self.party,
                lines=[{
                    "product": self.product,
                    "source_line": source_line,
                    "quantity": "1",
                    "unit_price": "20",
                }],
            )
            for _ in range(2)
        ]
        barrier = threading.Barrier(2)
        outcomes = []

        def worker(document_id, index):
            close_old_connections()
            try:
                actor = get_user_model().objects.get(pk=self.user.pk)
                document = TradeDocument.objects.get(pk=document_id)
                barrier.wait(timeout=5)
                post_document(actor=actor, document=document, idempotency_key=f"race-return-{index}")
                outcomes.append("posted")
            except Conflict:
                outcomes.append("rejected")
            finally:
                connections.close_all()

        threads = [threading.Thread(target=worker, args=(document.pk, index)) for index, document in enumerate(returns)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)

        self.assertCountEqual(outcomes, ["posted", "rejected"])
        self.assertEqual(TradeDocument.objects.filter(pk__in=[item.pk for item in returns], status=DocumentStatus.POSTED).count(), 1)
        self.assertEqual(StockLevel.objects.get().quantity, 1)

    def test_concurrent_opposite_debts_are_fully_offset(self):
        barrier = threading.Barrier(2)
        outcomes = []

        def worker(side, index):
            close_old_connections()
            try:
                actor = get_user_model().objects.get(pk=self.user.pk)
                warehouse = Warehouse.objects.get(pk=self.warehouse.pk)
                party = Party.objects.get(pk=self.party.pk)
                barrier.wait(timeout=5)
                create_manual_debt(
                    actor=actor,
                    warehouse=warehouse,
                    party=party,
                    side=side,
                    amount="10.00",
                    effective_date=date.today(),
                    reason="Конкурентный взаимозачёт",
                    idempotency_key=f"race-offset-{index}",
                )
                outcomes.append("created")
            finally:
                connections.close_all()

        threads = [
            threading.Thread(target=worker, args=(ObligationSide.RECEIVABLE, 0)),
            threading.Thread(target=worker, args=(ObligationSide.PAYABLE, 1)),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)

        self.assertCountEqual(outcomes, ["created", "created"])
        self.assertFalse(Obligation.objects.filter(party=self.party, open_amount__gt=0).exists())

