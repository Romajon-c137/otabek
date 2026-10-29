import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from modules.identity.models import UserProfile, UserRole


class Command(BaseCommand):
    help = "Создаёт или обновляет первого администратора из переменных окружения."

    def handle(self, *args, **options):
        username = os.getenv("BOOTSTRAP_ADMIN_USERNAME", "").strip()
        password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "")
        if not username or len(password) < 10:
            raise CommandError("Задайте BOOTSTRAP_ADMIN_USERNAME и пароль длиной не менее 10 символов.")
        user, created = get_user_model().objects.get_or_create(username=username, defaults={"is_staff": True, "is_superuser": True})
        user.is_active = True
        user.is_staff = True
        user.is_superuser = True
        user.set_password(password)
        user.save()
        UserProfile.objects.update_or_create(user=user, defaults={"role": UserRole.OWNER, "display_name": username})
        self.stdout.write(self.style.SUCCESS(f"Администратор {'создан' if created else 'обновлён'}: {username}"))

