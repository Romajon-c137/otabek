from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("catalog", "0002_category_remove_product_barcode_remove_product_sku_and_more")]

    operations = [
        migrations.AddField(
            model_name="product",
            name="external_image_url",
            field=models.URLField(blank=True, max_length=500),
        ),
        migrations.AddField(
            model_name="product",
            name="external_product_id",
            field=models.PositiveBigIntegerField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="product",
            name="external_size_id",
            field=models.PositiveBigIntegerField(blank=True, null=True, unique=True),
        ),
        migrations.AddField(
            model_name="product",
            name="variant_name",
            field=models.CharField(blank=True, max_length=255),
        ),
    ]
