from rest_framework.exceptions import APIException
from rest_framework.views import exception_handler as drf_exception_handler


class VersionConflict(APIException):
    status_code = 409
    default_code = "VERSION_CONFLICT"
    default_detail = "Документ был изменён другим пользователем. Обновите данные."


def api_exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is None:
        return None
    request = context.get("request")
    request_id = getattr(request, "request_id", None)
    if isinstance(response.data, dict):
        response.data.setdefault("request_id", request_id)
        if "code" not in response.data and isinstance(exc, APIException):
            # ValidationError may contain nested dictionaries/lists.  Request-id
            # middleware also attaches a plain string to ``exc.detail`` before
            # DRF gets here, so calling get_codes() can no longer safely walk
            # every leaf.  The top-level code is stable and useful to clients;
            # field-level codes remain present in the normal DRF payload.
            response.data["code"] = getattr(exc, "default_code", "error")
    return response

