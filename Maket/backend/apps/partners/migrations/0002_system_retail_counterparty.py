from django.db import migrations


def create_retail_counterparty(apps, schema_editor):
    Counterparty = apps.get_model("partners", "Counterparty")
    Counterparty.objects.get_or_create(
        system_key="retail-customer",
        defaults={"code": "RETAIL", "name": "Розничный покупатель", "active": True},
    )


def remove_retail_counterparty(apps, schema_editor):
    Counterparty = apps.get_model("partners", "Counterparty")
    Counterparty.objects.filter(system_key="retail-customer").delete()


class Migration(migrations.Migration):
    dependencies = [("partners", "0001_initial")]
    operations = [migrations.RunPython(create_retail_counterparty, remove_retail_counterparty)]
