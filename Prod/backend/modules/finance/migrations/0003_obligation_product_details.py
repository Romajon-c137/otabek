import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("catalog", "0001_initial"), ("finance", "0002_obligation_source_payment")]

    operations = [
        migrations.AddField(model_name="obligation", name="product", field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="obligations", to="catalog.product")),
        migrations.AddField(model_name="obligation", name="original_quantity", field=models.DecimalField(blank=True, decimal_places=3, max_digits=18, null=True)),
        migrations.AddField(model_name="obligation", name="unit_price", field=models.DecimalField(blank=True, decimal_places=2, max_digits=18, null=True)),
    ]
