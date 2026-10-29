from django.db import migrations, models


def convert_legacy_methods(apps, schema_editor):
    Payment = apps.get_model("finance", "Payment")
    Payment.objects.filter(method="card").update(method="mbank")
    Payment.objects.filter(method="transfer").update(method="aiyl")


class Migration(migrations.Migration):
    dependencies = [("finance", "0003_obligation_product_details")]
    operations = [
        migrations.RunPython(convert_legacy_methods, migrations.RunPython.noop),
        migrations.AlterField(model_name="payment", name="method", field=models.CharField(choices=[("cash", "Наличные"), ("mbank", "МБанк"), ("aiyl", "Айыл Банк")], max_length=12)),
    ]
