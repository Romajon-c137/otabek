from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("catalog", "0004_product_code")]

    operations = [
        migrations.CreateModel(
            name="OtabekWebhookReceipt",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("event_id", models.CharField(max_length=120, unique=True)),
                ("payload_sha256", models.CharField(max_length=64)),
                ("received_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={"ordering": ["-received_at"]},
        ),
    ]
