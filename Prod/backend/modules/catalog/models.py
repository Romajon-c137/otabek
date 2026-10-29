from decimal import Decimal
import uuid

from django.core.validators import MinValueValidator
from django.db import models
from django.db.models import Q
from modules.common.models import TimeStampedModel


def generate_product_code():
    return f"PRD-{uuid.uuid4().hex[:10].upper()}"


class Category(TimeStampedModel):
    name = models.CharField(max_length=160, unique=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name", "id"]
        verbose_name_plural = "categories"

    def __str__(self):
        return self.name


class Product(TimeStampedModel):
    class Unit(models.TextChoices):
        PIECE = "piece", "шт."
        KILOGRAM = "kg", "кг"
        METER = "meter", "м"

    category = models.ForeignKey(Category, null=True, blank=True, on_delete=models.PROTECT, related_name="products")
    code = models.CharField(max_length=32, unique=True, default=generate_product_code, editable=False)
    name = models.CharField(max_length=240)
    sku = models.CharField(max_length=80, blank=True)
    barcode = models.CharField(max_length=80, blank=True)
    unit = models.CharField(max_length=12, choices=Unit.choices, default=Unit.PIECE)
    purchase_price = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0.00"), validators=[MinValueValidator(0)])
    retail_price = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0.00"), validators=[MinValueValidator(0)])
    wholesale_price = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0.00"), validators=[MinValueValidator(0)])
    image = models.ImageField(upload_to="products/%Y/%m/", blank=True)
    external_provider = models.CharField(max_length=32, blank=True)
    external_product_id = models.PositiveBigIntegerField(null=True, blank=True, db_index=True)
    external_variant_id = models.PositiveBigIntegerField(null=True, blank=True)
    variant_name = models.CharField(max_length=240, blank=True)
    external_image_url = models.URLField(max_length=500, blank=True)
    track_stock = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name", "id"]
        constraints = [
            models.UniqueConstraint(fields=["sku"], condition=~Q(sku=""), name="uq_product_nonempty_sku"),
            models.UniqueConstraint(fields=["barcode"], condition=~Q(barcode=""), name="uq_product_nonempty_barcode"),
            models.CheckConstraint(condition=Q(purchase_price__gte=0), name="product_purchase_nonnegative"),
            models.CheckConstraint(condition=Q(retail_price__gte=0), name="product_retail_nonnegative"),
            models.CheckConstraint(condition=Q(wholesale_price__gte=0), name="product_wholesale_nonnegative"),
            models.UniqueConstraint(fields=["external_provider", "external_variant_id"], condition=Q(external_variant_id__isnull=False), name="uq_product_external_variant"),
        ]
        indexes = [models.Index(fields=["is_active", "name"], name="product_active_name_idx")]

    def __str__(self):
        return self.name

