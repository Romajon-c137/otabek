import json
from decimal import Decimal, InvalidOperation
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

from django.conf import settings
from django.db import transaction

from .image_cache import ImageCacheError, cache_otabek_image
from .models import Product


class OtabekSyncError(RuntimeError):
    pass


def _json_request(url, *, method="GET", token="", payload=None):
    base = settings.OTABEK_API_URL.rstrip("/") + "/"
    absolute = urljoin(base, url)
    if urlparse(absolute).netloc != urlparse(base).netloc:
        raise OtabekSyncError("Otabek вернул небезопасную ссылку пагинации.")
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(payload).encode() if payload is not None else None
    try:
        with urlopen(Request(absolute, data=body, headers=headers, method=method), timeout=settings.OTABEK_TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode())
    except HTTPError as exc:
        message = "Otabek отклонил логин или пароль." if exc.code in {401, 403} else f"Otabek API вернул HTTP {exc.code}."
        raise OtabekSyncError(message) from exc
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise OtabekSyncError("Не удалось получить каталог Otabek.") from exc


def _money(value):
    try:
        return max(Decimal("0"), Decimal(str(value or 0))).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        return Decimal("0.00")


def _catalog(token):
    url = "products/?page_size=500"
    pages = 0
    while url and pages < 100:
        data = _json_request(url, token=token)
        if isinstance(data, list):
            yield from data
            return
        if not isinstance(data, dict) or not isinstance(data.get("results"), list):
            raise OtabekSyncError("Otabek вернул каталог в неизвестном формате.")
        yield from data["results"]
        url = data.get("next")
        pages += 1
    if url:
        raise OtabekSyncError("Каталог Otabek содержит слишком много страниц.")


def sync_otabek_catalog():
    if not settings.OTABEK_USERNAME or not settings.OTABEK_PASSWORD:
        raise OtabekSyncError("На сервере не заданы OTABEK_USERNAME и OTABEK_PASSWORD.")
    auth = _json_request("token/", method="POST", payload={"username": settings.OTABEK_USERNAME, "password": settings.OTABEK_PASSWORD})
    token = auth.get("access") if isinstance(auth, dict) else None
    if not token:
        raise OtabekSyncError("Otabek не вернул токен доступа.")
    catalog = list(_catalog(token))
    image_names = {}
    images_cached = image_errors = 0
    image_root = settings.OTABEK_API_URL.removesuffix("/api").rstrip("/") + "/"
    for item in catalog:
        source_id = item.get("id")
        image_url = urljoin(image_root, str(item.get("image") or "")) if item.get("image") else ""
        if not source_id or not image_url:
            continue
        try:
            image_name, was_cached = cache_otabek_image(int(source_id), image_url)
            image_names[int(source_id)] = image_name
            images_cached += int(was_cached)
        except ImageCacheError:
            image_errors += 1

    seen = set()
    created = updated = 0
    with transaction.atomic():
        for item in catalog:
            source_id = item.get("id")
            name = str(item.get("name") or "").strip()
            if not source_id or not name:
                continue
            image_url = urljoin(image_root, str(item.get("image") or "")) if item.get("image") else ""
            for variant in item.get("sizes") or []:
                variant_id = variant.get("id")
                variant_name = str(variant.get("name") or "").strip()
                if not variant_id or not variant_name:
                    continue
                seen.add(int(variant_id))
                defaults = {
                    "external_product_id": source_id,
                    "name": name,
                    "variant_name": variant_name,
                    "external_image_url": image_url,
                    "unit": Product.Unit.PIECE,
                    "retail_price": _money(variant.get("price")),
                    "wholesale_price": _money(variant.get("price")),
                    "track_stock": False,
                    "is_active": True,
                }
                if image_names.get(int(source_id)):
                    defaults["image"] = image_names[int(source_id)]
                _, was_created = Product.objects.update_or_create(
                    external_provider="otabek",
                    external_variant_id=variant_id,
                    defaults=defaults,
                )
                created += int(was_created)
                updated += int(not was_created)
        disabled = Product.objects.filter(external_provider="otabek", external_variant_id__isnull=False).exclude(external_variant_id__in=seen).update(is_active=False)
    return {
        "created": created,
        "updated": updated,
        "disabled": disabled,
        "variants": len(seen),
        "images_cached": images_cached,
        "image_errors": image_errors,
    }
