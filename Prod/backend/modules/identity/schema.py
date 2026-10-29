from drf_spectacular.extensions import OpenApiAuthenticationExtension


class ExpiringTokenScheme(OpenApiAuthenticationExtension):
    target_class = "modules.identity.authentication.ExpiringTokenAuthentication"
    name = "expiringToken"

    def get_security_definition(self, auto_schema):
        return {"type": "apiKey", "in": "header", "name": "Authorization", "description": "Формат: Token <значение>"}

