from decimal import Decimal

import django.core.validators
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("documents", "0002_accounting_workflows"),
        ("parties", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="NeighborSupply",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("quantity", models.DecimalField(decimal_places=3, max_digits=16, validators=[django.core.validators.MinValueValidator(Decimal("0.001"))])),
                ("unit_price", models.DecimalField(decimal_places=2, max_digits=16, validators=[django.core.validators.MinValueValidator(Decimal("0.00"))])),
                ("amount", models.DecimalField(decimal_places=2, max_digits=18, validators=[django.core.validators.MinValueValidator(Decimal("0.01"))])),
                ("line", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="neighbor_supply", to="documents.tradeline")),
                ("supplier", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="neighbor_supplies", to="parties.party")),
            ],
            options={
                "indexes": [models.Index(fields=["supplier", "line"], name="neighbor_supply_supplier_idx")],
                "constraints": [
                    models.CheckConstraint(condition=models.Q(("quantity__gt", 0)), name="neighbor_supply_quantity_positive"),
                    models.CheckConstraint(condition=models.Q(("unit_price__gte", 0)), name="neighbor_supply_price_nonnegative"),
                    models.CheckConstraint(condition=models.Q(("amount__gt", 0)), name="neighbor_supply_amount_positive"),
                ],
            },
        ),
    ]
