from decimal import Decimal

from rest_framework import serializers

from apps.partners.models import Counterparty
from apps.settlements.models import Obligation
from .models import Payment, PaymentBreakdown


class PaymentBreakdownWriteSerializer(serializers.Serializer):
    method = serializers.ChoiceField(choices=PaymentBreakdown.Method.choices)
    amount = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=Decimal("0.01"))


class PaymentWriteSerializer(serializers.Serializer):
    id = serializers.UUIDField(required=False)
    number = serializers.CharField(max_length=32, required=False)
    counterparty = serializers.PrimaryKeyRelatedField(queryset=Counterparty.objects.filter(active=True))
    direction = serializers.ChoiceField(choices=Payment.Direction.choices)
    amount = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=Decimal("0.01"))
    reason = serializers.CharField(required=False, allow_blank=True, default="")
    breakdown = PaymentBreakdownWriteSerializer(many=True, allow_empty=False)

    def validate_id(self, value):
        from apps.documents.models import Document
        if Document.objects.filter(pk=value).exists():
            raise serializers.ValidationError("Документ с таким идентификатором уже создан.", code="exists")
        return value

    def validate(self, attrs):
        methods = [item["method"] for item in attrs["breakdown"]]
        if len(methods) != len(set(methods)):
            raise serializers.ValidationError({"breakdown": "Способ оплаты можно указать только один раз."})
        total = sum((item["amount"] for item in attrs["breakdown"]), Decimal("0.00"))
        if total != attrs["amount"]:
            raise serializers.ValidationError({"breakdown": "Сумма способов оплаты должна совпадать с платежом."})
        return attrs

    def create(self, validated_data):
        from apps.documents.models import Document
        breakdown = validated_data.pop("breakdown")
        direction = validated_data.pop("direction")
        amount = validated_data.pop("amount")
        document = Document.objects.create(
            type=Document.Type.PAYMENT, author=self.context["request"].user, **validated_data,
        )
        payment = Payment.objects.create(document=document, direction=direction, amount=amount)
        PaymentBreakdown.objects.bulk_create([
            PaymentBreakdown(payment=payment, **item) for item in breakdown
        ])
        return payment


class PaymentBreakdownReadSerializer(serializers.ModelSerializer):
    class Meta:
        model = PaymentBreakdown
        fields = ["method", "amount"]


class PaymentReadSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(source="document_id")
    number = serializers.CharField(source="document.number")
    status = serializers.CharField(source="document.status")
    version = serializers.IntegerField(source="document.version")
    counterparty = serializers.UUIDField(source="document.counterparty_id")
    reason = serializers.CharField(source="document.reason")
    posted_at = serializers.DateTimeField(source="document.posted_at")
    breakdown = PaymentBreakdownReadSerializer(many=True)
    source_document = serializers.UUIDField(source="source_document_id", allow_null=True, read_only=True)
    source_type = serializers.CharField(source="source_document.type", allow_null=True, read_only=True, default=None)
    created_at = serializers.DateTimeField(source="document.created_at", read_only=True)
    author = serializers.CharField(source="document.author.username", read_only=True)

    class Meta:
        model = Payment
        fields = ["id", "number", "status", "version", "counterparty", "direction", "amount", "reason", "posted_at", "breakdown", "source_document", "source_type", "created_at", "author"]


class PaymentAllocationWriteSerializer(serializers.Serializer):
    obligation = serializers.PrimaryKeyRelatedField(queryset=Obligation.objects.all())
    amount = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=Decimal("0.01"))


class PostPaymentSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)
    allocations = PaymentAllocationWriteSerializer(many=True, required=False, default=list)
