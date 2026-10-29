from __future__ import annotations

import uuid

from .context import request_id_var


class RequestIdentityMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        incoming = request.headers.get("X-Request-ID", "")
        request_id = incoming[:80] if incoming else str(uuid.uuid4())
        request.request_id = request_id
        token = request_id_var.set(request_id)
        try:
            response = self.get_response(request)
            response["X-Request-ID"] = request_id
            if response.status_code in {401, 403} and request.path.startswith("/api/"):
                from modules.identity.models import AccessAttempt

                forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
                ip = (forwarded.split(",")[0].strip() if forwarded else request.META.get("REMOTE_ADDR")) or None
                AccessAttempt.objects.create(
                    username=getattr(getattr(request, "user", None), "username", ""),
                    ip_address=ip,
                    user_agent=request.headers.get("User-Agent", "")[:300],
                    outcome="forbidden" if response.status_code == 403 else "unauthorized",
                    request_id=request_id,
                )
            return response
        finally:
            request_id_var.reset(token)

