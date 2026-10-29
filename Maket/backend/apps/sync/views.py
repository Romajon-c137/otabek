import time

from django.db.models import Q
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.warehouses.models import WarehouseAccess

from .models import ChangeEvent
from .services import last_seq

MAX_LIMIT = 1000
MAX_WAIT = 25
POLL_STEP = 0.5


def _int_param(request, name, default, low, high):
    raw = request.query_params.get(name, default)
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise ValidationError({name: "Ожидается целое число."})
    return max(low, min(high, value))


def _visible(user):
    queryset = ChangeEvent.objects.all()
    if user.is_superuser:
        return queryset
    allowed = list(WarehouseAccess.objects.filter(user=user).values_list("warehouse_id", flat=True))
    return queryset.filter(Q(warehouse_id__isnull=True) | Q(warehouse_id__in=allowed))


def _event(item):
    return {
        "seq": item.seq, "entity": item.entity, "id": str(item.entity_id), "action": item.action,
        "doc_type": item.doc_type, "number": item.number, "status": item.status,
        "warehouse": str(item.warehouse_id) if item.warehouse_id else None,
        "counterparty": str(item.counterparty_id) if item.counterparty_id else None,
        "actor": item.actor, "at": item.created_at.isoformat(),
    }


class SyncStateView(APIView):
    """Текущий номер ленты. Клиент берёт его до загрузки снимка данных и затем запрашивает изменения после него."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response({"last_seq": last_seq()})


class ChangesView(APIView):
    """Изменения после номера since. wait>0 — ждать новые события до wait секунд (long polling)."""

    @extend_schema(
        parameters=[OpenApiParameter("since", int), OpenApiParameter("limit", int), OpenApiParameter("wait", int)],
        responses=OpenApiTypes.OBJECT,
    )
    def get(self, request):
        since = _int_param(request, "since", 0, 0, 2**62)
        limit = _int_param(request, "limit", 500, 1, MAX_LIMIT)
        wait = _int_param(request, "wait", 0, 0, MAX_WAIT)
        deadline = time.monotonic() + wait
        visible = _visible(request.user)
        while True:
            # номер головы читаем до выборки: всё, что не старше головы, уже попало в выборку
            head = last_seq()
            items = list(visible.filter(seq__gt=since, seq__lte=head).order_by("seq")[: limit + 1])
            if items or head > since or time.monotonic() >= deadline:
                break
            time.sleep(POLL_STEP)
        has_more = len(items) > limit
        items = items[:limit]
        # курсор продвигается и через события чужих складов, чтобы не запрашивать их снова
        cursor = items[-1].seq if has_more else max(since, head)
        return Response({"events": [_event(item) for item in items], "last_seq": cursor, "has_more": has_more})
