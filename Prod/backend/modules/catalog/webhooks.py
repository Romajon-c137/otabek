import hashlib
import hmac
import json
import time

from django.conf import settings
from django.db import transaction
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from modules.syncfeed.services import publish_change

from .models import OtabekWebhookReceipt
from .otabek import OtabekSyncError, sync_otabek_catalog


SUPPORTED_EVENTS = {
    "catalog.changed",
    "product.created",
    "product.updated",
    "product.deleted",
}


class OtabekWebhookSerializer(serializers.Serializer):
    event = serializers.ChoiceField(choices=sorted(SUPPORTED_EVENTS))
    event_id = serializers.CharField(max_length=120)


class OtabekWebhookView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=OtabekWebhookSerializer, responses={200: OpenApiTypes.OBJECT})
    def post(self, request):
        secret = settings.OTABEK_WEBHOOK_SECRET
        if len(secret) < 32:
            return Response({"detail": "Webhook Otabek не настроен."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        timestamp = request.headers.get("X-Otabek-Timestamp", "")
        signature = request.headers.get("X-Otabek-Signature", "")
        try:
            timestamp_value = int(timestamp)
        except ValueError:
            return Response({"detail": "Недействительная подпись webhook."}, status=status.HTTP_401_UNAUTHORIZED)
        if abs(int(time.time()) - timestamp_value) > settings.OTABEK_WEBHOOK_MAX_AGE_SECONDS:
            return Response({"detail": "Webhook устарел."}, status=status.HTTP_401_UNAUTHORIZED)

        body = request.body
        expected = hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()
        provided = signature.removeprefix("sha256=")
        if not hmac.compare_digest(expected, provided):
            return Response({"detail": "Недействительная подпись webhook."}, status=status.HTTP_401_UNAUTHORIZED)

        try:
            payload = json.loads(body)
        except (TypeError, ValueError):
            return Response({"detail": "Тело webhook должно быть JSON-объектом."}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(payload, dict):
            return Response({"detail": "Тело webhook должно быть JSON-объектом."}, status=status.HTTP_400_BAD_REQUEST)
        event = str(payload.get("event") or "")
        event_id = str(payload.get("event_id") or "")
        if event not in SUPPORTED_EVENTS or not event_id or len(event_id) > 120:
            return Response({"detail": "Неизвестное событие или отсутствует event_id."}, status=status.HTTP_400_BAD_REQUEST)

        payload_hash = hashlib.sha256(body).hexdigest()
        receipt, created = OtabekWebhookReceipt.objects.get_or_create(
            event_id=event_id,
            defaults={"payload_sha256": payload_hash},
        )
        if not created:
            if receipt.payload_sha256 != payload_hash:
                return Response({"detail": "event_id уже использован для другого события."}, status=status.HTTP_409_CONFLICT)
            return Response({"accepted": True, "duplicate": True, "event_id": event_id})

        try:
            result = sync_otabek_catalog()
        except OtabekSyncError as exc:
            receipt.delete()
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        except Exception:
            receipt.delete()
            raise

        with transaction.atomic():
            change = publish_change(
                action="catalog.otabek_synced",
                entity_type="catalog.product",
                entity_id=event_id,
                summary=result,
            )
        return Response({"accepted": True, "event_id": event_id, "sequence": change.sequence, **result})
