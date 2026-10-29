from django.contrib import admin
from .models import Obligation, Payment, SettlementApplication, SettlementMovement


class ReadOnlyFinanceAdmin(admin.ModelAdmin):
    def has_add_permission(self, request): return False
    def has_change_permission(self, request, obj=None): return False
    def has_delete_permission(self, request, obj=None): return False


admin.site.register(Obligation, ReadOnlyFinanceAdmin)
admin.site.register(Payment, ReadOnlyFinanceAdmin)
admin.site.register(SettlementApplication, ReadOnlyFinanceAdmin)
admin.site.register(SettlementMovement, ReadOnlyFinanceAdmin)

