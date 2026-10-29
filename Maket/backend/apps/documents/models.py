import uuid
from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models


class Document(models.Model):
    class Type(models.TextChoices):
        OPENING_STOCK = "opening_stock", "Начальные остатки"
        RECEIPT = "receipt", "Поступление"
        SALE = "sale", "Продажа"
        BUYER_RETURN = "buyer_return", "Возврат покупателя"
        SUPPLIER_RETURN = "supplier_return", "Возврат поставщику"
        PAYMENT = "payment", "Оплата"
        OFFSET = "offset", "Взаимозачёт"
        ORDER = "order", "Заказ"
        OPENING_DEBT = "opening_debt", "Начальный долг"

    class Status(models.TextChoices):
        DRAFT = "draft", "Черновик"
        POSTED = "posted", "Проведён"
        REVERSED = "reversed", "Сторнирован"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    type = models.CharField(max_length=32, choices=Type.choices)
    number = models.CharField(max_length=32)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    version = models.PositiveIntegerField(default=1)
    warehouse = models.ForeignKey("warehouses.Warehouse", on_delete=models.PROTECT, null=True, blank=True)
    counterparty = models.ForeignKey("partners.Counterparty", on_delete=models.PROTECT, null=True, blank=True, related_name="documents")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="authored_documents")
    posted_at = models.DateTimeField(null=True, blank=True)
    reversed_at = models.DateTimeField(null=True, blank=True)
    reversal_of = models.OneToOneField("self", on_delete=models.PROTECT, null=True, blank=True, related_name="reversal")
    reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["type", "number"], name="unique_document_type_number"),
        ]
        ordering = ["-created_at", "number"]

    def __str__(self):
        return f"{self.get_type_display()} {self.number}"

    def save(self, *args, **kwargs):
        if self._state.adding and not self.number:
            from .numbering import next_number
            self.number = next_number(self.type)
        super().save(*args, **kwargs)


class DocumentCounter(models.Model):
    doc_type = models.CharField(max_length=32, primary_key=True)
    value = models.PositiveIntegerField(default=0)


class Receipt(models.Model):
    document = models.OneToOneField(Document, on_delete=models.CASCADE, primary_key=True, related_name="receipt")

    def __str__(self):
        return str(self.document)


class OpeningStock(models.Model):
    document = models.OneToOneField(Document, on_delete=models.CASCADE, primary_key=True, related_name="opening_stock")

    def __str__(self):
        return str(self.document)


class OpeningStockLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    opening_stock = models.ForeignKey(OpeningStock, on_delete=models.CASCADE, related_name="lines")
    position = models.PositiveIntegerField()
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="opening_stock_lines")
    product_code = models.CharField(max_length=32)
    product_name = models.CharField(max_length=255)
    unit = models.CharField(max_length=8)
    quantity = models.DecimalField(max_digits=18, decimal_places=3, validators=[MinValueValidator(Decimal("0.001"))])
    unit_cost = models.DecimalField(max_digits=18, decimal_places=2, validators=[MinValueValidator(Decimal("0.00"))])
    total_cost = models.DecimalField(max_digits=18, decimal_places=2, validators=[MinValueValidator(Decimal("0.00"))])

    class Meta:
        ordering = ["position"]
        constraints = [
            models.UniqueConstraint(fields=["opening_stock", "position"], name="unique_opening_stock_line_position"),
        ]


class ReceiptLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    receipt = models.ForeignKey(Receipt, on_delete=models.CASCADE, related_name="lines")
    position = models.PositiveIntegerField()
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="receipt_lines")
    product_code = models.CharField(max_length=32)
    product_name = models.CharField(max_length=255)
    unit = models.CharField(max_length=8)
    quantity = models.DecimalField(max_digits=18, decimal_places=3, validators=[MinValueValidator(Decimal("0.001"))])
    price = models.DecimalField(max_digits=18, decimal_places=2, validators=[MinValueValidator(Decimal("0.00"))])
    # цены продажи, указанные при приходе: при проведении они становятся ценами товара
    wholesale_price = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(Decimal("0.00"))])
    retail_price = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(Decimal("0.00"))])
    goods_amount = models.DecimalField(max_digits=18, decimal_places=2, validators=[MinValueValidator(Decimal("0.00"))])
    allocated_extra_cost = models.DecimalField(max_digits=18, decimal_places=2, default=0, validators=[MinValueValidator(Decimal("0.00"))])
    total_cost = models.DecimalField(max_digits=18, decimal_places=2, validators=[MinValueValidator(Decimal("0.00"))])

    class Meta:
        ordering = ["position"]
        constraints = [
            models.UniqueConstraint(fields=["receipt", "position"], name="unique_receipt_line_position"),
        ]


class ReceiptExtraCost(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    receipt = models.ForeignKey(Receipt, on_delete=models.CASCADE, related_name="extra_costs")
    position = models.PositiveIntegerField()
    name = models.CharField(max_length=128)
    amount = models.DecimalField(max_digits=18, decimal_places=2, validators=[MinValueValidator(Decimal("0.00"))])

    class Meta:
        ordering = ["position"]
        constraints = [
            models.UniqueConstraint(fields=["receipt", "position"], name="unique_receipt_extra_cost_position"),
        ]


class Sale(models.Model):
    document = models.OneToOneField(Document, on_delete=models.CASCADE, primary_key=True, related_name="sale")

    def __str__(self):
        return str(self.document)


class SaleLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name="lines")
    position = models.PositiveIntegerField()
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="sale_lines")
    product_code = models.CharField(max_length=32)
    product_name = models.CharField(max_length=255)
    unit = models.CharField(max_length=8)
    quantity = models.DecimalField(max_digits=18, decimal_places=3, validators=[MinValueValidator(Decimal("0.001"))])
    price = models.DecimalField(max_digits=18, decimal_places=2, validators=[MinValueValidator(Decimal("0.00"))])
    discount = models.DecimalField(max_digits=18, decimal_places=2, default=0, validators=[MinValueValidator(Decimal("0.00"))])
    amount = models.DecimalField(max_digits=18, decimal_places=2, validators=[MinValueValidator(Decimal("0.00"))])
    cost = models.DecimalField(max_digits=18, decimal_places=2, default=0, validators=[MinValueValidator(Decimal("0.00"))])

    class Meta:
        ordering = ["position"]
        constraints = [
            models.UniqueConstraint(fields=["sale", "position"], name="unique_sale_line_position"),
        ]


class BuyerReturn(models.Model):
    document = models.OneToOneField(Document, on_delete=models.CASCADE, primary_key=True, related_name="buyer_return")
    source_sale = models.ForeignKey(Sale, on_delete=models.PROTECT, related_name="buyer_returns")

    def __str__(self):
        return str(self.document)


class BuyerReturnLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    buyer_return = models.ForeignKey(BuyerReturn, on_delete=models.CASCADE, related_name="lines")
    position = models.PositiveIntegerField()
    source_line = models.ForeignKey(SaleLine, on_delete=models.PROTECT, related_name="return_lines")
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="buyer_return_lines")
    product_code = models.CharField(max_length=32)
    product_name = models.CharField(max_length=255)
    unit = models.CharField(max_length=8)
    quantity = models.DecimalField(max_digits=18, decimal_places=3, validators=[MinValueValidator(Decimal("0.001"))])
    amount = models.DecimalField(max_digits=18, decimal_places=2, default=0, validators=[MinValueValidator(Decimal("0.00"))])
    cost = models.DecimalField(max_digits=18, decimal_places=2, default=0, validators=[MinValueValidator(Decimal("0.00"))])

    class Meta:
        ordering = ["position"]
        constraints = [
            models.UniqueConstraint(fields=["buyer_return", "position"], name="unique_buyer_return_line_position"),
            models.UniqueConstraint(fields=["buyer_return", "source_line"], name="unique_buyer_return_source_line"),
        ]


class CustomerOrder(models.Model):
    class State(models.TextChoices):
        DRAFT = "draft", "Новый"
        RESERVED = "reserved", "Собираем"
        ASSEMBLED = "assembled", "Собран"
        SHIPPED = "shipped", "Отправлен"
        COMPLETED = "completed", "Доставлен"
        CANCELLED = "cancelled", "Отменён"

    # заказ с действующим резервом: его можно отгрузить, продать или отменить
    ACTIVE_STATES = (State.RESERVED, State.ASSEMBLED, State.SHIPPED)

    document = models.OneToOneField(Document, on_delete=models.CASCADE, primary_key=True, related_name="customer_order")
    state = models.CharField(max_length=16, choices=State.choices, default=State.DRAFT)
    completed_sale = models.OneToOneField(Sale, on_delete=models.PROTECT, null=True, blank=True, related_name="source_order")

    def __str__(self):
        return str(self.document)


class CustomerOrderLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(CustomerOrder, on_delete=models.CASCADE, related_name="lines")
    position = models.PositiveIntegerField()
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="order_lines")
    product_code = models.CharField(max_length=32)
    product_name = models.CharField(max_length=255)
    unit = models.CharField(max_length=8)
    quantity = models.DecimalField(max_digits=18, decimal_places=3, validators=[MinValueValidator(Decimal("0.001"))])
    price = models.DecimalField(max_digits=18, decimal_places=2, validators=[MinValueValidator(Decimal("0.00"))])
    discount = models.DecimalField(max_digits=18, decimal_places=2, default=0, validators=[MinValueValidator(Decimal("0.00"))])
    amount = models.DecimalField(max_digits=18, decimal_places=2, validators=[MinValueValidator(Decimal("0.00"))])

    class Meta:
        ordering = ["position"]
        constraints = [
            models.UniqueConstraint(fields=["order", "position"], name="unique_customer_order_line_position"),
        ]


class SupplierReturn(models.Model):
    document = models.OneToOneField(Document, on_delete=models.CASCADE, primary_key=True, related_name="supplier_return")
    source_receipt = models.ForeignKey(Receipt, on_delete=models.PROTECT, related_name="supplier_returns")


class SupplierReturnLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    supplier_return = models.ForeignKey(SupplierReturn, on_delete=models.CASCADE, related_name="lines")
    position = models.PositiveIntegerField()
    source_line = models.ForeignKey(ReceiptLine, on_delete=models.PROTECT, related_name="supplier_return_lines")
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="supplier_return_lines")
    product_code = models.CharField(max_length=32)
    product_name = models.CharField(max_length=255)
    unit = models.CharField(max_length=8)
    quantity = models.DecimalField(max_digits=18, decimal_places=3, validators=[MinValueValidator(Decimal("0.001"))])
    amount = models.DecimalField(max_digits=18, decimal_places=2, default=0, validators=[MinValueValidator(Decimal("0.00"))])
    cost = models.DecimalField(max_digits=18, decimal_places=2, default=0, validators=[MinValueValidator(Decimal("0.00"))])

    class Meta:
        ordering = ["position"]
        constraints = [
            models.UniqueConstraint(fields=["supplier_return", "position"], name="unique_supplier_return_line_position"),
            models.UniqueConstraint(fields=["supplier_return", "source_line"], name="unique_supplier_return_source_line"),
        ]


class CommandResult(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    principal = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="command_results")
    key = models.CharField(max_length=128)
    operation = models.CharField(max_length=64)
    payload_hash = models.CharField(max_length=64)
    result = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["principal", "key"], name="unique_principal_idempotency_key"),
        ]
