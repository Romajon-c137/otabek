from django.contrib.auth import authenticate
from rest_framework import serializers


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(trim_whitespace=False, write_only=True)

    def validate(self, attrs):
        user = authenticate(request=self.context.get("request"), username=attrs["username"], password=attrs["password"])
        if user is None or not user.is_active:
            raise serializers.ValidationError("Неверный логин или пароль.")
        attrs["user"] = user
        return attrs

