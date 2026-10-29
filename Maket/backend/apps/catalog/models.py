import uuid
from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import models


class Category(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "categories"

    def __str__(self):
        return self.name


class Product(models.Model):
    class Unit(models.TextChoices):
        PIECE = "pcs", "шт"
        KILOGRAM = "kg", "кг"
        METER = "m", "м"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=255)
    category = models.ForeignKey(Category, on_delete=models.SET_NULL, null=True, blank=True, related_name="products")
    unit = models.CharField(max_length=8, choices=Unit.choices)
    purchase_price = models.DecimalField(max_digits=18, decimal_places=2, default=0, validators=[MinValueValidator(Decimal("0.00"))])
    retail_price = models.DecimalField(max_digits=18, decimal_places=2, default=0, validators=[MinValueValidator(Decimal("0.00"))])
    wholesale_price = models.DecimalField(max_digits=18, decimal_places=2, default=0, validators=[MinValueValidator(Decimal("0.00"))])
    photo = models.ImageField(upload_to="products/%Y/%m/", blank=True)
    external_image_url = models.URLField(max_length=500, blank=True)
    external_product_id = models.PositiveBigIntegerField(null=True, blank=True, db_index=True)
    external_size_id = models.PositiveBigIntegerField(null=True, blank=True, unique=True)
    variant_name = models.CharField(max_length=255, blank=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "code"]

    def __str__(self):
        return f"{self.name} — {self.variant_name}" if self.variant_name else self.name

# Create your models here.
