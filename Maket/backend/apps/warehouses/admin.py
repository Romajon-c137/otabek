from django.contrib import admin

from .models import Warehouse, WarehouseAccess

admin.site.register(Warehouse)
admin.site.register(WarehouseAccess)

# Register your models here.
