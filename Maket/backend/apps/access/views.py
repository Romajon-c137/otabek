from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.authtoken.models import Token
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from django.contrib.auth import authenticate
from rest_framework.generics import GenericAPIView

from .serializers import CurrentUserSerializer


class CurrentUserView(GenericAPIView):
    serializer_class = CurrentUserSerializer

    def get(self, request):
        accesses = request.user.warehouse_accesses.select_related("warehouse")
        payload = {
            "id": request.user.id,
            "username": request.user.username,
            "is_superuser": request.user.is_superuser,
            "warehouses": [
                {"id": str(item.warehouse_id), "name": item.warehouse.name, "role": item.role}
                for item in accesses
            ],
        }
        return Response(self.get_serializer(payload).data)

class TokenLoginView(APIView):
    """Вход программы: логин и пароль меняются на токен, пароль на устройстве не хранится."""

    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(
        request=inline_serializer("TokenLoginRequest", {"username": serializers.CharField(), "password": serializers.CharField()}),
        responses=inline_serializer("TokenLoginResponse", {"token": serializers.CharField()}),
    )
    def post(self, request):
        user = authenticate(username=request.data.get("username", ""), password=request.data.get("password", ""))
        if not user or not user.is_active:
            return Response({"detail": "Неверный логин или пароль.", "code": "AUTH_REQUIRED"}, status=401)
        token, _ = Token.objects.get_or_create(user=user)
        return Response({"token": token.key})


class TokenLogoutView(APIView):
    @extend_schema(request=None, responses={204: None})
    def post(self, request):
        Token.objects.filter(user=request.user).delete()
        return Response(status=204)
