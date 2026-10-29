from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from modules.identity.models import UserProfile, UserRole
from .models import Party


class SystemPartyApiTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user("manager", password="correct-horse-123")
        UserProfile.objects.create(user=self.user, role=UserRole.MANAGER)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.party = Party.objects.create(
            code="RETAIL",
            name="Розничный покупатель",
            kind=Party.Kind.CUSTOMER,
            system_key="retail_customer",
            is_system=True,
        )

    def test_system_party_cannot_be_edited_or_deleted(self):
        response = self.client.patch(f"/api/v1/parties/{self.party.pk}/", {"name": "Подмена"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.party.refresh_from_db()
        self.assertEqual(self.party.name, "Розничный покупатель")
        self.assertEqual(self.client.delete(f"/api/v1/parties/{self.party.pk}/").status_code, 405)

    def test_person_can_be_created_without_code_or_type(self):
        response = self.client.post(
            "/api/v1/parties/",
            {"name": "Новый человек", "phone": "+996 555 000 111"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(response.data["code"].startswith("P-"))
        self.assertEqual(response.data["kind"], Party.Kind.BOTH)
