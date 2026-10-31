from decimal import Decimal, ROUND_HALF_UP

from rest_framework import serializers

from modules.catalog.models import Product
from modules.finance.models import Payment
from modules.parties.models import Party
from .models import DocumentKind, NeighborSupply, TradeDocument, TradeLine, ReceiptExtraCost


class NeighborSupplyInputSerializer(serializers.Serializer):
    supplier_id = serializers.PrimaryKeyRelatedField(
        source="supplier",
        queryset=Party.objects.filter(is_active=True, is_system=False),
    )
    quantity = serializers.DecimalField(max_digits=16, decimal_places=3, min_value=Decimal("0.001"))
    unit_price = serializers.DecimalField(max_digits=16, decimal_places=2, min_value=Decimal("0.01"))


class TradeLineInputSerializer(serializers.Serializer):
    product_id = serializers.PrimaryKeyRelatedField(source="product", queryset=Product.objects.filter(is_active=True))
    quantity = serializers.DecimalField(max_digits=16, decimal_places=3, min_value=Decimal("0.001"))
    unit_price = serializers.DecimalField(max_digits=16, decimal_places=2, min_value=Decimal("0.00"))
    discount_amount = serializers.DecimalField(max_digits=16, decimal_places=2, min_value=Decimal("0.00"), default=Decimal("0.00"))
    source_line_id = serializers.PrimaryKeyRelatedField(source="source_line", queryset=TradeLine.objects.all(), allow_null=True, required=False)
    neighbor_supply = NeighborSupplyInputSerializer(required=False, allow_null=True)

    def validate(self, attrs):
        if attrs["product"].unit == Product.Unit.PIECE and attrs["quantity"] != attrs["quantity"].to_integral_value():
            raise serializers.ValidationError({"quantity": "Для штучного товара количество должно быть целым."})
        gross = (attrs["quantity"] * attrs["unit_price"]).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if attrs["discount_amount"] > gross:
            raise serializers.ValidationError({"discount_amount": "Скидка не может превышать сумму позиции."})
        supply = attrs.get("neighbor_supply")
        if supply and supply["quantity"] > attrs["quantity"]:
            raise serializers.ValidationError({"neighbor_supply": {"quantity": "Количество от соседа не может превышать количество в строке."}})
        return attrs


class NeighborSupplySerializer(serializers.ModelSerializer):
    supplier_id = serializers.IntegerField(source="supplier.id", read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)

    class Meta:
        model = NeighborSupply
        fields = ["supplier_id", "supplier_name", "quantity", "unit_price", "amount"]


class TradeLineSerializer(serializers.ModelSerializer):
    product_id = serializers.IntegerField(source="product.id", read_only=True)
    product_image = serializers.ImageField(source="product.image", read_only=True)
    product_external_image_url = serializers.URLField(source="product.external_image_url", read_only=True)
    source_line_id = serializers.IntegerField(source="source_line.id", read_only=True, allow_null=True)
    neighbor_supply = NeighborSupplySerializer(read_only=True, allow_null=True)

    class Meta:
        model = TradeLine
        fields = ["id", "position", "product_id", "product_image", "product_external_image_url", "source_line_id", "product_name", "unit", "quantity", "unit_price", "discount_amount", "line_total", "allocated_extra_cost", "neighbor_supply"]


class ExtraCostSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReceiptExtraCost
        fields = ["id", "name", "amount"]
        read_only_fields = ["id"]


class TradeDocumentWriteSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=DocumentKind.choices)
    warehouse_id = serializers.IntegerField(min_value=1)
    party_id = serializers.IntegerField(min_value=1, allow_null=True, required=False)
    effective_date = serializers.DateField()
    note = serializers.CharField(max_length=4000, allow_blank=True, required=False)
    document_discount_amount = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=Decimal("0.00"), default=Decimal("0.00"))
    version = serializers.IntegerField(min_value=1, required=False)
    lines = TradeLineInputSerializer(many=True, allow_empty=False)
    extra_costs = ExtraCostSerializer(many=True, required=False, default=list)

    def validate(self, attrs):
        if attrs["kind"] not in {DocumentKind.OPENING, DocumentKind.SALE} and not attrs.get("party_id"):
            raise serializers.ValidationError({"party_id": "Для этого документа обязательно выберите человека."})
        if attrs.get("extra_costs") and attrs["kind"] != DocumentKind.RECEIPT:
            raise serializers.ValidationError({"extra_costs": "Дополнительные расходы допустимы только в поступлении."})
        if attrs["kind"] not in {DocumentKind.SALE, DocumentKind.CUSTOMER_ORDER} and any(line.get("neighbor_supply") for line in attrs["lines"]):
            raise serializers.ValidationError({"lines": "Товар от соседа допустим только в продаже или заказе покупателя."})
        subtotal = sum(
            (line["quantity"] * line["unit_price"]).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) - line["discount_amount"]
            for line in attrs["lines"]
        )
        if attrs.get("document_discount_amount", Decimal("0.00")) > subtotal:
            raise serializers.ValidationError({"document_discount_amount": "Скидка документа превышает сумму строк."})
        return attrs


class TradeDocumentSerializer(serializers.ModelSerializer):
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True)
    party_name = serializers.CharField(source="party.name", read_only=True, allow_null=True)
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    lines = TradeLineSerializer(many=True, read_only=True)
    extra_costs = ExtraCostSerializer(many=True, read_only=True)

    class Meta:
        model = TradeDocument
        fields = ["id", "kind", "kind_label", "status", "status_label", "number", "effective_date", "warehouse", "warehouse_name", "party", "party_name", "note", "amount_total", "document_discount_amount", "version", "source_document", "created_at", "updated_at", "posted_at", "cancelled_at", "cancellation_reason", "lines", "extra_costs"]


class CancelSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=300)


class DocumentPaymentInputSerializer(serializers.Serializer):
    method = serializers.ChoiceField(choices=(Payment.Method.CASH, Payment.Method.MBANK))
    amount = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=Decimal("0.01"))


class PostDocumentSerializer(serializers.Serializer):
    # paid_amount/payment_method are kept for older clients.
    paid_amount = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=Decimal("0.00"), required=False, default=Decimal("0.00"))
    payment_method = serializers.ChoiceField(choices=Payment.Method.choices, required=False, default=Payment.Method.CASH)
    payments = DocumentPaymentInputSerializer(many=True, required=False)

    def validate(self, attrs):
        payments = attrs.get("payments")
        if payments is not None:
            methods = [item["method"] for item in payments]
            if len(methods) != len(set(methods)):
                raise serializers.ValidationError({"payments": "Каждый способ оплаты можно указать только один раз."})
            if attrs.get("paid_amount", Decimal("0.00")) > 0:
                raise serializers.ValidationError("Передайте либо payments, либо старое поле paid_amount.")
        return attrs


class AssemblyStateSerializer(serializers.Serializer):
    assembled = serializers.BooleanField(default=True)

