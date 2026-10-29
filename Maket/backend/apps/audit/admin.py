from django.contrib import admin

from .models import AuditEvent


@admin.register(AuditEvent)
class AuditEventAdmin(admin.ModelAdmin):
    list_display = ("created_at", "actor", "action", "document", "request_id")
    readonly_fields = ("actor", "action", "document", "reason", "request_id", "payload", "created_at")

# Register your models here.
