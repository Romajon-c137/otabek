from rest_framework import serializers

from .models import Category, Product


class CategorySerializer(serializers.ModelSerializer):
    products_count = serializers.IntegerField(source="products.count", read_only=True)

    class Meta:
        model = Category
        fields = ["id", "name", "products_count"]

    def validate_name(self, value):
        value = " ".join(value.split())
        if not value:
            raise serializers.ValidationError("Укажите название категории.")
        # сравнение в Python: SQLite не умеет регистронезависимо сравнивать кириллицу
        others = Category.objects.exclude(pk=self.instance.pk) if self.instance else Category.objects.all()
        if any(name.casefold() == value.casefold() for name in others.values_list("name", flat=True)):
            raise serializers.ValidationError("Такая категория уже есть.")
        return value


class ProductSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True, default="")
    display_photo = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            "id", "code", "name", "category", "category_name", "unit",
            "purchase_price", "retail_price", "wholesale_price",
            "photo", "display_photo", "external_image_url",
            "external_product_id", "external_size_id", "variant_name",
            "active", "created_at", "updated_at",
        ]
        read_only_fields = [
            "display_photo", "external_image_url", "external_product_id",
            "external_size_id", "variant_name", "created_at", "updated_at",
        ]
        extra_kwargs = {"id": {"read_only": False, "required": False}, "code": {"required": False}, "photo": {"allow_null": True, "required": False}}

    def validate_id(self, value):
        # идентификатор задаёт программа; повтор после потерянного ответа — понятная ошибка поля id, а не сбой
        if (self.instance is None or self.instance.pk != value) and Product.objects.filter(pk=value).exists():
            raise serializers.ValidationError("Запись с таким идентификатором уже создана.", code="exists")
        return value

    def get_display_photo(self, obj):
        if obj.external_image_url:
            return obj.external_image_url
        if not obj.photo:
            return ""
        request = self.context.get("request")
        return request.build_absolute_uri(obj.photo.url) if request else obj.photo.url

    def create(self, validated_data):
        if not validated_data.get("code"):
            from .numbering import next_code
            validated_data["code"] = next_code()
        return super().create(validated_data)

    def validate(self, attrs):
        if self.instance and "unit" in attrs and attrs["unit"] != self.instance.unit:
            if self.instance.stock_movements.exists():
                raise serializers.ValidationError({"unit": "Единицу товара с движениями изменить нельзя."})
        return attrs

