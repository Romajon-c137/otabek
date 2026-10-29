from decimal import Decimal

import django.core.validators
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("documents", "0001_initial")]

    operations = [
        migrations.AddField(
            model_name="tradedocument",
            name="document_discount_amount",
            field=models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=18),
        ),
        migrations.AddField(
            model_name="tradeline",
            name="allocated_extra_cost",
            field=models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=18, validators=[django.core.validators.MinValueValidator(0)]),
        ),
        migrations.AddField(
            model_name="tradeline",
            name="source_line",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="return_lines", to="documents.tradeline"),
        ),
        migrations.AlterField(
            model_name="tradedocument",
            name="status",
            field=models.CharField(choices=[("draft", "Черновик"), ("confirmed", "На сборке"), ("assembled", "Собран"), ("posted", "Проведён"), ("fulfilled", "Выполнен"), ("cancelled", "Отменён")], default="draft", max_length=16),
        ),
        migrations.CreateModel(
            name="ReceiptExtraCost",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=160)),
                ("amount", models.DecimalField(decimal_places=2, max_digits=18, validators=[django.core.validators.MinValueValidator(Decimal("0.01"))])),
                ("document", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="extra_costs", to="documents.tradedocument")),
            ],
            options={"ordering": ["id"]},
        ),
        migrations.AddConstraint(
            model_name="receiptextracost",
            constraint=models.CheckConstraint(condition=models.Q(("amount__gt", 0)), name="receipt_extra_cost_positive"),
        ),
    ]
