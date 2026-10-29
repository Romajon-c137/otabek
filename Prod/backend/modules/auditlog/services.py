from datetime import date, datetime
from decimal import Decimal
from django.db import transaction

from modules.common.context import request_id_var
from .models import AuditRecord


def _json_safe(value):
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return value


@transaction.atomic
def record_action(*, actor, action: str, entity, warehouse_id=None, before=None, after=None, metadata=None):
    record = AuditRecord.objects.create(
        actor=actor,
        request_id=request_id_var.get(),
        action=action,
        entity_type=entity._meta.label_lower,
        entity_id=str(entity.pk),
        warehouse_id=warehouse_id,
        before=_json_safe(before or {}),
        after=_json_safe(after or {}),
        metadata=_json_safe(metadata or {}),
    )
    from modules.syncfeed.services import publish_change
    publish_change(action=action, entity_type=entity._meta.label_lower, entity_id=entity.pk, warehouse_id=warehouse_id, summary=_json_safe(after or {}))
    return record

