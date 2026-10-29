from django.db import transaction

from .models import ChangeEvent, SyncCounter


def emit(**fields):
    """Записать событие после фиксации транзакции; при откате событие не появляется."""
    transaction.on_commit(lambda: _write(fields))


@transaction.atomic
def _write(fields):
    counter, _ = SyncCounter.objects.select_for_update().get_or_create(pk=1)
    counter.value += 1
    counter.save(update_fields=["value"])
    ChangeEvent.objects.create(seq=counter.value, **fields)


def last_seq():
    counter = SyncCounter.objects.filter(pk=1).first()
    return counter.value if counter else 0
