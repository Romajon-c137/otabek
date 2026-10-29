from django.core.management.base import BaseCommand

from modules.catalog.image_cache import ImageCacheError, cache_otabek_image
from modules.catalog.models import Product


class Command(BaseCommand):
    help = "Скачать, уменьшить и локально закэшировать фотографии каталога Otabek."

    def add_arguments(self, parser):
        parser.add_argument("--force", action="store_true", help="Пересоздать уже существующий кэш.")

    def handle(self, *args, **options):
        rows = (
            Product.objects.filter(external_provider="otabek", is_active=True)
            .exclude(external_product_id__isnull=True)
            .exclude(external_image_url="")
            .order_by("external_product_id")
            .values("external_product_id", "external_image_url")
        )
        products = {}
        for row in rows.iterator():
            products.setdefault(int(row["external_product_id"]), row["external_image_url"])
        cached = reused = failed = variants = 0
        for source_id, image_url in products.items():
            try:
                image_name, was_cached = cache_otabek_image(
                    source_id,
                    image_url,
                    force=options["force"],
                )
            except ImageCacheError as exc:
                failed += 1
                self.stderr.write(f"Otabek #{source_id}: {exc}")
                continue
            variants += Product.objects.filter(
                external_provider="otabek",
                external_product_id=source_id,
            ).update(image=image_name)
            cached += int(was_cached)
            reused += int(not was_cached)

        self.stdout.write(
            self.style.SUCCESS(
                f"Готово: новых WebP {cached}, использовано из кэша {reused}, "
                f"ошибок {failed}, обновлено вариантов {variants}."
            )
        )
