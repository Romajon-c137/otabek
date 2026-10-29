from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("catalog", "0001_initial")]
    operations = [
        migrations.AddField(model_name="product", name="external_provider", field=models.CharField(blank=True, max_length=32)),
        migrations.AddField(model_name="product", name="external_product_id", field=models.PositiveBigIntegerField(blank=True, db_index=True, null=True)),
        migrations.AddField(model_name="product", name="external_variant_id", field=models.PositiveBigIntegerField(blank=True, null=True)),
        migrations.AddField(model_name="product", name="variant_name", field=models.CharField(blank=True, max_length=240)),
        migrations.AddField(model_name="product", name="external_image_url", field=models.URLField(blank=True, max_length=500)),
        migrations.AddField(model_name="product", name="track_stock", field=models.BooleanField(default=True)),
        migrations.AddConstraint(model_name="product", constraint=models.UniqueConstraint(condition=models.Q(("external_variant_id__isnull", False)), fields=("external_provider", "external_variant_id"), name="uq_product_external_variant")),
    ]
