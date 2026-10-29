import uuid


class RequestIdMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        supplied = request.headers.get("X-Request-ID")
        try:
            request.request_id = str(uuid.UUID(supplied)) if supplied else str(uuid.uuid4())
        except (ValueError, TypeError, AttributeError):
            request.request_id = str(uuid.uuid4())
        response = self.get_response(request)
        response["X-Request-ID"] = request.request_id
        return response


class CorsMiddleware:
    """Разрешает запросы из клиентов-приложений с перечисленных источников; авторизация только заголовком, куки не нужны."""

    ALLOW_HEADERS = "Authorization, Content-Type, Idempotency-Key, X-Request-ID"
    ALLOW_METHODS = "GET, POST, PATCH, PUT, DELETE, OPTIONS"

    def __init__(self, get_response):
        from django.conf import settings
        self.get_response = get_response
        self.allowed = set(getattr(settings, "CORS_ALLOWED_ORIGINS", []))

    def __call__(self, request):
        origin = request.headers.get("Origin", "")
        allowed = origin in self.allowed
        if allowed and request.method == "OPTIONS" and request.headers.get("Access-Control-Request-Method"):
            from django.http import HttpResponse
            response = HttpResponse(status=204)
        else:
            response = self.get_response(request)
        if allowed:
            response["Access-Control-Allow-Origin"] = origin
            response["Access-Control-Allow-Headers"] = self.ALLOW_HEADERS
            response["Access-Control-Allow-Methods"] = self.ALLOW_METHODS
            response["Access-Control-Expose-Headers"] = "X-Request-ID"
            response["Access-Control-Max-Age"] = "600"
            response["Vary"] = "Origin"
        return response
