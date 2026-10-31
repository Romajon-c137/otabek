from decimal import Decimal

from rest_framework import serializers

from .models import Obligation, ObligationSide, Payment, SettlementMovement


class ObligationSerializer(serializers.ModelSerializer):
    party_name = serializers.CharField(source="party.name", read_only=True)
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True)
    source_number = serializers.CharField(source="source_document.number", read_only=True, allow_null=True)

    class Meta:
        model = Obligation
        fields = ["id", "party", "party_name", "warehouse", "warehouse_name", "side", "original_amount", "open_amount", "effective_date", "due_date", "source_document", "source_number", "product", "original_quantity", "unit_price", "reason", "created_at", "reversed_at"]


class PaymentSerializer(serializers.ModelSerializer):
    party_name = serializers.CharField(source="party.name", read_only=True)
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True)

    class Meta:
        model = Payment
        fields = ["id", "number", "direction", "method", "status", "party", "party_name", "warehouse", "warehouse_name", "amount", "effective_date", "note", "source_document", "created_at", "voided_at"]


class PaymentCreateSerializer(serializers.Serializer):
    warehouse_id = serializers.IntegerField(min_value=1)
    party_id = serializers.IntegerField(min_value=1)
    direction = serializers.ChoiceField(choices=Payment.Direction.choices)
    method = serializers.ChoiceField(choices=Payment.Method.choices)
    amount = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=Decimal("0.01"))
    effective_date = serializers.DateField()
    note = serializers.CharField(max_length=300, allow_blank=True, required=False)
    applications = serializers.ListField(child=serializers.DictField(), required=False, default=list)

    def validate_applications(self, value):
        normalized = []
        seen = set()
        for index, item in enumerate(value):
            try:
                obligation_id = int(item.get("obligation_id"))
                amount = Decimal(str(item.get("amount"))).quantize(Decimal("0.01"))
            except (TypeError, ValueError, ArithmeticError):
                raise serializers.ValidationError(f"Распределение {index + 1} заполнено неверно.")
            if obligation_id <= 0 or amount <= 0:
                raise serializers.ValidationError(f"Распределение {index + 1} должно иметь положительные значения.")
            if obligation_id in seen:
                raise serializers.ValidationError("Один долг нельзя указывать дважды.")
            seen.add(obligation_id)
            normalized.append({"obligation_id": obligation_id, "amount": amount})
        return normalized

    def validate(self, attrs):
        applications = attrs.get("applications", [])
        if applications and sum((item["amount"] for item in applications), Decimal("0.00")) != attrs["amount"]:
            raise serializers.ValidationError({"applications": "Сумма распределений должна совпадать с оплатой."})
        return attrs


class SplitPaymentPartSerializer(serializers.Serializer):
    method = serializers.ChoiceField(choices=Payment.Method.choices)
    amount = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=Decimal("0.01"))


class SplitPaymentCreateSerializer(serializers.Serializer):
    warehouse_id = serializers.IntegerField(min_value=1)
    party_id = serializers.IntegerField(min_value=1)
    direction = serializers.ChoiceField(choices=Payment.Direction.choices)
    effective_date = serializers.DateField()
    note = serializers.CharField(max_length=300, allow_blank=True, required=False)
    parts = SplitPaymentPartSerializer(many=True, min_length=1)

    def validate_parts(self, value):
        methods = [item["method"] for item in value]
        if len(methods) != len(set(methods)):
            raise serializers.ValidationError("Каждый способ оплаты можно указать только один раз.")
        return value


class ManualDebtCreateSerializer(serializers.Serializer):
    warehouse_id = serializers.IntegerField(min_value=1)
    party_id = serializers.IntegerField(min_value=1)
    side = serializers.ChoiceField(choices=ObligationSide.choices)
    amount = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=Decimal("0.01"))
    effective_date = serializers.DateField()
    due_date = serializers.DateField(required=False, allow_null=True)
    reason = serializers.CharField(max_length=300)

    def validate(self, attrs):
        if attrs.get("due_date") and attrs["due_date"] < attrs["effective_date"]:
            raise serializers.ValidationError({"due_date": "Срок оплаты не может быть раньше даты долга."})
        return attrs


class VoidPaymentSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=300)


class SettlementMovementSerializer(serializers.ModelSerializer):
    class Meta:
        model = SettlementMovement
        fields = ["id", "party", "warehouse", "event_type", "receivable_delta", "payable_delta", "obligation", "payment", "document", "description", "occurred_at"]

