from rest_framework import serializers

from .models import Counterparty


class CounterpartySerializer(serializers.ModelSerializer):
    is_system = serializers.BooleanField(read_only=True)

    class Meta:
        model = Counterparty
        fields = ["id", "code", "name", "phone", "note", "system_key", "is_system", "active", "created_at", "updated_at"]
        read_only_fields = ["system_key", "is_system", "created_at", "updated_at"]
        extra_kwargs = {"id": {"read_only": False, "required": False}, "code": {"required": False}}

    def validate_id(self, value):
        # идентификатор задаёт программа; повтор после потерянного ответа — понятная ошибка поля id, а не сбой
        if (self.instance is None or self.instance.pk != value) and Counterparty.objects.filter(pk=value).exists():
            raise serializers.ValidationError("Запись с таким идентификатором уже создана.", code="exists")
        return value

    def create(self, validated_data):
        if not validated_data.get("code"):
            from .numbering import next_code
            validated_data["code"] = next_code()
        return super().create(validated_data)

