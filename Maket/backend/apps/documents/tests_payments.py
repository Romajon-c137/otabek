from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from apps.catalog.models import Product
from apps.inventory.models import StockBalance
from apps.partners.models import Counterparty
from apps.payments.models import Payment, PaymentBreakdown
from apps.settlements.models import Obligation
from apps.warehouses.models import Warehouse, WarehouseAccess

from .models import Document


class FlowBase(APITestCase):
    """Общие данные: склад, поставщик, покупатель, товар и вспомогательные запросы."""

    def setUp(self):
        self.user = get_user_model().objects.create_user(username="cashier", password="test")
        self.warehouse = Warehouse.objects.create(code="PAYF", name="Склад оплат")
        WarehouseAccess.objects.create(user=self.user, warehouse=self.warehouse, role=WarehouseAccess.Role.SELLER)
        self.supplier = Counterparty.objects.create(code="PF-SUP", name="Поставщик")
        self.buyer = Counterparty.objects.create(code="PF-BUY", name="Покупатель")
        self.retail = Counterparty.objects.get(system_key=Counterparty.RETAIL_SYSTEM_KEY)
        self.product = Product.objects.create(code="PF-P", name="Лопата", unit=Product.Unit.PIECE)
        self.client.force_authenticate(self.user)

    def post(self, url, data, key):
        return self.client.post(url, data, format="json", HTTP_IDEMPOTENCY_KEY=key)

    def receipt(self, quantity="10.000", price="100.00"):
        response = self.client.post("/api/v1/receipts/", {
            "warehouse": str(self.warehouse.id), "counterparty": str(self.supplier.id),
            "lines": [{"product": str(self.product.id), "quantity": quantity, "price": price}],
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        return response.data

    def stocked(self):
        receipt = self.receipt()
        self.assertEqual(self.post(f"/api/v1/receipts/{receipt['id']}/post/", {"version": 1}, "stock-in").status_code, 200)

    def sale(self, counterparty, quantity="2.000", price="150.00"):
        response = self.client.post("/api/v1/sales/", {
            "warehouse": str(self.warehouse.id), "counterparty": str(counterparty.id),
            "lines": [{"product": str(self.product.id), "quantity": quantity, "price": price}],
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        return response.data


class PaymentFlowTests(FlowBase):
    """Касса оформляет документ и оплату одним запросом: наличные/МБанк, остаток уходит в долг."""

    def test_numbers_are_assigned_by_server_and_unique(self):
        first, second = self.receipt(), self.receipt()
        self.assertRegex(first["number"], r"^ПТ-\d{6}$")
        self.assertNotEqual(first["number"], second["number"])
        self.assertEqual(int(second["number"][3:]), int(first["number"][3:]) + 1)

    def test_sale_partially_paid_leaves_debt_for_known_buyer(self):
        self.stocked()
        sale = self.sale(self.buyer)  # 2 × 150 = 300
        paid = self.post(f"/api/v1/sales/{sale['id']}/post-with-payment/", {
            "version": 1, "breakdown": [{"method": "cash", "amount": "100.00"}, {"method": "mbank", "amount": "50.00"}],
        }, "sale-partial")
        self.assertEqual(paid.status_code, status.HTTP_200_OK, paid.data)
        obligation = Obligation.objects.get(source_document_id=sale["id"])
        self.assertEqual(obligation.open_amount, Decimal("150.00"))
        self.assertEqual(obligation.side, Obligation.Side.RECEIVABLE)
        payment = Payment.objects.get(document__reason__contains=sale["number"])
        self.assertEqual(payment.amount, Decimal("150.00"))
        self.assertEqual({b.method: b.amount for b in payment.breakdown.all()}, {"cash": Decimal("100.00"), "mbank": Decimal("50.00")})
        # повтор с тем же ключом не создаёт второй платёж
        again = self.post(f"/api/v1/sales/{sale['id']}/post-with-payment/", {
            "version": 1, "breakdown": [{"method": "cash", "amount": "100.00"}, {"method": "mbank", "amount": "50.00"}],
        }, "sale-partial")
        self.assertEqual(again.status_code, status.HTTP_200_OK)
        self.assertEqual(Payment.objects.count(), 1)

    def test_sale_fully_on_credit_and_overpayment_and_retail_partial(self):
        self.stocked()
        credit = self.sale(self.buyer, quantity="1.000")
        done = self.post(f"/api/v1/sales/{credit['id']}/post-with-payment/", {"version": 1, "breakdown": []}, "sale-credit")
        self.assertEqual(done.status_code, status.HTTP_200_OK, done.data)
        self.assertEqual(Obligation.objects.get(source_document_id=credit["id"]).open_amount, Decimal("150.00"))
        self.assertFalse(Payment.objects.exists())

        over = self.sale(self.buyer, quantity="1.000")
        rejected = self.post(f"/api/v1/sales/{over['id']}/post-with-payment/", {"version": 1, "breakdown": [{"method": "cash", "amount": "151.00"}]}, "sale-over")
        self.assertEqual(rejected.status_code, status.HTTP_400_BAD_REQUEST)

        retail = self.sale(self.retail, quantity="1.000")
        partial = self.post(f"/api/v1/sales/{retail['id']}/post-with-payment/", {"version": 1, "breakdown": [{"method": "cash", "amount": "100.00"}]}, "sale-retail")
        self.assertEqual(partial.status_code, status.HTTP_400_BAD_REQUEST)
        full = self.post(f"/api/v1/sales/{retail['id']}/post-with-payment/", {"version": 1, "breakdown": [{"method": "mbank", "amount": "150.00"}]}, "sale-retail-full")
        self.assertEqual(full.status_code, status.HTTP_200_OK, full.data)

    def test_ayyl_bank_is_not_accepted(self):
        self.stocked()
        sale = self.sale(self.buyer, quantity="1.000")
        response = self.post(f"/api/v1/sales/{sale['id']}/post-with-payment/", {"version": 1, "breakdown": [{"method": "ayyl", "amount": "150.00"}]}, "sale-ayyl")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_receipt_with_payment_leaves_our_debt(self):
        receipt = self.receipt(quantity="10.000", price="100.00")  # закупка 1000
        done = self.post(f"/api/v1/receipts/{receipt['id']}/post-with-payment/", {"version": 1, "breakdown": [{"method": "cash", "amount": "400.00"}]}, "receipt-pay")
        self.assertEqual(done.status_code, status.HTTP_200_OK, done.data)
        obligation = Obligation.objects.get(source_document_id=receipt["id"])
        self.assertEqual((obligation.side, obligation.open_amount), (Obligation.Side.PAYABLE, Decimal("600.00")))
        self.assertEqual(Payment.objects.get().direction, Payment.Direction.OUTGOING)
        self.assertEqual(StockBalance.objects.get(product=self.product).quantity, Decimal("10.000"))
        too_much = self.receipt()
        rejected = self.post(f"/api/v1/receipts/{too_much['id']}/post-with-payment/", {"version": 1, "breakdown": [{"method": "cash", "amount": "1000.01"}]}, "receipt-over")
        self.assertEqual(rejected.status_code, status.HTTP_400_BAD_REQUEST)

    def test_order_is_delivered_with_payment_and_reserve_is_consumed(self):
        self.stocked()
        order = self.client.post("/api/v1/orders/", {
            "warehouse": str(self.warehouse.id), "counterparty": str(self.buyer.id),
            "lines": [{"product": str(self.product.id), "quantity": "3.000", "price": "150.00"}],
        }, format="json").data
        self.assertEqual(self.post(f"/api/v1/orders/{order['id']}/reserve/", {"version": 1}, "o-reserve").data["state"], "reserved")
        self.assertEqual(self.post(f"/api/v1/orders/{order['id']}/ship/", {"version": 2}, "o-ship").data["state"], "shipped")
        delivered = self.post(f"/api/v1/orders/{order['id']}/sale/", {"version": 3, "breakdown": [{"method": "cash", "amount": "300.00"}]}, "o-sale")
        self.assertEqual(delivered.status_code, status.HTTP_200_OK, delivered.data)
        self.assertEqual(delivered.data["state"], "completed")
        sale_id = delivered.data["sale"]["document_id"]
        self.assertEqual(Obligation.objects.get(source_document_id=sale_id).open_amount, Decimal("150.00"))
        balance = StockBalance.objects.get(product=self.product)
        self.assertEqual((balance.quantity, balance.reserved), (Decimal("7.000"), Decimal("0.000")))
        self.assertEqual(Document.objects.filter(type=Document.Type.PAYMENT).count(), 1)
        # повтор команды возвращает прежний результат без второго платежа
        repeat = self.post(f"/api/v1/orders/{order['id']}/sale/", {"version": 3, "breakdown": [{"method": "cash", "amount": "300.00"}]}, "o-sale")
        self.assertEqual(repeat.status_code, status.HTTP_200_OK)
        self.assertEqual(Document.objects.filter(type=Document.Type.PAYMENT).count(), 1)


class ClientApiContractTests(FlowBase):
    """Контракт, на который опирается программа: идентификаторы от клиента, оплата в чтении, общий список долгов."""

    def test_client_supplied_id_makes_create_idempotent(self):
        import uuid
        doc_id = str(uuid.uuid4())
        body = {"id": doc_id, "warehouse": str(self.warehouse.id), "counterparty": str(self.buyer.id),
                "lines": [{"product": str(self.product.id), "quantity": "1.000", "price": "10.00"}]}
        first = self.client.post("/api/v1/sales/", body, format="json")
        self.assertEqual(first.status_code, status.HTTP_201_CREATED, first.data)
        self.assertEqual(first.data["id"], doc_id)
        again = self.client.post("/api/v1/sales/", body, format="json")
        self.assertEqual(again.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(again.data["errors"]["id"][0]["code"] if "errors" in again.data else again.data["id"][0].code, "exists")
        self.assertEqual(Document.objects.filter(pk=doc_id).count(), 1)

    def test_read_shows_payment_taken_at_posting_and_filters(self):
        self.stocked()
        sale = self.sale(self.buyer)
        self.post(f"/api/v1/sales/{sale['id']}/post-with-payment/", {"version": 1, "breakdown": [{"method": "cash", "amount": "120.00"}, {"method": "mbank", "amount": "30.00"}]}, "contract")
        read = self.client.get(f"/api/v1/sales/{sale['id']}/").data
        self.assertEqual(read["paid"], "150.00")
        self.assertEqual({item["method"]: item["amount"] for item in read["payment_breakdown"]}, {"cash": "120.00", "mbank": "30.00"})
        self.assertEqual(read["author"], "cashier")
        self.assertEqual(self.client.get("/api/v1/sales/?status=posted&page_size=500").data["count"], 1)
        self.assertEqual(self.client.get("/api/v1/sales/?status=draft").data["count"], 0)
        self.assertEqual(self.client.get(f"/api/v1/sales/?counterparty={self.supplier.id}").data["count"], 0)
        obligations = self.client.get("/api/v1/settlements/obligations/").data["results"]
        mine = [o for o in obligations if o["source_document"] == sale["id"]]
        self.assertEqual((mine[0]["side"], mine[0]["open_amount"], mine[0]["source_type"]), ("receivable", "150.00", "sale"))
        payments = self.client.get("/api/v1/payments/").data["results"]
        self.assertEqual(payments[0]["source_document"], sale["id"])
        self.assertEqual(self.client.get("/api/v1/payments/?manual=true").data["count"], 0)

    def test_counterparty_and_product_can_be_created_with_client_id_and_auto_code(self):
        import uuid
        cp_id, product_id = str(uuid.uuid4()), str(uuid.uuid4())
        self.user.is_superuser = True
        self.user.save()
        cp = self.client.post("/api/v1/counterparties/", {"id": cp_id, "name": "Новый человек", "phone": "+996"}, format="json")
        self.assertEqual(cp.status_code, status.HTTP_201_CREATED, cp.data)
        self.assertEqual(cp.data["id"], cp_id)
        self.assertRegex(cp.data["code"], r"^К-\d{5}$")
        product = self.client.post("/api/v1/products/", {"id": product_id, "name": "Новинка", "unit": "pcs", "purchase_price": "1", "retail_price": "2", "wholesale_price": "2"}, format="json")
        self.assertEqual(product.status_code, status.HTTP_201_CREATED, product.data)
        self.assertEqual((product.data["id"], len(product.data["code"])), (product_id, 6))


class BuyerReturnRefundTests(FlowBase):
    def sold(self, counterparty, breakdown, quantity="2.000"):
        self.stocked()
        sale = self.sale(counterparty, quantity=quantity)  # цена 150
        done = self.post(f"/api/v1/sales/{sale['id']}/post-with-payment/", {"version": 1, "breakdown": breakdown}, f"sold-{counterparty.code}-{len(breakdown)}")
        self.assertEqual(done.status_code, status.HTTP_200_OK, done.data)
        return self.client.get(f"/api/v1/sales/{sale['id']}/").data

    def make_return(self, sale, quantity, rid=None):
        body = {"source_sale": sale["id"], "warehouse": str(self.warehouse.id), "reason": "Не подошёл",
                "lines": [{"source_line": sale["lines"][0]["id"], "quantity": quantity}]}
        if rid:
            body["id"] = rid
        response = self.client.post("/api/v1/buyer-returns/", body, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        return response.data

    def test_paid_sale_return_refunds_money_and_restores_stock(self):
        sale = self.sold(self.buyer, [{"method": "cash", "amount": "300.00"}])
        ret = self.make_return(sale, "1.000")
        done = self.post(f"/api/v1/buyer-returns/{ret['id']}/post-with-refund/", {"version": 1, "breakdown": [{"method": "mbank", "amount": "150.00"}]}, "ret-1")
        self.assertEqual(done.status_code, status.HTTP_200_OK, done.data)
        self.assertEqual(Obligation.objects.get(source_document_id=ret["id"]).open_amount, Decimal("0.00"))
        self.assertEqual(StockBalance.objects.get(product=self.product).quantity, Decimal("9.000"))
        read = self.client.get(f"/api/v1/buyer-returns/{ret['id']}/").data
        self.assertEqual((read["paid"], read["payment_breakdown"]), ("150.00", [{"method": "mbank", "amount": "150.00"}]))
        self.assertEqual(self.client.get("/api/v1/buyer-returns/?status=posted").data["count"], 1)

    def test_partial_refund_leaves_our_debt_and_retail_requires_full(self):
        sale = self.sold(self.buyer, [{"method": "cash", "amount": "300.00"}])
        ret = self.make_return(sale, "2.000")
        self.post(f"/api/v1/buyer-returns/{ret['id']}/post-with-refund/", {"version": 1, "breakdown": [{"method": "cash", "amount": "100.00"}]}, "ret-2")
        owed = Obligation.objects.get(source_document_id=ret["id"])
        self.assertEqual((owed.side, owed.open_amount), (Obligation.Side.PAYABLE, Decimal("200.00")))

    def test_return_of_credit_sale_reduces_debt_first(self):
        sale = self.sold(self.buyer, [])
        ret = self.make_return(sale, "1.000")
        done = self.post(f"/api/v1/buyer-returns/{ret['id']}/post-with-refund/", {"version": 1, "breakdown": []}, "ret-3")
        self.assertEqual(done.status_code, status.HTTP_200_OK, done.data)
        self.assertEqual(Obligation.objects.get(source_document_id=sale["id"]).open_amount, Decimal("150.00"))
        self.assertFalse(Obligation.objects.filter(source_document_id=ret["id"]).exists())
        too_much = self.make_return(sale, "1.000")
        rejected = self.post(f"/api/v1/buyer-returns/{too_much['id']}/post-with-refund/", {"version": 1, "breakdown": [{"method": "cash", "amount": "1.00"}]}, "ret-4")
        self.assertEqual(rejected.status_code, status.HTTP_400_BAD_REQUEST)

    def test_retail_sale_return_must_refund_fully_and_client_id_is_idempotent(self):
        import uuid
        sale = self.sold(self.retail, [{"method": "cash", "amount": "300.00"}])
        rid = str(uuid.uuid4())
        ret = self.make_return(sale, "1.000", rid=rid)
        partial = self.post(f"/api/v1/buyer-returns/{ret['id']}/post-with-refund/", {"version": 1, "breakdown": [{"method": "cash", "amount": "100.00"}]}, "ret-5")
        self.assertEqual(partial.status_code, status.HTTP_400_BAD_REQUEST)
        full = self.post(f"/api/v1/buyer-returns/{ret['id']}/post-with-refund/", {"version": 1, "breakdown": [{"method": "cash", "amount": "150.00"}]}, "ret-6")
        self.assertEqual(full.status_code, status.HTTP_200_OK, full.data)
        again = self.client.post("/api/v1/buyer-returns/", {"id": rid, "source_sale": sale["id"], "warehouse": str(self.warehouse.id), "lines": [{"source_line": sale["lines"][0]["id"], "quantity": "1.000"}]}, format="json")
        self.assertEqual(again.status_code, status.HTTP_400_BAD_REQUEST)


class ReceiptPricesTests(FlowBase):
    def test_three_prices_from_receipt_become_product_prices(self):
        receipt = self.client.post("/api/v1/receipts/", {
            "warehouse": str(self.warehouse.id), "counterparty": str(self.supplier.id),
            "lines": [{"product": str(self.product.id), "quantity": "5.000", "price": "120.00", "wholesale_price": "150.00", "retail_price": "190.00"}],
        }, format="json")
        self.assertEqual(receipt.status_code, status.HTTP_201_CREATED, receipt.data)
        self.assertEqual((receipt.data["lines"][0]["wholesale_price"], receipt.data["lines"][0]["retail_price"]), ("150.00", "190.00"))
        done = self.post(f"/api/v1/receipts/{receipt.data['id']}/post/", {"version": 1}, "prices-1")
        self.assertEqual(done.status_code, status.HTTP_200_OK, done.data)
        self.product.refresh_from_db()
        self.assertEqual((self.product.purchase_price, self.product.wholesale_price, self.product.retail_price), (Decimal("120.00"), Decimal("150.00"), Decimal("190.00")))

    def test_receipt_without_sale_prices_updates_only_purchase_price(self):
        self.product.retail_price = Decimal("99.00")
        self.product.save()
        receipt = self.receipt(quantity="2.000", price="70.00")
        self.post(f"/api/v1/receipts/{receipt['id']}/post/", {"version": 1}, "prices-2")
        self.product.refresh_from_db()
        self.assertEqual((self.product.purchase_price, self.product.retail_price), (Decimal("70.00"), Decimal("99.00")))


class ReviewFixesTests(FlowBase):
    """Исправления по код-ревью: отмена черновика заказа, выдача денег до взаимозачёта, обычная нумерация."""

    def order(self, quantity="1.000"):
        response = self.client.post("/api/v1/orders/", {
            "warehouse": str(self.warehouse.id), "counterparty": str(self.buyer.id),
            "lines": [{"product": str(self.product.id), "quantity": quantity, "price": "150.00"}],
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        return response.data

    def test_draft_order_can_be_cancelled(self):
        order = self.order()
        done = self.post(f"/api/v1/orders/{order['id']}/cancel/", {"version": 1}, "cancel-draft")
        self.assertEqual(done.status_code, status.HTTP_200_OK, done.data)
        self.assertEqual(done.data["state"], "cancelled")

    def test_refund_is_paid_before_offset_when_buyer_has_other_debt(self):
        self.stocked()
        credit = self.sale(self.buyer, quantity="1.000")  # долг покупателя 150
        self.assertEqual(self.post(f"/api/v1/sales/{credit['id']}/post-with-payment/", {"version": 1, "breakdown": []}, "credit").status_code, 200)
        paid = self.sale(self.buyer, quantity="1.000")
        self.assertEqual(self.post(f"/api/v1/sales/{paid['id']}/post-with-payment/", {"version": 1, "breakdown": [{"method": "cash", "amount": "150.00"}]}, "paid").status_code, 200)
        sale = self.client.get(f"/api/v1/sales/{paid['id']}/").data
        ret = self.client.post("/api/v1/buyer-returns/", {
            "source_sale": sale["id"], "warehouse": str(self.warehouse.id), "reason": "Не подошёл",
            "lines": [{"source_line": sale["lines"][0]["id"], "quantity": "1.000"}],
        }, format="json").data
        done = self.post(f"/api/v1/buyer-returns/{ret['id']}/post-with-refund/", {"version": 1, "breakdown": [{"method": "cash", "amount": "150.00"}]}, "refund")
        self.assertEqual(done.status_code, status.HTTP_200_OK, done.data)
        self.assertEqual(Obligation.objects.get(source_document_id=ret["id"]).open_amount, Decimal("0.00"))
        self.assertEqual(Obligation.objects.get(source_document_id=credit["id"]).open_amount, Decimal("150.00"))

    def test_order_sale_and_offset_get_regular_numbers(self):
        self.stocked()
        order = self.order()
        self.post(f"/api/v1/orders/{order['id']}/reserve/", {"version": 1}, "num-reserve")
        done = self.post(f"/api/v1/orders/{order['id']}/sale/", {"version": 2, "breakdown": []}, "num-sale")
        self.assertEqual(done.status_code, status.HTTP_200_OK, done.data)
        self.assertRegex(Document.objects.get(pk=done.data["sale"]["document_id"]).number, r"^ПР-\d{6}$")
        # приход от того же человека — встречный долг закрывается зачётом с номером ВЗ-
        receipt = self.client.post("/api/v1/receipts/", {
            "warehouse": str(self.warehouse.id), "counterparty": str(self.buyer.id),
            "lines": [{"product": str(self.product.id), "quantity": "1.000", "price": "100.00"}],
        }, format="json").data
        self.post(f"/api/v1/receipts/{receipt['id']}/post/", {"version": 1}, "num-receipt")
        self.assertRegex(Document.objects.get(type=Document.Type.OFFSET).number, r"^ВЗ-\d{6}$")

    def test_repeated_create_of_counterparty_and_product_is_a_field_error(self):
        import uuid
        self.user.is_superuser = True
        self.user.save()
        cp_id, product_id = str(uuid.uuid4()), str(uuid.uuid4())
        for url, body in [("/api/v1/counterparties/", {"id": cp_id, "name": "Повтор"}),
                          ("/api/v1/products/", {"id": product_id, "name": "Повтор", "unit": "pcs", "purchase_price": "1", "retail_price": "2", "wholesale_price": "2"})]:
            self.assertEqual(self.client.post(url, body, format="json").status_code, status.HTTP_201_CREATED)
            again = self.client.post(url, body, format="json")
            self.assertEqual(again.status_code, status.HTTP_400_BAD_REQUEST)
            self.assertIn("id", again.data)
            patched = self.client.patch(f"{url}{body['id']}/", {"name": "Повтор 2"}, format="json")
            self.assertEqual(patched.status_code, status.HTTP_200_OK, patched.data)
