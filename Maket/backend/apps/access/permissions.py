from rest_framework.permissions import BasePermission, SAFE_METHODS

from apps.warehouses.models import WarehouseAccess


class CatalogPermission(BasePermission):
    """Readers may browse; seller/admin warehouse roles may edit shared directories."""

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS or request.user.is_superuser:
            return True
        return WarehouseAccess.objects.filter(
            user=request.user,
            role__in=[WarehouseAccess.Role.ADMIN, WarehouseAccess.Role.SELLER],
        ).exists()
