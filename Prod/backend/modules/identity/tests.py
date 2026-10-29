from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from modules.warehouses.models import Warehouse
from .models import AccessAttempt, UserProfile, UserRole, WarehouseGrant


class AuthenticationAndPermissionTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user("cashier", password="correct-horse-123")
        UserProfile.objects.create(user=self.user, role=UserRole.CASHIER)
        self.warehouse = Warehouse.objects.create(code="W1", name="Склад")
        WarehouseGrant.objects.create(user=self.user, warehouse=self.warehouse, can_view=True, can_sell=True)
        self.client = APIClient()

    def test_login_token_and_logout(self):
        response = self.client.post("/api/v1/auth/login/", {"username": "cashier", "password": "correct-horse-123"}, format="json")
        self.assertEqual(response.status_code, 200)
        token = response.data["token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token}")
        self.assertEqual(self.client.get("/api/v1/auth/me/").status_code, 200)
        self.assertEqual(self.client.post("/api/v1/auth/logout/").status_code, 204)
        self.assertEqual(self.client.get("/api/v1/auth/me/").status_code, 403)
        self.assertEqual(AccessAttempt.objects.filter(outcome="success").count(), 1)

    def test_cashier_cannot_create_warehouse(self):
        self.client.force_authenticate(self.user)
        response = self.client.post("/api/v1/warehouses/", {"code": "W2", "name": "Запрещённый"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_login_is_throttled_after_five_failures(self):
        for _ in range(5):
            self.client.post("/api/v1/auth/login/", {"username": "cashier", "password": "wrong-password"}, format="json")
        response = self.client.post("/api/v1/auth/login/", {"username": "cashier", "password": "wrong-password"}, format="json")
        self.assertEqual(response.status_code, 429)

