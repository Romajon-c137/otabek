from django.db import models


class SyncCounter(models.Model):
    """Единственная строка-счётчик: под её блокировкой события получают номера строго в порядке фиксации."""

    value = models.BigIntegerField(default=0)


class ChangeEvent(models.Model):
    """Лента изменений: клиенты запрашивают всё, что появилось после известного им номера."""

    class Entity(models.TextChoices):
        DOCUMENT = "document", "Документ"
        PRODUCT = "product", "Товар"
        COUNTERPARTY = "counterparty", "Контрагент"

    class Action(models.TextChoices):
        SAVED = "saved", "Создан или изменён"
        DELETED = "deleted", "Удалён"

    seq = models.BigIntegerField(unique=True)
    entity = models.CharField(max_length=16, choices=Entity.choices)
    entity_id = models.UUIDField()
    action = models.CharField(max_length=8, choices=Action.choices, default=Action.SAVED)
    doc_type = models.CharField(max_length=32, blank=True)
    number = models.CharField(max_length=32, blank=True)
    status = models.CharField(max_length=16, blank=True)
    warehouse_id = models.UUIDField(null=True, blank=True)
    counterparty_id = models.UUIDField(null=True, blank=True)
    actor = models.CharField(max_length=150, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["seq"]
