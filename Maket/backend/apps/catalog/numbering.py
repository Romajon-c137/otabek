from django.db import transaction


@transaction.atomic
def next_code():
    """Код нового товара: 000001, 000002… Клиент не обязан придумывать код."""
    from .models import Product
    last = 0
    for code in Product.objects.select_for_update().values_list("code", flat=True):
        if code.isdigit():
            last = max(last, int(code))
    return f"{last + 1:06d}"
