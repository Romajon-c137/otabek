import time

from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema

from modules.identity.permissions import visible_warehouse_ids
from .models import ChangeEvent, SyncCounter


class SyncStateView(APIView):
    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        value = SyncCounter.objects.filter(singleton=1).values_list("value", flat=True).first() or 0
        return Response({"last_seq": value})


class SyncChangesView(APIView):
    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        try:
            since = max(0, int(request.query_params.get("since", 0)))
            limit = min(500, max(1, int(request.query_params.get("limit", 500))))
            wait = min(25, max(0, int(request.query_params.get("wait", 0))))
        except ValueError:
            return Response({"detail": "since, limit и wait должны быть целыми числами."}, status=400)
        deadline = time.monotonic() + wait
        while True:
            rows = list(ChangeEvent.objects.filter(sequence__gt=since).order_by("sequence")[:limit])
            if rows or time.monotonic() >= deadline:
                break
            time.sleep(0.25)
        allowed = set(visible_warehouse_ids(request.user))
        visible = [row for row in rows if row.warehouse_id is None or row.warehouse_id in allowed]
        return Response({"last_seq": rows[-1].sequence if rows else since, "changes": [{"seq": row.sequence, "entity_type": row.entity_type, "entity_id": row.entity_id, "action": row.action, "summary": row.summary, "occurred_at": row.occurred_at} for row in visible]})
