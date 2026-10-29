from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("parties", "0001_initial")]
    operations = [
        migrations.AddField(model_name="party", name="system_key", field=models.CharField(blank=True, max_length=32, null=True, unique=True)),
        migrations.AddField(model_name="party", name="is_system", field=models.BooleanField(default=False)),
    ]
