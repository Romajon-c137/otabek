from rest_framework.exceptions import APIException


class Conflict(APIException):
    status_code = 409
    default_detail = "Операция конфликтует с текущим состоянием данных."
    default_code = "state_conflict"


class InsufficientStock(Conflict):
    default_detail = "Недостаточно доступного товара."
    default_code = "insufficient_stock"

    def __init__(self, *, product, stock, reserved, requested):
        available = stock - reserved
        super().__init__({
            "product_id": product.pk,
            "product_name": product.name,
            "stock": stock,
            "reserved": reserved,
            "available": available,
            "requested": requested,
            "missing": requested - available,
        }, code=self.default_code)

