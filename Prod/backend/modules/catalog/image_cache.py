from __future__ import annotations

from hashlib import sha256
from io import BytesIO
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from django.conf import settings
from PIL import Image, ImageOps, UnidentifiedImageError


class ImageCacheError(RuntimeError):
    pass


def cache_otabek_image(source_id: int, image_url: str, *, force: bool = False) -> tuple[str, bool]:
    """Download one Otabek image and return its MEDIA_ROOT-relative WebP path."""
    parsed = urlparse(image_url)
    allowed_host = urlparse(settings.OTABEK_API_URL).netloc
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.netloc != allowed_host:
        raise ImageCacheError("Недопустимый адрес изображения Otabek.")

    digest = sha256(image_url.encode("utf-8")).hexdigest()[:12]
    relative_path = Path("products") / "otabek" / f"{source_id}-{digest}.webp"
    target = Path(settings.MEDIA_ROOT) / relative_path
    if target.is_file() and target.stat().st_size > 0 and not force:
        return relative_path.as_posix(), False

    maximum_bytes = int(getattr(settings, "OTABEK_IMAGE_MAX_BYTES", 20 * 1024 * 1024))
    request = Request(
        image_url,
        headers={"Accept": "image/avif,image/webp,image/*", "User-Agent": "HozUchet/2 image-cache"},
    )
    try:
        with urlopen(request, timeout=settings.OTABEK_TIMEOUT_SECONDS) as response:
            payload = response.read(maximum_bytes + 1)
        if not payload or len(payload) > maximum_bytes:
            raise ImageCacheError("Изображение Otabek пустое или слишком большое.")

        with Image.open(BytesIO(payload)) as source:
            image = ImageOps.exif_transpose(source)
            image.thumbnail(
                (int(getattr(settings, "OTABEK_IMAGE_MAX_SIZE", 640)),) * 2,
                Image.Resampling.LANCZOS,
            )
            if image.mode not in {"RGB", "RGBA"}:
                image = image.convert("RGBA" if "transparency" in image.info else "RGB")
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_suffix(".tmp")
            image.save(
                temporary,
                format="WEBP",
                quality=int(getattr(settings, "OTABEK_IMAGE_WEBP_QUALITY", 76)),
                method=6,
            )
            temporary.replace(target)
    except ImageCacheError:
        raise
    except (HTTPError, URLError, TimeoutError, OSError, UnidentifiedImageError, Image.DecompressionBombError) as exc:
        raise ImageCacheError("Не удалось подготовить изображение Otabek.") from exc

    return relative_path.as_posix(), True
