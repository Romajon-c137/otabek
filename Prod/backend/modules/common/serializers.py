from rest_framework import serializers


class IdempotencySerializer(serializers.Serializer):
    idempotency_key = serializers.CharField(max_length=120, required=False)

    def key(self):
        request = self.context["request"]
        return request.headers.get("Idempotency-Key") or self.validated_data.get("idempotency_key", "")

