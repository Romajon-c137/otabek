from io import BytesIO
import hashlib
import hmac
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import time
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from .image_cache import cache_otabek_image
from modules.syncfeed.models import ChangeEvent

from .models import OtabekWebhookReceipt, Product


class OtabekCatalogTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_superuser("catalog-owner", "owner@example.test", "correct-horse-123")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    @override_settings(OTABEK_USERNAME="api-user", OTABEK_PASSWORD="api-password")
    @patch("modules.catalog.otabek._json_request")
    def test_sync_creates_non_stock_variants(self, request):
        request.side_effect = [
            {"access": "token"},
            {"results": [{"id": 7, "name": "Стакан", "sizes": [{"id": 71, "name": "250 мл", "price": "45.50"}]}], "next": None},
        ]
        response = self.client.post("/api/v1/catalog/products/sync-otabek/", {})
        self.assertEqual(response.status_code, 200)
        product = Product.objects.get(external_variant_id=71)
        self.assertFalse(product.track_stock)
        self.assertEqual(product.variant_name, "250 мл")

    @override_settings(OTABEK_USERNAME="", OTABEK_PASSWORD="")
    def test_sync_requires_server_credentials(self):
        response = self.client.post("/api/v1/catalog/products/sync-otabek/", {})
        self.assertEqual(response.status_code, 502)

    @override_settings(OTABEK_USERNAME="api-user", OTABEK_PASSWORD="api-password")
    @patch("modules.catalog.otabek.cache_otabek_image", return_value=("products/otabek/7.webp", True))
    @patch("modules.catalog.otabek._json_request")
    def test_sync_reuses_one_cached_image_for_all_variants(self, request, cache_image):
        request.side_effect = [
            {"access": "token"},
            {"results": [{"id": 7, "name": "Стакан", "image": "/media/glass.jpg", "sizes": [
                {"id": 71, "name": "250 мл", "price": "45.50"},
                {"id": 72, "name": "350 мл", "price": "55.50"},
            ]}], "next": None},
        ]

        response = self.client.post("/api/v1/catalog/products/sync-otabek/", {})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["images_cached"], 1)
        self.assertEqual(cache_image.call_count, 1)
        self.assertEqual(
            set(Product.objects.filter(external_product_id=7).values_list("image", flat=True)),
            {"products/otabek/7.webp"},
        )


class OtabekImageCacheTests(SimpleTestCase):
    @override_settings(
        OTABEK_API_URL="https://otabek.example/api",
        OTABEK_TIMEOUT_SECONDS=2,
        OTABEK_IMAGE_MAX_SIZE=640,
        OTABEK_IMAGE_WEBP_QUALITY=76,
    )
    @patch("modules.catalog.image_cache.urlopen")
    def test_external_photo_is_resized_and_saved_as_webp(self, mocked_urlopen):
        original = BytesIO()
        Image.new("RGB", (1800, 1200), color=(52, 115, 74)).save(original, format="JPEG", quality=95)
        response = MagicMock()
        response.read.return_value = original.getvalue()
        mocked_urlopen.return_value.__enter__.return_value = response

        with TemporaryDirectory() as media_root, override_settings(MEDIA_ROOT=media_root):
            relative, created = cache_otabek_image(7, "https://otabek.example/media/photo.jpg")
            target = Path(media_root) / relative

            self.assertTrue(created)
            self.assertTrue(target.is_file())
            with Image.open(target) as image:
                self.assertEqual(image.format, "WEBP")
                self.assertLessEqual(max(image.size), 640)

            relative_again, created_again = cache_otabek_image(7, "https://otabek.example/media/photo.jpg")
            self.assertEqual(relative_again, relative)
            self.assertFalse(created_again)
            self.assertEqual(mocked_urlopen.call_count, 1)


@override_settings(OTABEK_WEBHOOK_SECRET="w" * 48, OTABEK_WEBHOOK_MAX_AGE_SECONDS=300)
class OtabekWebhookTests(TestCase):
    url = "/api/v1/catalog/otabek/webhook/"

    def signed_headers(self, body, timestamp=None, secret="w" * 48):
        timestamp = str(timestamp or int(time.time()))
        signature = hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()
        return {"HTTP_X_OTABEK_TIMESTAMP": timestamp, "HTTP_X_OTABEK_SIGNATURE": f"sha256={signature}"}

    @patch("modules.catalog.webhooks.sync_otabek_catalog", return_value={"created": 2, "updated": 3, "disabled": 0, "variants": 5})
    def test_signed_event_syncs_and_notifies_cash_registers(self, sync):
        body = json.dumps({"event": "product.created", "event_id": "evt-101"}).encode()
        response = self.client.post(self.url, body, content_type="application/json", **self.signed_headers(body))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["created"], 2)
        self.assertTrue(OtabekWebhookReceipt.objects.filter(event_id="evt-101").exists())
        self.assertEqual(ChangeEvent.objects.get().action, "catalog.otabek_synced")
        sync.assert_called_once_with()

    @patch("modules.catalog.webhooks.sync_otabek_catalog")
    def test_repeated_event_is_idempotent(self, sync):
        body = json.dumps({"event": "catalog.changed", "event_id": "evt-duplicate"}).encode()
        OtabekWebhookReceipt.objects.create(event_id="evt-duplicate", payload_sha256=hashlib.sha256(body).hexdigest())

        response = self.client.post(self.url, body, content_type="application/json", **self.signed_headers(body))

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["duplicate"])
        sync.assert_not_called()

    @patch("modules.catalog.webhooks.sync_otabek_catalog")
    def test_invalid_signature_is_rejected(self, sync):
        body = json.dumps({"event": "product.updated", "event_id": "evt-102"}).encode()
        response = self.client.post(self.url, body, content_type="application/json", **self.signed_headers(body, secret="x" * 48))

        self.assertEqual(response.status_code, 401)
        sync.assert_not_called()

    def test_stale_event_is_rejected(self):
        body = json.dumps({"event": "product.deleted", "event_id": "evt-103"}).encode()
        response = self.client.post(self.url, body, content_type="application/json", **self.signed_headers(body, int(time.time()) - 301))
        self.assertEqual(response.status_code, 401)
