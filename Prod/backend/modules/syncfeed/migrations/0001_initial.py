from django.db import migrations, models


def seed_counter(apps, schema_editor):
    apps.get_model("syncfeed", "SyncCounter").objects.get_or_create(singleton=1, defaults={"value": 0})


class Migration(migrations.Migration):
    initial = True
    dependencies = []
    operations = [
        migrations.CreateModel(name="SyncCounter", fields=[("singleton", models.PositiveSmallIntegerField(default=1, editable=False, primary_key=True, serialize=False)), ("value", models.BigIntegerField(default=0))]),
        migrations.CreateModel(name="ChangeEvent", fields=[("sequence", models.BigIntegerField(primary_key=True, serialize=False)), ("warehouse_id", models.BigIntegerField(blank=True, null=True)), ("entity_type", models.CharField(max_length=160)), ("entity_id", models.CharField(max_length=80)), ("action", models.CharField(max_length=120)), ("summary", models.JSONField(default=dict)), ("occurred_at", models.DateTimeField(auto_now_add=True))], options={"ordering": ["sequence"]}),
        migrations.AddIndex(model_name="changeevent", index=models.Index(fields=["warehouse_id", "sequence"], name="sync_warehouse_seq_idx")),
        migrations.RunPython(seed_counter, migrations.RunPython.noop),
    ]
