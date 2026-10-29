import json
from decimal import Decimal, InvalidOperation
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

from django.conf import settings
from django.db import transaction

from .models import Product
from .numbering import next_code


class OtabekError(RuntimeError):
    pass


def _request(path, *, method="GET", token="", body=None):
    url = f"{settings.OTABEK_API_URL}/{path.lstrip('/')}"
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    try:
        with urlopen(Request(url, data=data, headers=headers, method=method), timeout=settings.OTABEK_TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        if exc.code in {401, 403}:
            raise OtabekError("Otabek отклонил логин или пароль.") from exc
        raise OtabekError(f"Otabek API вернул ошибку HTTP {exc.code}.") from exc
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise OtabekError("Не удалось получить каталог из Otabek.") from exc


def _price(value):
    try:
        return max(Decimal("0"), Decimal(str(value or 0))).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        return Decimal("0.00")


def _photo_url(value):
    if not value:
        return ""
    root = settings.OTABEK_API_URL.removesuffix("/api") + "/"
    return urljoin(root, str(value))


def _items(payload):
    return payload.get("results", []) if isinstance(payload, dict) else payload


@transaction.atomic
def sync_products():
    if not settings.OTABEK_USERNAME or not settings.OTABEK_PASSWORD:
        raise OtabekError("На сервере не заданы OTABEK_USERNAME и OTABEK_PASSWORD.")
    auth = _request("token/", method="POST", body={
        "username": settings.OTABEK_USERNAME,
        "password": settings.OTABEK_PASSWORD,
    })
    token = auth.get("access")
    if not token:
        raise OtabekError("Otabek не вернул токен доступа.")
    payload = _request("products/?page_size=500", token=token)
    products = _items(payload)
    if not isinstance(products, list):
        raise OtabekError("Otabek вернул каталог в неизвестном формате.")

    seen_sizes = set()
    created = updated = 0
    for source in products:
        source_id = source.get("id")
        name = str(source.get("name") or "").strip()
        if not source_id or not name:
            continue
        image = _photo_url(source.get("image"))
        for size in source.get("sizes") or []:
            size_id = size.get("id")
            variant = str(size.get("name") or "").strip()
            if not size_id or not variant:
                continue
            seen_sizes.add(int(size_id))
            price = _price(size.get("price"))
            current = Product.objects.filter(external_size_id=size_id).first()
            defaults = {
                "name": name,
                "variant_name": variant,
                "external_product_id": source_id,
                "external_image_url": image,
                "unit": Product.Unit.PIECE,
                "retail_price": price,
                "wholesale_price": price,
                "active": True,
            }
            if current:
                for field, value in defaults.items():
                    setattr(current, field, value)
                current.save(update_fields=[*defaults.keys(), "updated_at"])
                updated += 1
            else:
                Product.objects.create(code=next_code(), external_size_id=size_id, **defaults)
                created += 1

    disabled = Product.objects.filter(external_size_id__isnull=False).exclude(external_size_id__in=seen_sizes).update(active=False)
    return {"created": created, "updated": updated, "disabled": disabled, "products": len(products), "sizes": len(seen_sizes)}
