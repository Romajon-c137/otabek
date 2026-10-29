from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from apps.warehouses.models import Warehouse, WarehouseAccess
from .models import Product


class ProductApiTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="admin", password="test", is_staff=True)
        warehouse = Warehouse.objects.create(code="CAT", name="Каталог")
        WarehouseAccess.objects.create(user=self.user, warehouse=warehouse, role=WarehouseAccess.Role.ADMIN)
        self.client.force_authenticate(self.user)

    def test_create_and_search_product(self):
        response = self.client.post("/api/v1/products/", {
            "code": "000001", "name": "Ведро", "unit": "pcs", "purchase_price": "100.00",
            "retail_price": "150.00", "wholesale_price": "130.00", "active": True,
        })
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Product.objects.get().retail_price, Decimal("150.00"))
        result = self.client.get("/api/v1/products/?search=Ведро")
        self.assertEqual(result.data["count"], 1)

    def test_negative_price_is_rejected(self):
        response = self.client.post("/api/v1/products/", {
            "code": "000002", "name": "Таз", "unit": "pcs",
            "purchase_price": "0", "retail_price": "-1", "wholesale_price": "0",
        })
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    @override_settings(OTABEK_USERNAME="api-user", OTABEK_PASSWORD="api-pass")
    @patch("apps.catalog.otabek._request")
    def test_otabek_sync_creates_one_sku_per_size(self, request):
        request.side_effect = [
            {"access": "jwt"},
            {"results": [{
                "id": 7, "name": "Шуруповёрт", "image": "/media/drill.jpg",
                "sizes": [
                    {"id": 13, "name": "36В", "price": "1100"},
                    {"id": 14, "name": "48В", "price": "1800"},
                ],
            }]},
        ]
        response = self.client.post("/api/v1/products/sync-otabek/", {})
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["sizes"], 2)
        self.assertEqual(Product.objects.filter(external_product_id=7).count(), 2)
        size = Product.objects.get(external_size_id=14)
        self.assertEqual(size.name, "Шуруповёрт")
        self.assertEqual(size.variant_name, "48В")
        self.assertEqual(size.retail_price, Decimal("1800.00"))

    @override_settings(OTABEK_USERNAME="", OTABEK_PASSWORD="")
    def test_otabek_sync_requires_server_credentials(self):
        response = self.client.post("/api/v1/products/sync-otabek/", {})
        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)


class CategoryAndPhotoTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="cat-admin", password="test", is_staff=True)
        warehouse = Warehouse.objects.create(code="CATP", name="Каталог")
        WarehouseAccess.objects.create(user=self.user, warehouse=warehouse, role=WarehouseAccess.Role.ADMIN)
        self.client.force_authenticate(self.user)

    def test_category_is_unique_ignoring_case_and_filters_products(self):
        created = self.client.post("/api/v1/categories/", {"name": "  Уборка "})
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        self.assertEqual(created.data["name"], "Уборка")
        duplicate = self.client.post("/api/v1/categories/", {"name": "уборка"})
        self.assertEqual(duplicate.status_code, status.HTTP_400_BAD_REQUEST)
        product = self.client.post("/api/v1/products/", {
            "code": "C-1", "name": "Швабра", "unit": "pcs", "category": created.data["id"],
            "purchase_price": "1", "retail_price": "2", "wholesale_price": "2",
        })
        self.assertEqual(product.status_code, status.HTTP_201_CREATED, product.data)
        self.assertEqual(product.data["category_name"], "Уборка")
        self.assertEqual(self.client.get(f"/api/v1/products/?category={created.data['id']}").data["count"], 1)
        self.assertEqual(self.client.get("/api/v1/products/?search=Убор").data["count"], 1)
        blocked = self.client.delete(f"/api/v1/categories/{created.data['id']}/")
        self.assertEqual(blocked.status_code, status.HTTP_400_BAD_REQUEST)

    def test_photo_is_uploaded_as_file_not_url(self):
        import io, shutil, tempfile
        from PIL import Image
        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.test import override_settings
        buffer = io.BytesIO()
        Image.new("RGB", (8, 8), "red").save(buffer, "PNG")
        media = tempfile.mkdtemp()
        try:
            with override_settings(MEDIA_ROOT=media):
                response = self.client.post("/api/v1/products/", {
                    "code": "P-1", "name": "С фото", "unit": "pcs", "purchase_price": "1", "retail_price": "2", "wholesale_price": "2",
                    "photo": SimpleUploadedFile("pic.png", buffer.getvalue(), content_type="image/png"),
                }, format="multipart")
                self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
                self.assertIn("/media/products/", response.data["photo"])
                bad = self.client.post("/api/v1/products/", {
                    "code": "P-2", "name": "Не картинка", "unit": "pcs", "purchase_price": "1", "retail_price": "2", "wholesale_price": "2",
                    "photo": SimpleUploadedFile("note.txt", b"hello", content_type="text/plain"),
                }, format="multipart")
                self.assertEqual(bad.status_code, status.HTTP_400_BAD_REQUEST)
        finally:
            shutil.rmtree(media, ignore_errors=True)
