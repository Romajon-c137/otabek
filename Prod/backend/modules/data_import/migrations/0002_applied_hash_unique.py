from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("data_import", "0001_initial")]
    operations = [migrations.AddConstraint(model_name="importbatch", constraint=models.UniqueConstraint(condition=models.Q(("status", "applied")), fields=("content_hash",), name="uq_applied_import_hash"))]
