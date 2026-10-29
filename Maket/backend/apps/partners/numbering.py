from django.db import transaction


@transaction.atomic
def next_code():
    """Код нового контрагента: К-00001. Клиент не обязан придумывать код."""
    from .models import Counterparty
    last = 0
    for code in Counterparty.objects.select_for_update().filter(code__startswith="К-").values_list("code", flat=True):
        tail = code[2:]
        if tail.isdigit():
            last = max(last, int(tail))
    return f"К-{last + 1:05d}"
