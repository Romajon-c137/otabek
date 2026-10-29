import hashlib

from django.utils import timezone
from rest_framework import authentication, exceptions

from .models import AccessToken


class ExpiringTokenAuthentication(authentication.BaseAuthentication):
    keyword = "Token"

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).split()
        if not header:
            return None
        if len(header) != 2 or header[0].decode().lower() != self.keyword.lower():
            raise exceptions.AuthenticationFailed("Некорректный заголовок авторизации.")
        try:
            raw = header[1].decode("ascii")
        except UnicodeError as exc:
            raise exceptions.AuthenticationFailed("Некорректный токен.") from exc
        token_hash = hashlib.sha256(raw.encode("ascii")).hexdigest()
        try:
            token = AccessToken.objects.select_related("user").get(token_hash=token_hash)
        except AccessToken.DoesNotExist as exc:
            raise exceptions.AuthenticationFailed("Токен не найден.") from exc
        if not token.is_active or not token.user.is_active:
            raise exceptions.AuthenticationFailed("Срок действия токена истёк.")
        AccessToken.objects.filter(pk=token.pk).update(last_used_at=timezone.now())
        return token.user, token

