from django.contrib import admin
from .models import ImportBatch


@admin.register(ImportBatch)
class ImportBatchAdmin(admin.ModelAdmin):
    list_display = ["source_name", "status", "created_by", "created_at", "applied_at"]
    readonly_fields = [field.name for field in ImportBatch._meta.fields]

    def has_add_permission(self, request): return False
    def has_change_permission(self, request, obj=None): return False
    def has_delete_permission(self, request, obj=None): return False

