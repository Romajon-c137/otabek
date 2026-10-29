from django.contrib import admin
from .models import AccessAttempt, AccessToken, UserProfile, WarehouseGrant

admin.site.register(UserProfile)
admin.site.register(WarehouseGrant)


@admin.register(AccessToken)
class AccessTokenAdmin(admin.ModelAdmin):
    list_display = ["user", "created_at", "expires_at", "last_used_at", "revoked_at"]
    readonly_fields = ["token_hash", "created_at", "last_used_at"]


@admin.register(AccessAttempt)
class AccessAttemptAdmin(admin.ModelAdmin):
    list_display = ["occurred_at", "username", "ip_address", "outcome", "request_id"]
    readonly_fields = [field.name for field in AccessAttempt._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

