from decimal import Decimal

from rest_framework import serializers

from config.exceptions import VersionConflict
from apps.catalog.models import Product
from apps.partners.models import Counterparty
from apps.payments.models import PaymentBreakdown
from apps.warehouses.models import Warehouse
from .calculations import money, validate_product_quantity
from .models import (BuyerReturn, BuyerReturnLine, CustomerOrder, CustomerOrderLine,
                     Document, OpeningStock, OpeningStockLine, Receipt, ReceiptExtraCost,
                     ReceiptLine, Sale, SaleLine, SupplierReturn, SupplierReturnLine)


def _payment_summary(document):
    """Оплата, принятая при проведении документа: итог и разбивка по способам."""
    totals = {}
    paid = Decimal("0.00")
    for payment in document.source_payments.filter(document__status=Document.Status.POSTED).prefetch_related("breakdown"):
        paid += payment.amount
        for item in payment.breakdown.all():
            totals[item.method] = totals.get(item.method, Decimal("0.00")) + item.amount
    return paid, [{"method": method, "amount": str(amount)} for method, amount in sorted(totals.items())]


class PaidSummaryMixin(serializers.Serializer):
    author = serializers.CharField(source="document.author.username", read_only=True)
    created_at = serializers.DateTimeField(source="document.created_at", read_only=True)
    paid = serializers.SerializerMethodField()
    payment_breakdown = serializers.SerializerMethodField()

    def get_paid(self, obj) -> str:
        return str(_payment_summary(obj.document)[0])

    def get_payment_breakdown(self, obj) -> list:
        return _payment_summary(obj.document)[1]


def _ensure_new_id(value):
    if Document.objects.filter(pk=value).exists():
        raise serializers.ValidationError("Документ с таким идентификатором уже создан.", code="exists")
    return value


def _update_draft_document(instance, validated_data):
    document = instance.document
    if document.status != Document.Status.DRAFT:
        raise serializers.ValidationError({"detail": "Проведённый документ нельзя редактировать."})
    supplied_version = validated_data.pop("version", None)
    if supplied_version is None or supplied_version != document.version:
        raise VersionConflict()
    for field in ("number", "warehouse", "counterparty", "reason"):
        if field in validated_data:
            setattr(document, field, validated_data.pop(field))
    document.version += 1
    document.save()
    return document


def _create_sale_like_lines(owner, relation_name, model, lines):
    for position, item in enumerate(lines, start=1):
        product = item["product"]
        amount = money(item["quantity"] * item["price"] - item["discount"])
        model.objects.create(
            **{relation_name: owner}, position=position, product=product,
            product_code=product.code, product_name=product.name, unit=product.unit,
            quantity=item["quantity"], price=item["price"], discount=item["discount"], amount=amount,
            **({"cost": 0} if model is SaleLine else {}),
        )


class DocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Document
        fields = [
            "id", "type", "number", "status", "version", "warehouse",
            "counterparty", "author", "posted_at", "reversed_at",
            "reversal_of", "reason", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "status", "author", "posted_at", "reversed_at",
            "reversal_of", "created_at", "updated_at",
        ]

    def validate(self, attrs):
        instance = self.instance
        if instance and instance.status != Document.Status.DRAFT:
            raise serializers.ValidationError({"detail": "Проведённый документ нельзя редактировать."})
        if instance:
            supplied_version = self.initial_data.get("version")
            if supplied_version is None or int(supplied_version) != instance.version:
                raise VersionConflict()
        return attrs

    def update(self, instance, validated_data):
        validated_data.pop("version", None)
        instance.version += 1
        return super().update(instance, validated_data)


class ReceiptLineWriteSerializer(serializers.Serializer):
    product = serializers.PrimaryKeyRelatedField(queryset=Product.objects.filter(active=True))
    quantity = serializers.DecimalField(max_digits=18, decimal_places=3)
    price = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=Decimal("0.00"))
    wholesale_price = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=Decimal("0.00"), required=False, allow_null=True)
    retail_price = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=Decimal("0.00"), required=False, allow_null=True)

    def validate(self, attrs):
        try:
            attrs["quantity"] = validate_product_quantity(attrs["product"], attrs["quantity"])
        except Exception as exc:
            raise serializers.ValidationError({"quantity": getattr(exc, "messages", [str(exc)])}) from exc
        return attrs


class OpeningStockLineWriteSerializer(serializers.Serializer):
    product = serializers.PrimaryKeyRelatedField(queryset=Product.objects.filter(active=True))
    quantity = serializers.DecimalField(max_digits=18, decimal_places=3)
    unit_cost = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=Decimal("0.00"))

    def validate(self, attrs):
        try:
            attrs["quantity"] = validate_product_quantity(attrs["product"], attrs["quantity"])
        except Exception as exc:
            raise serializers.ValidationError({"quantity": getattr(exc, "messages", [str(exc)])}) from exc
        return attrs


class OpeningStockWriteSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1, required=False, write_only=True)
    id = serializers.UUIDField(required=False)
    number = serializers.CharField(max_length=32, required=False)
    warehouse = serializers.PrimaryKeyRelatedField(queryset=Warehouse.objects.filter(active=True))
    reason = serializers.CharField(min_length=3)
    lines = OpeningStockLineWriteSerializer(many=True, allow_empty=False)

    def validate_id(self, value):
        return _ensure_new_id(value)

    def create(self, validated_data):
        validated_data.pop("version", None)
        lines = validated_data.pop("lines")
        document = Document.objects.create(
            type=Document.Type.OPENING_STOCK,
            author=self.context["request"].user,
            **validated_data,
        )
        opening = OpeningStock.objects.create(document=document)
        for position, item in enumerate(lines, start=1):
            product = item["product"]
            total = money(item["quantity"] * item["unit_cost"])
            OpeningStockLine.objects.create(
                opening_stock=opening, position=position, product=product,
                product_code=product.code, product_name=product.name, unit=product.unit,
                quantity=item["quantity"], unit_cost=item["unit_cost"], total_cost=total,
            )
        return opening

    def update(self, instance, validated_data):
        lines = validated_data.pop("lines", None)
        _update_draft_document(instance, validated_data)
        if lines is not None:
            instance.lines.all().delete()
            for position, item in enumerate(lines, start=1):
                product = item["product"]
                total = money(item["quantity"] * item["unit_cost"])
                OpeningStockLine.objects.create(
                    opening_stock=instance, position=position, product=product,
                    product_code=product.code, product_name=product.name, unit=product.unit,
                    quantity=item["quantity"], unit_cost=item["unit_cost"], total_cost=total,
                )
        return instance


class OpeningStockLineReadSerializer(serializers.ModelSerializer):
    class Meta:
        model = OpeningStockLine
        fields = ["id", "position", "product", "product_code", "product_name", "unit", "quantity", "unit_cost", "total_cost"]


class OpeningStockReadSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(source="document_id")
    number = serializers.CharField(source="document.number")
    status = serializers.CharField(source="document.status")
    version = serializers.IntegerField(source="document.version")
    warehouse = serializers.UUIDField(source="document.warehouse_id")
    reason = serializers.CharField(source="document.reason")
    posted_at = serializers.DateTimeField(source="document.posted_at")
    lines = OpeningStockLineReadSerializer(many=True)

    class Meta:
        model = OpeningStock
        fields = ["id", "number", "status", "version", "warehouse", "reason", "posted_at", "lines"]


class ReceiptExtraCostWriteSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=128)
    amount = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=Decimal("0.00"))


class ReceiptWriteSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1, required=False, write_only=True)
    id = serializers.UUIDField(required=False)
    number = serializers.CharField(max_length=32, required=False)
    warehouse = serializers.PrimaryKeyRelatedField(queryset=Warehouse.objects.filter(active=True))
    counterparty = serializers.PrimaryKeyRelatedField(queryset=Counterparty.objects.filter(active=True))
    reason = serializers.CharField(required=False, allow_blank=True, default="")
    lines = ReceiptLineWriteSerializer(many=True, allow_empty=False)
    extra_costs = ReceiptExtraCostWriteSerializer(many=True, required=False, default=list)

    def validate_id(self, value):
        return _ensure_new_id(value)

    def create(self, validated_data):
        validated_data.pop("version", None)
        lines = validated_data.pop("lines")
        extra_costs = validated_data.pop("extra_costs", [])
        document = Document.objects.create(
            type=Document.Type.RECEIPT,
            author=self.context["request"].user,
            **validated_data,
        )
        receipt = Receipt.objects.create(document=document)
        for position, item in enumerate(lines, start=1):
            product = item["product"]
            goods_amount = money(item["quantity"] * item["price"])
            ReceiptLine.objects.create(
                receipt=receipt, position=position, product=product,
                product_code=product.code, product_name=product.name, unit=product.unit,
                quantity=item["quantity"], price=item["price"], goods_amount=goods_amount,
                wholesale_price=item.get("wholesale_price"), retail_price=item.get("retail_price"),
                allocated_extra_cost=0, total_cost=goods_amount,
            )
        for position, item in enumerate(extra_costs, start=1):
            ReceiptExtraCost.objects.create(receipt=receipt, position=position, **item)
        return receipt

    def update(self, instance, validated_data):
        lines = validated_data.pop("lines", None)
        extra_costs = validated_data.pop("extra_costs", None)
        _update_draft_document(instance, validated_data)
        if lines is not None:
            instance.lines.all().delete()
            for position, item in enumerate(lines, start=1):
                product = item["product"]
                goods_amount = money(item["quantity"] * item["price"])
                ReceiptLine.objects.create(
                    receipt=instance, position=position, product=product,
                    product_code=product.code, product_name=product.name, unit=product.unit,
                    quantity=item["quantity"], price=item["price"], goods_amount=goods_amount,
                    wholesale_price=item.get("wholesale_price"), retail_price=item.get("retail_price"),
                    allocated_extra_cost=0, total_cost=goods_amount,
                )
        if extra_costs is not None:
            instance.extra_costs.all().delete()
            for position, item in enumerate(extra_costs, start=1):
                ReceiptExtraCost.objects.create(receipt=instance, position=position, **item)
        return instance


class ReceiptLineReadSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReceiptLine
        fields = ["id", "position", "product", "product_code", "product_name", "unit", "quantity", "price", "wholesale_price", "retail_price", "goods_amount", "allocated_extra_cost", "total_cost"]


class ReceiptExtraCostReadSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReceiptExtraCost
        fields = ["id", "position", "name", "amount"]


class ReceiptReadSerializer(PaidSummaryMixin, serializers.ModelSerializer):
    id = serializers.UUIDField(source="document_id")
    number = serializers.CharField(source="document.number")
    status = serializers.CharField(source="document.status")
    version = serializers.IntegerField(source="document.version")
    warehouse = serializers.UUIDField(source="document.warehouse_id")
    counterparty = serializers.UUIDField(source="document.counterparty_id")
    reason = serializers.CharField(source="document.reason")
    posted_at = serializers.DateTimeField(source="document.posted_at")
    lines = ReceiptLineReadSerializer(many=True)
    extra_costs = ReceiptExtraCostReadSerializer(many=True)

    class Meta:
        model = Receipt
        fields = ["id", "number", "status", "version", "warehouse", "counterparty", "reason", "posted_at", "lines", "extra_costs", "author", "created_at", "paid", "payment_breakdown"]


class PostDocumentSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)


class ReverseDocumentSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)
    reason = serializers.CharField(min_length=3)


class SaleLineWriteSerializer(serializers.Serializer):
    product = serializers.PrimaryKeyRelatedField(queryset=Product.objects.filter(active=True))
    quantity = serializers.DecimalField(max_digits=18, decimal_places=3)
    price = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=Decimal("0.00"))
    discount = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=Decimal("0.00"), required=False, default=Decimal("0.00"))

    def validate(self, attrs):
        try:
            attrs["quantity"] = validate_product_quantity(attrs["product"], attrs["quantity"])
        except Exception as exc:
            raise serializers.ValidationError({"quantity": getattr(exc, "messages", [str(exc)])}) from exc
        gross = money(attrs["quantity"] * attrs["price"])
        if attrs["discount"] > gross:
            raise serializers.ValidationError({"discount": "Скидка не может превышать сумму строки."})
        return attrs


class SaleWriteSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1, required=False, write_only=True)
    id = serializers.UUIDField(required=False)
    number = serializers.CharField(max_length=32, required=False)
    warehouse = serializers.PrimaryKeyRelatedField(queryset=Warehouse.objects.filter(active=True))
    counterparty = serializers.PrimaryKeyRelatedField(queryset=Counterparty.objects.filter(active=True))
    reason = serializers.CharField(required=False, allow_blank=True, default="")
    lines = SaleLineWriteSerializer(many=True, allow_empty=False)

    def validate_id(self, value):
        return _ensure_new_id(value)

    def create(self, validated_data):
        validated_data.pop("version", None)
        lines = validated_data.pop("lines")
        document = Document.objects.create(
            type=Document.Type.SALE, author=self.context["request"].user, **validated_data,
        )
        sale = Sale.objects.create(document=document)
        _create_sale_like_lines(sale, "sale", SaleLine, lines)
        return sale

    def update(self, instance, validated_data):
        lines = validated_data.pop("lines", None)
        _update_draft_document(instance, validated_data)
        if lines is not None:
            instance.lines.all().delete()
            _create_sale_like_lines(instance, "sale", SaleLine, lines)
        return instance


class SaleLineReadSerializer(serializers.ModelSerializer):
    class Meta:
        model = SaleLine
        fields = ["id", "position", "product", "product_code", "product_name", "unit", "quantity", "price", "discount", "amount", "cost"]


class SaleReadSerializer(PaidSummaryMixin, serializers.ModelSerializer):
    id = serializers.UUIDField(source="document_id")
    number = serializers.CharField(source="document.number")
    status = serializers.CharField(source="document.status")
    version = serializers.IntegerField(source="document.version")
    warehouse = serializers.UUIDField(source="document.warehouse_id")
    counterparty = serializers.UUIDField(source="document.counterparty_id")
    reason = serializers.CharField(source="document.reason")
    posted_at = serializers.DateTimeField(source="document.posted_at")
    lines = SaleLineReadSerializer(many=True)

    class Meta:
        model = Sale
        fields = ["id", "number", "status", "version", "warehouse", "counterparty", "reason", "posted_at", "lines", "author", "created_at", "paid", "payment_breakdown"]


class SalePaymentBreakdownSerializer(serializers.Serializer):
    method = serializers.ChoiceField(choices=PaymentBreakdown.Method.choices)
    amount = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=Decimal("0.01"))


class PostBuyerReturnWithRefundSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)
    breakdown = SalePaymentBreakdownSerializer(many=True, allow_empty=True)


class PostSaleWithPaymentSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)
    breakdown = SalePaymentBreakdownSerializer(many=True, allow_empty=True)

    def validate_breakdown(self, value):
        methods = [item["method"] for item in value]
        if len(methods) != len(set(methods)):
            raise serializers.ValidationError("Способ оплаты можно указать только один раз.")
        return value


class BuyerReturnLineWriteSerializer(serializers.Serializer):
    source_line = serializers.PrimaryKeyRelatedField(queryset=SaleLine.objects.all())
    quantity = serializers.DecimalField(max_digits=18, decimal_places=3)

    def validate(self, attrs):
        try:
            attrs["quantity"] = validate_product_quantity(attrs["source_line"].product, attrs["quantity"])
        except Exception as exc:
            raise serializers.ValidationError({"quantity": getattr(exc, "messages", [str(exc)])}) from exc
        return attrs


class BuyerReturnWriteSerializer(serializers.Serializer):
    id = serializers.UUIDField(required=False)
    number = serializers.CharField(max_length=32, required=False)
    source_sale = serializers.PrimaryKeyRelatedField(queryset=Sale.objects.select_related("document"))
    warehouse = serializers.PrimaryKeyRelatedField(queryset=Warehouse.objects.filter(active=True))
    reason = serializers.CharField(min_length=3)
    lines = BuyerReturnLineWriteSerializer(many=True, allow_empty=False)

    def validate_id(self, value):
        return _ensure_new_id(value)

    def validate(self, attrs):
        sale = attrs["source_sale"]
        if sale.document.status != Document.Status.POSTED:
            raise serializers.ValidationError({"source_sale": "Возврат возможен только по проведённой продаже."})
        source_ids = [item["source_line"].id for item in attrs["lines"]]
        if len(source_ids) != len(set(source_ids)):
            raise serializers.ValidationError({"lines": "Строку продажи можно указать только один раз."})
        if any(item["source_line"].sale_id != sale.pk for item in attrs["lines"]):
            raise serializers.ValidationError({"lines": "Все строки должны принадлежать выбранной продаже."})
        return attrs

    def create(self, validated_data):
        lines = validated_data.pop("lines")
        source_sale = validated_data.pop("source_sale")
        document = Document.objects.create(
            type=Document.Type.BUYER_RETURN,
            counterparty=source_sale.document.counterparty,
            author=self.context["request"].user,
            **validated_data,
        )
        buyer_return = BuyerReturn.objects.create(document=document, source_sale=source_sale)
        for position, item in enumerate(lines, start=1):
            source = item["source_line"]
            BuyerReturnLine.objects.create(
                buyer_return=buyer_return, position=position, source_line=source,
                product=source.product, product_code=source.product_code,
                product_name=source.product_name, unit=source.unit,
                quantity=item["quantity"], amount=0, cost=0,
            )
        return buyer_return


class BuyerReturnLineReadSerializer(serializers.ModelSerializer):
    class Meta:
        model = BuyerReturnLine
        fields = ["id", "position", "source_line", "product", "product_code", "product_name", "unit", "quantity", "amount", "cost"]


class BuyerReturnReadSerializer(PaidSummaryMixin, serializers.ModelSerializer):
    id = serializers.UUIDField(source="document_id")
    number = serializers.CharField(source="document.number")
    status = serializers.CharField(source="document.status")
    version = serializers.IntegerField(source="document.version")
    warehouse = serializers.UUIDField(source="document.warehouse_id")
    counterparty = serializers.UUIDField(source="document.counterparty_id")
    source_sale = serializers.UUIDField(source="source_sale_id")
    reason = serializers.CharField(source="document.reason")
    posted_at = serializers.DateTimeField(source="document.posted_at")
    lines = BuyerReturnLineReadSerializer(many=True)

    class Meta:
        model = BuyerReturn
        fields = ["id", "number", "status", "version", "warehouse", "counterparty", "source_sale", "reason", "posted_at", "lines", "author", "created_at", "paid", "payment_breakdown"]


class CompleteOrderSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)
    breakdown = SalePaymentBreakdownSerializer(many=True, required=False, default=list)

    def validate_breakdown(self, value):
        methods = [item["method"] for item in value]
        if len(methods) != len(set(methods)):
            raise serializers.ValidationError("Способ оплаты можно указать только один раз.")
        return value


class CustomerOrderWriteSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1, required=False, write_only=True)
    id = serializers.UUIDField(required=False)
    number = serializers.CharField(max_length=32, required=False)
    warehouse = serializers.PrimaryKeyRelatedField(queryset=Warehouse.objects.filter(active=True))
    counterparty = serializers.PrimaryKeyRelatedField(queryset=Counterparty.objects.filter(active=True))
    reason = serializers.CharField(required=False, allow_blank=True, default="")
    lines = SaleLineWriteSerializer(many=True, allow_empty=False)

    def validate_id(self, value):
        return _ensure_new_id(value)

    def create(self, validated_data):
        validated_data.pop("version", None)
        lines = validated_data.pop("lines")
        document = Document.objects.create(
            type=Document.Type.ORDER, author=self.context["request"].user, **validated_data,
        )
        order = CustomerOrder.objects.create(document=document)
        _create_sale_like_lines(order, "order", CustomerOrderLine, lines)
        return order

    def update(self, instance, validated_data):
        if instance.state != CustomerOrder.State.DRAFT:
            raise serializers.ValidationError({"detail": "Изменять можно только черновик заказа."})
        lines = validated_data.pop("lines", None)
        _update_draft_document(instance, validated_data)
        if lines is not None:
            instance.lines.all().delete()
            _create_sale_like_lines(instance, "order", CustomerOrderLine, lines)
        return instance


class CustomerOrderLineReadSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomerOrderLine
        fields = ["id", "position", "product", "product_code", "product_name", "unit", "quantity", "price", "discount", "amount"]


class CustomerOrderReadSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(source="document_id")
    author = serializers.CharField(source="document.author.username", read_only=True)
    created_at = serializers.DateTimeField(source="document.created_at", read_only=True)
    number = serializers.CharField(source="document.number")
    version = serializers.IntegerField(source="document.version")
    warehouse = serializers.UUIDField(source="document.warehouse_id")
    counterparty = serializers.UUIDField(source="document.counterparty_id")
    reason = serializers.CharField(source="document.reason")
    completed_sale = serializers.UUIDField(source="completed_sale_id", allow_null=True)
    lines = CustomerOrderLineReadSerializer(many=True)

    class Meta:
        model = CustomerOrder
        fields = ["id", "number", "version", "warehouse", "counterparty", "state", "reason", "completed_sale", "lines", "author", "created_at"]


class SupplierReturnLineWriteSerializer(serializers.Serializer):
    source_line = serializers.PrimaryKeyRelatedField(queryset=ReceiptLine.objects.all())
    quantity = serializers.DecimalField(max_digits=18, decimal_places=3)

    def validate(self, attrs):
        try:
            attrs["quantity"] = validate_product_quantity(attrs["source_line"].product, attrs["quantity"])
        except Exception as exc:
            raise serializers.ValidationError({"quantity": getattr(exc, "messages", [str(exc)])}) from exc
        return attrs


class SupplierReturnWriteSerializer(serializers.Serializer):
    id = serializers.UUIDField(required=False)
    number = serializers.CharField(max_length=32, required=False)
    source_receipt = serializers.PrimaryKeyRelatedField(queryset=Receipt.objects.select_related("document"))
    warehouse = serializers.PrimaryKeyRelatedField(queryset=Warehouse.objects.filter(active=True))
    reason = serializers.CharField(min_length=3)
    lines = SupplierReturnLineWriteSerializer(many=True, allow_empty=False)

    def validate_id(self, value):
        return _ensure_new_id(value)

    def validate(self, attrs):
        receipt = attrs["source_receipt"]
        if receipt.document.status != Document.Status.POSTED:
            raise serializers.ValidationError({"source_receipt": "Возврат возможен только по проведённому поступлению."})
        ids = [item["source_line"].id for item in attrs["lines"]]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError({"lines": "Строку поступления можно указать только один раз."})
        if any(item["source_line"].receipt_id != receipt.pk for item in attrs["lines"]):
            raise serializers.ValidationError({"lines": "Все строки должны принадлежать выбранному поступлению."})
        return attrs

    def create(self, validated_data):
        lines = validated_data.pop("lines")
        source_receipt = validated_data.pop("source_receipt")
        document = Document.objects.create(
            type=Document.Type.SUPPLIER_RETURN,
            counterparty=source_receipt.document.counterparty,
            author=self.context["request"].user,
            **validated_data,
        )
        supplier_return = SupplierReturn.objects.create(document=document, source_receipt=source_receipt)
        for position, item in enumerate(lines, start=1):
            source = item["source_line"]
            SupplierReturnLine.objects.create(
                supplier_return=supplier_return, position=position, source_line=source,
                product=source.product, product_code=source.product_code,
                product_name=source.product_name, unit=source.unit,
                quantity=item["quantity"], amount=0, cost=0,
            )
        return supplier_return


class SupplierReturnLineReadSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplierReturnLine
        fields = ["id", "position", "source_line", "product", "product_code", "product_name", "unit", "quantity", "amount", "cost"]


class SupplierReturnReadSerializer(PaidSummaryMixin, serializers.ModelSerializer):
    id = serializers.UUIDField(source="document_id")
    number = serializers.CharField(source="document.number")
    status = serializers.CharField(source="document.status")
    version = serializers.IntegerField(source="document.version")
    warehouse = serializers.UUIDField(source="document.warehouse_id")
    counterparty = serializers.UUIDField(source="document.counterparty_id")
    source_receipt = serializers.UUIDField(source="source_receipt_id")
    reason = serializers.CharField(source="document.reason")
    posted_at = serializers.DateTimeField(source="document.posted_at")
    lines = SupplierReturnLineReadSerializer(many=True)

    class Meta:
        model = SupplierReturn
        fields = ["id", "number", "status", "version", "warehouse", "counterparty", "source_receipt", "reason", "posted_at", "lines", "author", "created_at", "paid", "payment_breakdown"]


class PostSupplierReturnWithPaymentSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)
    breakdown = SalePaymentBreakdownSerializer(many=True, allow_empty=False)

    def validate_breakdown(self, value):
        methods = [item["method"] for item in value]
        if len(methods) != len(set(methods)):
            raise serializers.ValidationError("Способ оплаты можно указать только один раз.")
        return value

