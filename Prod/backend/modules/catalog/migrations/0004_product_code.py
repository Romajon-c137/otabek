from django.db import migrations, models
import modules.catalog.models


def populate_codes(apps, schema_editor):
    Product = apps.get_model("catalog", "Product")
    for product in Product.objects.filter(code__isnull=True):
        product.code = f"PRD-{product.pk:010d}"
        product.save(update_fields=["code"])


class Migration(migrations.Migration):
    dependencies = [("catalog", "0003_product_units")]
    operations = [
        migrations.AddField(model_name="product", name="code", field=models.CharField(max_length=32, null=True, unique=True)),
        migrations.RunPython(populate_codes, migrations.RunPython.noop),
        migrations.AlterField(model_name="product", name="code", field=models.CharField(default=modules.catalog.models.generate_product_code, editable=False, max_length=32, unique=True)),
    ]
