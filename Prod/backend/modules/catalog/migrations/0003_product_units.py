from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("catalog", "0002_external_catalog")]
    operations = [migrations.AlterField(model_name="product", name="unit", field=models.CharField(choices=[("piece", "шт."), ("kg", "кг"), ("meter", "м")], default="piece", max_length=12))]
