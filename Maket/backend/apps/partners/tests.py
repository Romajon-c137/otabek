from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from apps.warehouses.models import Warehouse, WarehouseAccess
from .models import Counterparty


class CounterpartyApiTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="admin", password="test", is_staff=True)
        warehouse = Warehouse.objects.create(code="CP", name="Контрагенты")
        WarehouseAccess.objects.create(user=self.user, warehouse=warehouse, role=WarehouseAccess.Role.ADMIN)
        self.client.force_authenticate(self.user)

    def test_system_counterparty_cannot_be_deleted(self):
        counterparty = Counterparty.objects.get(system_key=Counterparty.RETAIL_SYSTEM_KEY)
        response = self.client.delete(f"/api/v1/counterparties/{counterparty.id}/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(Counterparty.objects.filter(pk=counterparty.pk).exists())
