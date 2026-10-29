from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("inventory", "0001_initial")]

    operations = [
        migrations.AlterField(model_name="stocklot", name="unit_cost", field=models.DecimalField(decimal_places=6, max_digits=18)),
        migrations.AlterField(model_name="stockmovement", name="unit_cost", field=models.DecimalField(decimal_places=6, max_digits=18)),
        migrations.AlterField(model_name="fifoallocation", name="unit_cost", field=models.DecimalField(decimal_places=6, max_digits=18)),
    ]
