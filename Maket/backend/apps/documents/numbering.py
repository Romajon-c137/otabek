from django.db import transaction

PREFIX = {
    "opening_stock": "НО", "receipt": "ПТ", "sale": "ПР", "buyer_return": "ВК", "supplier_return": "ВП",
    "payment": "ОП", "offset": "ВЗ", "order": "ЗК", "opening_debt": "НД",
}


@transaction.atomic
def next_number(doc_type):
    """Следующий номер документа типа: ПР-000001. Счётчик блокируется, поэтому номера не повторяются."""
    from .models import DocumentCounter
    counter, _ = DocumentCounter.objects.select_for_update().get_or_create(doc_type=doc_type)
    counter.value += 1
    counter.save(update_fields=["value"])
    return f"{PREFIX.get(doc_type, 'ДОК')}-{counter.value:06d}"
