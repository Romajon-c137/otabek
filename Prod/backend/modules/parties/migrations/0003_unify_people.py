from django.db import migrations, models


def make_people_universal(apps, schema_editor):
    Party = apps.get_model("parties", "Party")
    Party.objects.filter(is_system=False).update(kind="both")


class Migration(migrations.Migration):
    dependencies = [("parties", "0002_system_parties")]

    operations = [
        migrations.AlterField(
            model_name="party",
            name="kind",
            field=models.CharField(
                choices=[
                    ("customer", "Покупатель"),
                    ("supplier", "Поставщик"),
                    ("both", "Покупатель и поставщик"),
                ],
                default="both",
                max_length=12,
            ),
        ),
        migrations.RunPython(make_people_universal, migrations.RunPython.noop),
    ]
