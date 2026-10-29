from django.contrib import admin

from .models import Document


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ("number", "type", "status", "warehouse", "counterparty", "author", "updated_at")
    list_filter = ("type", "status", "warehouse")
    search_fields = ("number",)
    readonly_fields = ("status", "posted_at", "reversed_at", "reversal_of")

# Register your models here.
