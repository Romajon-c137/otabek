from django.contrib import admin

from .models import Category, Product


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "category", "unit", "retail_price", "active")
    list_filter = ("category", "unit", "active")
    search_fields = ("code", "name")


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    search_fields = ("name",)

# Register your models here.
