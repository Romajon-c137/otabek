import uuid

from django.db import models


class Counterparty(models.Model):
    RETAIL_SYSTEM_KEY = "retail-customer"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=255)
    phone = models.CharField(max_length=64, blank=True)
    note = models.TextField(blank=True)
    system_key = models.CharField(max_length=64, unique=True, null=True, blank=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "code"]

    @property
    def is_system(self):
        return bool(self.system_key)

    def __str__(self):
        return self.name

# Create your models here.
