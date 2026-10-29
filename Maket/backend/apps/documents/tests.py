from django.contrib.auth import get_user_model
from decimal import Decimal
from unittest.mock import patch

from rest_framework import status
from rest_framework.test import APITestCase

from apps.catalog.models import Product
from apps.inventory.models import FifoAllocation, Lot, ReturnLotAllocation, StockBalance, StockMovement
from apps.inventory.models import Reservation
from apps.partners.models import Counterparty
from apps.payments.models import Payment, PaymentBreakdown
from apps.settlements.models import Obligation, SettlementMovement
from apps.warehouses.models import Warehouse, WarehouseAccess
from .models import CommandResult, Document, ReceiptLine


class DocumentLifecycleTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="seller", password="test")
        self.warehouse = Warehouse.objects.create(code="MAIN", name="Основной склад")
        WarehouseAccess.objects.create(user=self.user, warehouse=self.warehouse, role=WarehouseAccess.Role.SELLER)
        self.cp = Counterparty.objects.get(system_key=Counterparty.RETAIL_SYSTEM_KEY)
        self.client.force_authenticate(self.user)

    def test_draft_requires_matching_version(self):
        response = self.client.post("/api/v1/documents/", {
            "type": "sale", "number": "SALE-0001", "warehouse": str(self.warehouse.id),
            "counterparty": str(self.cp.id), "version": 1,
        })
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        self.assertFalse(Document.objects.filter(number="SALE-0001").exists())

    def test_posted_document_cannot_be_deleted(self):
        document = Document.objects.create(
            type=Document.Type.SALE, number="SALE-0002", status=Document.Status.POSTED,
            warehouse=self.warehouse, counterparty=self.cp, author=self.user,
        )
        response = self.client.delete(f"/api/v1/documents/{document.id}/")
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        self.assertTrue(Document.objects.filter(pk=document.pk).exists())


class OpeningStockTests(APITestCase):
    def setUp(self):
        self.admin_user = get_user_model().objects.create_user(username="stock-admin", password="test")
        self.seller = get_user_model().objects.create_user(username="stock-seller", password="test")
        self.warehouse = Warehouse.objects.create(code="OPEN", name="Начальный склад")
        WarehouseAccess.objects.create(user=self.admin_user, warehouse=self.warehouse, role=WarehouseAccess.Role.ADMIN)
        WarehouseAccess.objects.create(user=self.seller, warehouse=self.warehouse, role=WarehouseAccess.Role.SELLER)
        self.product = Product.objects.create(code="OPEN-1", name="Начальный товар", unit=Product.Unit.PIECE)

    def payload(self):
        return {
            "number": "OPEN-0001", "warehouse": str(self.warehouse.id),
            "reason": "Ввод при запуске системы",
            "lines": [{"product": str(self.product.id), "quantity": "5.000", "unit_cost": "12.50"}],
        }

    def test_admin_posts_opening_stock_without_counterparty_debt(self):
        self.client.force_authenticate(self.admin_user)
        created = self.client.post("/api/v1/opening-stocks/", self.payload(), format="json")
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        self.assertEqual(StockBalance.objects.count(), 0)
        posted = self.client.post(
            f"/api/v1/opening-stocks/{created.data['id']}/post/", {"version": 1},
            format="json", HTTP_IDEMPOTENCY_KEY="opening-1",
        )
        self.assertEqual(posted.status_code, status.HTTP_200_OK, posted.data)
        self.assertEqual(posted.data["totals"]["cost"], "62.50")
        self.assertEqual(StockBalance.objects.get(product=self.product).quantity, Decimal("5.000"))
        self.assertEqual(Obligation.objects.count(), 0)
        repeated = self.client.post(
            f"/api/v1/opening-stocks/{created.data['id']}/post/", {"version": 1},
            format="json", HTTP_IDEMPOTENCY_KEY="opening-1",
        )
        self.assertEqual(repeated.data, posted.data)
        self.assertEqual(StockMovement.objects.filter(kind=StockMovement.Kind.OPENING).count(), 1)

    def test_seller_cannot_create_opening_stock(self):
        self.client.force_authenticate(self.seller)
        response = self.client.post("/api/v1/opening-stocks/", self.payload(), format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(Document.objects.filter(type=Document.Type.OPENING_STOCK).exists())


class ReceiptPostingTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="receipt-seller", password="test")
        self.warehouse = Warehouse.objects.create(code="RECEIPT", name="Склад поступлений")
        WarehouseAccess.objects.create(user=self.user, warehouse=self.warehouse, role=WarehouseAccess.Role.SELLER)
        self.supplier = Counterparty.objects.create(code="SUP-1", name="Поставщик")
        self.first = Product.objects.create(code="P-1", name="Товар 1", unit=Product.Unit.PIECE)
        self.second = Product.objects.create(code="P-2", name="Товар 2", unit=Product.Unit.KILOGRAM)
        self.client.force_authenticate(self.user)

    def create_receipt(self, *, first_price="100.00", second_price="300.00", extra="1.00"):
        response = self.client.post("/api/v1/receipts/", {
            "number": "RCPT-0001",
            "warehouse": str(self.warehouse.id),
            "counterparty": str(self.supplier.id),
            "lines": [
                {"product": str(self.first.id), "quantity": "1.000", "price": first_price},
                {"product": str(self.second.id), "quantity": "1.000", "price": second_price},
            ],
            "extra_costs": [{"name": "Доставка", "amount": extra}],
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        return response

    def post_receipt(self, receipt_id, version=1, key="receipt-command-1"):
        return self.client.post(
            f"/api/v1/receipts/{receipt_id}/post/", {"version": version}, format="json",
            HTTP_IDEMPOTENCY_KEY=key,
        )

    def test_draft_can_be_replaced_with_version_check_and_deleted(self):
        created = self.create_receipt()
        changed = self.client.patch(f"/api/v1/receipts/{created.data['id']}/", {
            "version": 1,
            "reason": "Исправленный черновик",
            "lines": [{"product": str(self.first.id), "quantity": "3.000", "price": "77.00"}],
            "extra_costs": [],
        }, format="json")
        self.assertEqual(changed.status_code, status.HTTP_200_OK, changed.data)
        document = Document.objects.get(pk=created.data["id"])
        self.assertEqual(document.version, 2)
        self.assertEqual(document.reason, "Исправленный черновик")
        self.assertEqual(ReceiptLine.objects.get(receipt_id=document.id).goods_amount, Decimal("231.00"))

        conflict = self.client.patch(f"/api/v1/receipts/{created.data['id']}/", {
            "version": 1, "reason": "Устаревшая копия",
        }, format="json")
        self.assertEqual(conflict.status_code, status.HTTP_409_CONFLICT)
        deleted = self.client.delete(f"/api/v1/receipts/{created.data['id']}/")
        self.assertEqual(deleted.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Document.objects.filter(pk=created.data["id"]).exists())

    def test_post_receipt_allocates_expenses_and_creates_stock_and_payable(self):
        created = self.create_receipt()
        posted = self.post_receipt(created.data["id"])
        self.assertEqual(posted.status_code, status.HTTP_200_OK, posted.data)
        self.assertEqual(posted.data["totals"], {
            "goods": "400.00", "extra_costs": "1.00", "inventory_cost": "401.00",
        })

        lines = list(ReceiptLine.objects.order_by("position"))
        self.assertEqual([line.allocated_extra_cost for line in lines], [Decimal("0.25"), Decimal("0.75")])
        self.assertEqual(StockBalance.objects.get(product=self.first).cost, Decimal("100.25"))
        self.assertEqual(StockBalance.objects.get(product=self.second).cost, Decimal("300.75"))
        self.assertEqual(Lot.objects.count(), 2)
        self.assertEqual(StockMovement.objects.count(), 2)
        obligation = Obligation.objects.get()
        self.assertEqual(obligation.side, Obligation.Side.PAYABLE)
        self.assertEqual(obligation.original_amount, Decimal("400.00"))
        self.assertEqual(SettlementMovement.objects.get().signed_amount, Decimal("-400.00"))

    def test_same_command_is_idempotent_and_changed_payload_conflicts(self):
        created = self.create_receipt()
        first = self.post_receipt(created.data["id"])
        repeated = self.post_receipt(created.data["id"])
        self.assertEqual(repeated.status_code, status.HTTP_200_OK)
        self.assertEqual(repeated.data, first.data)
        self.assertEqual(StockMovement.objects.count(), 2)
        self.assertEqual(CommandResult.objects.count(), 1)

        conflict = self.post_receipt(created.data["id"], version=2)
        self.assertEqual(conflict.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(StockMovement.objects.count(), 2)

    def test_piece_quantity_must_be_whole(self):
        response = self.client.post("/api/v1/receipts/", {
            "number": "RCPT-FRACTION",
            "warehouse": str(self.warehouse.id),
            "counterparty": str(self.supplier.id),
            "lines": [{"product": str(self.first.id), "quantity": "1.500", "price": "10.00"}],
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Document.objects.filter(number="RCPT-FRACTION").count(), 0)

    def test_positive_expense_with_zero_goods_value_is_rejected_without_movements(self):
        created = self.create_receipt(first_price="0.00", second_price="0.00", extra="10.00")
        response = self.post_receipt(created.data["id"])
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(StockMovement.objects.count(), 0)
        self.assertEqual(StockBalance.objects.count(), 0)
        self.assertEqual(Obligation.objects.count(), 0)

    def test_failure_rolls_back_all_posting_changes(self):
        created = self.create_receipt()
        with patch("apps.documents.services.SettlementMovement.objects.create", side_effect=RuntimeError("failure")):
            with self.assertRaises(RuntimeError):
                self.post_receipt(created.data["id"])
        self.assertEqual(StockMovement.objects.count(), 0)
        self.assertEqual(StockBalance.objects.count(), 0)
        self.assertEqual(Lot.objects.count(), 0)
        self.assertEqual(Obligation.objects.count(), 0)
        document = Document.objects.get(pk=created.data["id"])
        self.assertEqual(document.status, Document.Status.DRAFT)

    def test_supplier_return_reduces_payable_and_writes_off_actual_cost(self):
        created = self.create_receipt()
        self.post_receipt(created.data["id"])
        returned = self.client.post("/api/v1/supplier-returns/", {
            "number": "SUP-RETURN-1", "source_receipt": created.data["id"],
            "warehouse": str(self.warehouse.id), "reason": "Возврат поставщику",
            "lines": [{"source_line": created.data["lines"][0]["id"], "quantity": "1.000"}],
        }, format="json")
        self.assertEqual(returned.status_code, status.HTTP_201_CREATED, returned.data)
        result = self.client.post(
            f"/api/v1/supplier-returns/{returned.data['id']}/post/", {"version": 1},
            format="json", HTTP_IDEMPOTENCY_KEY="supplier-return-1",
        )
        self.assertEqual(result.status_code, status.HTTP_200_OK, result.data)
        self.assertEqual(result.data["totals"], {"amount": "100.00", "cost": "100.25", "receivable": "0.00"})
        payable = Obligation.objects.get(source_document_id=created.data["id"])
        self.assertEqual(payable.open_amount, Decimal("300.00"))
        self.assertEqual(StockBalance.objects.get(product=self.first).quantity, Decimal("0.000"))

    def test_supplier_return_goods_plus_money_closes_debt_atomically(self):
        receipt = self.client.post("/api/v1/receipts/", {
            "number": "RCPT-MIXED", "warehouse": str(self.warehouse.id),
            "counterparty": str(self.supplier.id),
            "lines": [{"product": str(self.first.id), "quantity": "10.000", "price": "100.00"}],
        }, format="json")
        self.post_receipt(receipt.data["id"], key="mixed-receipt")
        returned = self.client.post("/api/v1/supplier-returns/", {
            "number": "SUP-RETURN-MIXED", "source_receipt": receipt.data["id"],
            "warehouse": str(self.warehouse.id), "reason": "Товар и деньги",
            "lines": [{"source_line": receipt.data["lines"][0]["id"], "quantity": "5.000"}],
        }, format="json")
        result = self.client.post(
            f"/api/v1/supplier-returns/{returned.data['id']}/post-with-payment/",
            {"version": 1, "breakdown": [{"method": "cash", "amount": "500.00"}]},
            format="json", HTTP_IDEMPOTENCY_KEY="mixed-settlement",
        )
        self.assertEqual(result.status_code, status.HTTP_200_OK, result.data)
        payable = Obligation.objects.get(source_document_id=receipt.data["id"])
        self.assertEqual(payable.open_amount, Decimal("0.00"))
        self.assertEqual(StockBalance.objects.get(product=self.first).quantity, Decimal("5.000"))
        self.assertEqual(result.data["payment"]["amount"], "500.00")


class SaleFifoTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="sale-seller", password="test")
        self.warehouse = Warehouse.objects.create(code="SALE", name="Склад продаж")
        WarehouseAccess.objects.create(user=self.user, warehouse=self.warehouse, role=WarehouseAccess.Role.SELLER)
        self.supplier = Counterparty.objects.create(code="SUP-SALE", name="Поставщик продажи")
        self.customer = Counterparty.objects.create(code="BUYER-1", name="Покупатель")
        self.retail = Counterparty.objects.get(system_key=Counterparty.RETAIL_SYSTEM_KEY)
        self.product = Product.objects.create(code="FIFO-1", name="FIFO товар", unit=Product.Unit.PIECE)
        self.client.force_authenticate(self.user)
        self._post_receipt("FIFO-R1", "10.000", "100.00", "fifo-receipt-1")
        self._post_receipt("FIFO-R2", "10.000", "120.00", "fifo-receipt-2")

    def _post_receipt(self, number, quantity, price, key):
        created = self.client.post("/api/v1/receipts/", {
            "number": number,
            "warehouse": str(self.warehouse.id),
            "counterparty": str(self.supplier.id),
            "lines": [{"product": str(self.product.id), "quantity": quantity, "price": price}],
        }, format="json")
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        posted = self.client.post(
            f"/api/v1/receipts/{created.data['id']}/post/", {"version": 1}, format="json",
            HTTP_IDEMPOTENCY_KEY=key,
        )
        self.assertEqual(posted.status_code, status.HTTP_200_OK, posted.data)

    def _create_sale(self, number, lines, counterparty=None):
        return self.client.post("/api/v1/sales/", {
            "number": number,
            "warehouse": str(self.warehouse.id),
            "counterparty": str((counterparty or self.customer).id),
            "lines": lines,
        }, format="json")

    def _post_sale(self, sale_id, key, version=1):
        return self.client.post(
            f"/api/v1/sales/{sale_id}/post/", {"version": version}, format="json",
            HTTP_IDEMPOTENCY_KEY=key,
        )

    def test_fifo_10_at_100_plus_10_at_120_sale_12_costs_1240(self):
        created = self._create_sale("SALE-FIFO", [
            {"product": str(self.product.id), "quantity": "12.000", "price": "200.00", "discount": "0.00"},
        ])
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        posted = self._post_sale(created.data["id"], "sale-fifo")
        self.assertEqual(posted.status_code, status.HTTP_200_OK, posted.data)
        self.assertEqual(posted.data["totals"], {
            "amount": "2400.00", "cost": "1240.00", "gross_profit": "1160.00",
        })
        allocations = list(FifoAllocation.objects.order_by("ordinal"))
        self.assertEqual([item.quantity for item in allocations], [Decimal("10.000"), Decimal("2.000")])
        self.assertEqual([item.cost for item in allocations], [Decimal("1000.00"), Decimal("240.00")])
        balance = StockBalance.objects.get(warehouse=self.warehouse, product=self.product)
        self.assertEqual(balance.quantity, Decimal("8.000"))
        self.assertEqual(balance.cost, Decimal("960.00"))
        debt = Obligation.objects.get(source_document_id=created.data["id"])
        self.assertEqual(debt.side, Obligation.Side.RECEIVABLE)
        self.assertEqual(debt.open_amount, Decimal("2400.00"))

    def test_shortage_and_duplicate_product_rows_do_not_partially_write_off(self):
        created = self._create_sale("SALE-SHORT", [
            {"product": str(self.product.id), "quantity": "11.000", "price": "200.00"},
            {"product": str(self.product.id), "quantity": "10.000", "price": "200.00"},
        ])
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        before_movements = StockMovement.objects.count()
        response = self._post_sale(created.data["id"], "sale-short")
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data["code"], "INSUFFICIENT_STOCK")
        self.assertEqual(response.data["requested"], "21.000")
        self.assertEqual(StockMovement.objects.count(), before_movements)
        self.assertEqual(FifoAllocation.objects.count(), 0)
        self.assertEqual(StockBalance.objects.get(product=self.product).quantity, Decimal("20.000"))

    def test_otabek_catalog_sale_does_not_require_on_hand_stock(self):
        catalog_product = Product.objects.create(
            code="OTABEK-1", name="Каталожный товар", variant_name="Большой",
            external_product_id=900, external_size_id=901, unit=Product.Unit.PIECE,
        )
        created = self._create_sale("SALE-CATALOG", [
            {"product": str(catalog_product.id), "quantity": "999.000", "price": "25.00"},
        ])
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        posted = self._post_sale(created.data["id"], "sale-catalog")
        self.assertEqual(posted.status_code, status.HTTP_200_OK, posted.data)
        self.assertEqual(posted.data["totals"]["cost"], "0.00")
        self.assertFalse(StockMovement.objects.filter(document_id=created.data["id"]).exists())

    def test_system_retail_customer_requires_full_payment(self):
        created = self._create_sale("SALE-RETAIL", [
            {"product": str(self.product.id), "quantity": "1.000", "price": "200.00"},
        ], counterparty=self.retail)
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        response = self._post_sale(created.data["id"], "sale-retail")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(FifoAllocation.objects.count(), 0)

    def test_system_retail_sale_posts_atomically_with_full_payment(self):
        created = self._create_sale("SALE-RETAIL-PAID", [
            {"product": str(self.product.id), "quantity": "2.000", "price": "200.00", "discount": "20.00"},
        ], counterparty=self.retail)
        response = self.client.post(
            f"/api/v1/sales/{created.data['id']}/post-with-payment/",
            {"version": 1, "breakdown": [
                {"method": "cash", "amount": "180.00"},
                {"method": "mbank", "amount": "200.00"},
            ]}, format="json", HTTP_IDEMPOTENCY_KEY="retail-paid",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["totals"]["amount"], "380.00")
        self.assertEqual(response.data["payment"]["amount"], "380.00")
        obligation = Obligation.objects.get(source_document_id=created.data["id"])
        self.assertEqual(obligation.open_amount, Decimal("0.00"))
        payment = Payment.objects.get()
        self.assertEqual(payment.document.status, Document.Status.POSTED)
        self.assertEqual(PaymentBreakdown.objects.filter(payment=payment).count(), 2)

    def test_sale_with_wrong_payment_total_rolls_back(self):
        created = self._create_sale("SALE-WRONG-PAY", [
            {"product": str(self.product.id), "quantity": "1.000", "price": "200.00"},
        ], counterparty=self.retail)
        response = self.client.post(
            f"/api/v1/sales/{created.data['id']}/post-with-payment/",
            {"version": 1, "breakdown": [{"method": "cash", "amount": "199.00"}]},
            format="json", HTTP_IDEMPOTENCY_KEY="wrong-payment",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Payment.objects.count(), 0)
        self.assertEqual(FifoAllocation.objects.count(), 0)
        self.assertEqual(StockBalance.objects.get(product=self.product).quantity, Decimal("20.000"))

    def test_sale_posting_is_idempotent(self):
        created = self._create_sale("SALE-IDEMPOTENT", [
            {"product": str(self.product.id), "quantity": "1.000", "price": "200.00"},
        ])
        first = self._post_sale(created.data["id"], "sale-idempotent")
        repeated = self._post_sale(created.data["id"], "sale-idempotent")
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(repeated.data, first.data)
        self.assertEqual(FifoAllocation.objects.count(), 1)

    def test_buyer_return_restores_original_allocations_in_reverse_fifo_order(self):
        created = self._create_sale("SALE-RETURN", [
            {"product": str(self.product.id), "quantity": "12.000", "price": "200.00"},
        ])
        posted = self._post_sale(created.data["id"], "sale-return-source")
        self.assertEqual(posted.status_code, status.HTTP_200_OK)
        source_line_id = created.data["lines"][0]["id"]
        returned = self.client.post("/api/v1/buyer-returns/", {
            "number": "RETURN-1", "source_sale": created.data["id"],
            "warehouse": str(self.warehouse.id), "reason": "Возврат клиента",
            "lines": [{"source_line": source_line_id, "quantity": "5.000"}],
        }, format="json")
        self.assertEqual(returned.status_code, status.HTTP_201_CREATED, returned.data)
        result = self.client.post(
            f"/api/v1/buyer-returns/{returned.data['id']}/post/", {"version": 1},
            format="json", HTTP_IDEMPOTENCY_KEY="buyer-return-1",
        )
        self.assertEqual(result.status_code, status.HTTP_200_OK, result.data)
        self.assertEqual(result.data["totals"], {"amount": "1000.00", "cost": "540.00", "refund_due": "0.00"})
        restored = list(ReturnLotAllocation.objects.order_by("ordinal"))
        self.assertEqual([item.quantity for item in restored], [Decimal("2.000"), Decimal("3.000")])
        self.assertEqual([item.cost for item in restored], [Decimal("240.00"), Decimal("300.00")])
        self.assertEqual(StockBalance.objects.get(product=self.product).quantity, Decimal("13.000"))
        sale_debt = Obligation.objects.get(source_document_id=created.data["id"])
        self.assertEqual(sale_debt.open_amount, Decimal("1400.00"))

    def test_return_of_paid_sale_creates_refund_payable(self):
        created = self._create_sale("SALE-PAID-RETURN", [
            {"product": str(self.product.id), "quantity": "2.000", "price": "200.00"},
        ])
        paid = self.client.post(
            f"/api/v1/sales/{created.data['id']}/post-with-payment/",
            {"version": 1, "breakdown": [{"method": "cash", "amount": "400.00"}]},
            format="json", HTTP_IDEMPOTENCY_KEY="paid-return-source",
        )
        self.assertEqual(paid.status_code, status.HTTP_200_OK, paid.data)
        returned = self.client.post("/api/v1/buyer-returns/", {
            "number": "RETURN-PAID", "source_sale": created.data["id"],
            "warehouse": str(self.warehouse.id), "reason": "Оплаченный возврат",
            "lines": [{"source_line": created.data["lines"][0]["id"], "quantity": "1.000"}],
        }, format="json")
        result = self.client.post(
            f"/api/v1/buyer-returns/{returned.data['id']}/post/", {"version": 1},
            format="json", HTTP_IDEMPOTENCY_KEY="paid-return",
        )
        self.assertEqual(result.status_code, status.HTTP_200_OK, result.data)
        self.assertEqual(result.data["totals"]["refund_due"], "200.00")
        refund = Obligation.objects.get(source_document_id=returned.data["id"])
        self.assertEqual(refund.side, Obligation.Side.PAYABLE)
        self.assertEqual(refund.open_amount, Decimal("200.00"))

    def test_total_returns_cannot_exceed_sold_quantity(self):
        created = self._create_sale("SALE-OVER-RETURN", [
            {"product": str(self.product.id), "quantity": "1.000", "price": "200.00"},
        ])
        self._post_sale(created.data["id"], "over-return-source")
        returned = self.client.post("/api/v1/buyer-returns/", {
            "number": "RETURN-OVER", "source_sale": created.data["id"],
            "warehouse": str(self.warehouse.id), "reason": "Лишний возврат",
            "lines": [{"source_line": created.data["lines"][0]["id"], "quantity": "2.000"}],
        }, format="json")
        result = self.client.post(
            f"/api/v1/buyer-returns/{returned.data['id']}/post/", {"version": 1},
            format="json", HTTP_IDEMPOTENCY_KEY="over-return",
        )
        self.assertEqual(result.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(ReturnLotAllocation.objects.count(), 0)

    def test_safe_sale_reversal_restores_stock_and_closes_debt(self):
        created = self._create_sale("SALE-REVERSE", [
            {"product": str(self.product.id), "quantity": "3.000", "price": "200.00"},
        ])
        posted = self._post_sale(created.data["id"], "sale-before-reverse")
        self.assertEqual(posted.status_code, status.HTTP_200_OK)
        self.assertEqual(StockBalance.objects.get(product=self.product).quantity, Decimal("17.000"))
        reversed_response = self.client.post(
            f"/api/v1/documents/{created.data['id']}/reverse/",
            {"version": 2, "reason": "Ошибочная продажа"}, format="json",
            HTTP_IDEMPOTENCY_KEY="reverse-sale",
        )
        self.assertEqual(reversed_response.status_code, status.HTTP_200_OK, reversed_response.data)
        self.assertEqual(StockBalance.objects.get(product=self.product).quantity, Decimal("20.000"))
        source = Document.objects.get(pk=created.data["id"])
        self.assertEqual(source.status, Document.Status.REVERSED)
        self.assertEqual(source.obligation.open_amount, Decimal("0.00"))
        self.assertEqual(StockMovement.objects.filter(document_id=reversed_response.data["reversal_id"]).count(), 1)

    def test_receipt_with_consumed_lot_cannot_be_reversed(self):
        created = self._create_sale("SALE-BLOCK-RECEIPT", [
            {"product": str(self.product.id), "quantity": "1.000", "price": "200.00"},
        ])
        self._post_sale(created.data["id"], "consume-before-receipt-reverse")
        receipt = Document.objects.get(number="FIFO-R1", type=Document.Type.RECEIPT)
        response = self.client.post(
            f"/api/v1/documents/{receipt.id}/reverse/",
            {"version": 2, "reason": "Проверка зависимости"}, format="json",
            HTTP_IDEMPOTENCY_KEY="reverse-consumed-receipt",
        )
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        receipt.refresh_from_db()
        self.assertEqual(receipt.status, Document.Status.POSTED)

    def test_reports_use_sales_and_cost_not_payments_as_revenue(self):
        created = self._create_sale("SALE-REPORT", [
            {"product": str(self.product.id), "quantity": "2.000", "price": "200.00"},
        ])
        self._post_sale(created.data["id"], "sale-report")
        before = self.client.get("/api/v1/reports/sales/")
        self.assertEqual(before.status_code, status.HTTP_200_OK)
        self.assertEqual(before.data["totals"]["revenue"], "400.00")
        self.assertEqual(before.data["totals"]["cost"], "200.00")
        self.assertEqual(before.data["totals"]["gross_profit"], "200.00")

        payment = self.client.post("/api/v1/payments/", {
            "number": "PAY-REPORT", "counterparty": str(self.customer.id),
            "direction": "incoming", "amount": "400.00",
            "breakdown": [{"method": "cash", "amount": "400.00"}],
        }, format="json")
        self.client.post(
            f"/api/v1/payments/{payment.data['id']}/post/", {"version": 1},
            format="json", HTTP_IDEMPOTENCY_KEY="pay-report",
        )
        after = self.client.get("/api/v1/reports/sales/")
        self.assertEqual(after.data["totals"], before.data["totals"])
        balance = self.client.get(f"/api/v1/settlements/{self.customer.id}/balance/")
        self.assertEqual(balance.data["balance"], "0.00")


class OrderReservationTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="order-seller", password="test")
        self.warehouse = Warehouse.objects.create(code="ORDER", name="Склад заказов")
        WarehouseAccess.objects.create(user=self.user, warehouse=self.warehouse, role=WarehouseAccess.Role.SELLER)
        self.supplier = Counterparty.objects.create(code="ORDER-SUP", name="Поставщик заказов")
        self.customer = Counterparty.objects.create(code="ORDER-BUY", name="Покупатель заказа")
        self.product = Product.objects.create(code="ORDER-P", name="Заказной товар", unit=Product.Unit.PIECE)
        self.client.force_authenticate(self.user)
        receipt = self.client.post("/api/v1/receipts/", {
            "number": "ORDER-R", "warehouse": str(self.warehouse.id),
            "counterparty": str(self.supplier.id),
            "lines": [{"product": str(self.product.id), "quantity": "20.000", "price": "100.00"}],
        }, format="json")
        self.client.post(
            f"/api/v1/receipts/{receipt.data['id']}/post/", {"version": 1},
            format="json", HTTP_IDEMPOTENCY_KEY="order-receipt",
        )

    def create_order(self, number="ORDER-1", quantity="6.000"):
        response = self.client.post("/api/v1/orders/", {
            "number": number, "warehouse": str(self.warehouse.id),
            "counterparty": str(self.customer.id),
            "lines": [{"product": str(self.product.id), "quantity": quantity, "price": "150.00"}],
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        return response

    def command(self, order_id, action, version, key):
        return self.client.post(
            f"/api/v1/orders/{order_id}/{action}/", {"version": version},
            format="json", HTTP_IDEMPOTENCY_KEY=key,
        )

    def test_reserve_20_by_6_leaves_14_and_order_sale_uses_own_reserve(self):
        order = self.create_order()
        reserved = self.command(order.data["id"], "reserve", 1, "reserve-order")
        self.assertEqual(reserved.status_code, status.HTTP_200_OK, reserved.data)
        balance = StockBalance.objects.get(product=self.product)
        self.assertEqual(balance.quantity, Decimal("20.000"))
        self.assertEqual(balance.reserved, Decimal("6.000"))

        direct_sale = self.client.post("/api/v1/sales/", {
            "number": "SALE-FOREIGN-RESERVE", "warehouse": str(self.warehouse.id),
            "counterparty": str(self.customer.id),
            "lines": [{"product": str(self.product.id), "quantity": "15.000", "price": "150.00"}],
        }, format="json")
        blocked = self.client.post(
            f"/api/v1/sales/{direct_sale.data['id']}/post/", {"version": 1},
            format="json", HTTP_IDEMPOTENCY_KEY="foreign-reserve-sale",
        )
        self.assertEqual(blocked.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(blocked.data["available"], "14.000")

        completed = self.command(order.data["id"], "sale", 2, "complete-order")
        self.assertEqual(completed.status_code, status.HTTP_200_OK, completed.data)
        self.assertEqual(completed.data["state"], "completed")
        balance.refresh_from_db()
        self.assertEqual(balance.quantity, Decimal("14.000"))
        self.assertEqual(balance.reserved, Decimal("0.000"))
        self.assertFalse(Reservation.objects.filter(released_at__isnull=True).exists())

    def test_cancel_releases_reserve_and_assembly_sheet_has_no_movements(self):
        order = self.create_order(number="ORDER-2")
        self.command(order.data["id"], "reserve", 1, "reserve-order-2")
        movement_count = StockMovement.objects.count()
        sheet = self.client.get(f"/api/v1/orders/{order.data['id']}/assembly-sheet/")
        self.assertEqual(sheet.status_code, status.HTTP_200_OK)
        self.assertEqual(sheet.data["lines"][0]["quantity"], "6.000")
        self.assertEqual(StockMovement.objects.count(), movement_count)
        cancelled = self.command(order.data["id"], "cancel", 2, "cancel-order-2")
        self.assertEqual(cancelled.status_code, status.HTTP_200_OK)
        self.assertEqual(cancelled.data["state"], "cancelled")
        self.assertEqual(StockBalance.objects.get(product=self.product).reserved, Decimal("0.000"))
