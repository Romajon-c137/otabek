from rest_framework import serializers

from .models import Obligation, SettlementMovement


class ObligationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Obligation
        fields = ["id", "source_document", "side", "original_amount", "open_amount", "created_at"]


class SettlementMovementSerializer(serializers.ModelSerializer):
    document_number = serializers.CharField(source="document.number")
    document_type = serializers.CharField(source="document.type")

    class Meta:
        model = SettlementMovement
        fields = ["id", "document", "document_number", "document_type", "obligation", "signed_amount", "created_at"]
