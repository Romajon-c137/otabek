from django.db import models


class SyncCounter(models.Model):
    singleton = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    value = models.BigIntegerField(default=0)


class ChangeEvent(models.Model):
    sequence = models.BigIntegerField(primary_key=True)
    warehouse_id = models.BigIntegerField(null=True, blank=True)
    entity_type = models.CharField(max_length=160)
    entity_id = models.CharField(max_length=80)
    action = models.CharField(max_length=120)
    summary = models.JSONField(default=dict)
    occurred_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["sequence"]
        indexes = [models.Index(fields=["warehouse_id", "sequence"], name="sync_warehouse_seq_idx")]
