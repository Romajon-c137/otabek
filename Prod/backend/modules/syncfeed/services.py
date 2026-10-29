from .models import ChangeEvent, SyncCounter


def publish_change(*, action, entity_type, entity_id, warehouse_id=None, summary=None):
    counter, _ = SyncCounter.objects.select_for_update().get_or_create(singleton=1)
    counter.value += 1
    counter.save(update_fields=["value"])
    return ChangeEvent.objects.create(sequence=counter.value, warehouse_id=warehouse_id, entity_type=entity_type, entity_id=str(entity_id), action=action, summary=summary or {})
