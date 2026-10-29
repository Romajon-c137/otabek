from django.contrib import admin
from .models import FifoAllocation, StockLevel, StockLot, StockMovement, StockReservation


class ReadOnlyLedgerAdmin(admin.ModelAdmin):
    def has_add_permission(self, request): return False
    def has_change_permission(self, request, obj=None): return False
    def has_delete_permission(self, request, obj=None): return False


admin.site.register(StockLevel, ReadOnlyLedgerAdmin)
admin.site.register(StockLot, ReadOnlyLedgerAdmin)
admin.site.register(StockMovement, ReadOnlyLedgerAdmin)
admin.site.register(FifoAllocation, ReadOnlyLedgerAdmin)
admin.site.register(StockReservation, ReadOnlyLedgerAdmin)

