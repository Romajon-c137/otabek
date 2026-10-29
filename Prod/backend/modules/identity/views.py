import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema

from .models import AccessAttempt, AccessToken
from .permissions import role_for
from .serializers import LoginSerializer


def client_ip(request):
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    return (forwarded.split(",")[0].strip() if forwarded else request.META.get("REMOTE_ADDR")) or None


def user_payload(user):
    grants = user.warehouse_grants.select_related("warehouse").filter(warehouse__is_active=True)
    if user.is_superuser:
        from modules.warehouses.models import Warehouse

        warehouses = [{"id": w.id, "code": w.code, "name": w.name, "permissions": ["all"]} for w in Warehouse.objects.filter(is_active=True)]
    else:
        warehouses = [{
            "id": grant.warehouse_id,
            "code": grant.warehouse.code,
            "name": grant.warehouse.name,
            "permissions": [name for name in ("can_view", "can_sell", "can_manage_stock", "can_manage_finance", "can_manage_settings") if getattr(grant, name)],
        } for grant in grants]
    profile = getattr(user, "business_profile", None)
    return {
        "id": user.id,
        "username": user.username,
        "display_name": profile.display_name if profile and profile.display_name else user.get_full_name() or user.username,
        "role": role_for(user),
        "warehouses": warehouses,
    }


class LoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=LoginSerializer, responses={200: OpenApiTypes.OBJECT})
    def post(self, request):
        username = str(request.data.get("username", ""))[:150]
        ip = client_ip(request)
        recent = timezone.now() - timedelta(minutes=15)
        failures = AccessAttempt.objects.filter(
            Q(username=username) | Q(ip_address=ip),
            outcome="failure",
            occurred_at__gte=recent,
        ).count()
        if failures >= 5:
            AccessAttempt.objects.create(username=username, ip_address=ip, user_agent=request.headers.get("User-Agent", "")[:300], outcome="throttled", request_id=getattr(request, "request_id", ""))
            return Response({"detail": "Слишком много неудачных попыток. Повторите через 15 минут."}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        serializer = LoginSerializer(data=request.data, context={"request": request})
        if not serializer.is_valid():
            AccessAttempt.objects.create(username=username, ip_address=ip, user_agent=request.headers.get("User-Agent", "")[:300], outcome="failure", request_id=getattr(request, "request_id", ""))
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        user = serializer.validated_data["user"]
        raw = secrets.token_urlsafe(40)
        token = AccessToken.objects.create(user=user, token_hash=hashlib.sha256(raw.encode("ascii")).hexdigest(), expires_at=timezone.now() + timedelta(hours=settings.TOKEN_TTL_HOURS), label=request.headers.get("User-Agent", "")[:120])
        AccessAttempt.objects.create(username=user.username, ip_address=ip, user_agent=request.headers.get("User-Agent", "")[:300], outcome="success", request_id=getattr(request, "request_id", ""))
        return Response({"token": raw, "expires_at": token.expires_at, "user": user_payload(user)})


class SessionView(APIView):
    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        return Response(user_payload(request.user))


class LogoutView(APIView):
    @extend_schema(request=None, responses={204: None})
    def post(self, request):
        token = request.auth
        if isinstance(token, AccessToken):
            token.revoked_at = timezone.now()
            token.save(update_fields=["revoked_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)

