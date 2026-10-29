from PIL import Image, UnidentifiedImageError
from rest_framework import serializers

from .models import Category, Product


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "name", "is_active", "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]


class ProductSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)

    class Meta:
        model = Product
        fields = ["id", "code", "category", "category_name", "name", "sku", "barcode", "unit", "purchase_price", "retail_price", "wholesale_price", "image", "external_provider", "external_product_id", "external_variant_id", "variant_name", "external_image_url", "track_stock", "is_active", "created_at", "updated_at"]
        read_only_fields = ["code", "external_provider", "external_product_id", "external_variant_id", "variant_name", "external_image_url", "track_stock", "created_at", "updated_at"]

    def validate_image(self, value):
        if value and value.size > 5 * 1024 * 1024:
            raise serializers.ValidationError("Изображение не должно превышать 5 МБ.")
        if value:
            try:
                image = Image.open(value)
                image.verify()
                value.seek(0)
            except (UnidentifiedImageError, OSError) as exc:
                raise serializers.ValidationError("Файл не является корректным изображением.") from exc
        return value

    def validate_unit(self, value):
        if self.instance and self.instance.unit != value and self.instance.stock_movements.exists():
            raise serializers.ValidationError("Единицу нельзя менять после появления складских движений.")
        return value

