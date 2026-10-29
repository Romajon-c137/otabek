from django.contrib import admin
from .models import NeighborSupply, TradeDocument, TradeLine


class TradeLineInline(admin.TabularInline):
    model = TradeLine
    extra = 0
    readonly_fields = [field.name for field in TradeLine._meta.fields]


@admin.register(NeighborSupply)
class NeighborSupplyAdmin(admin.ModelAdmin):
    list_display = ["line", "supplier", "quantity", "unit_price", "amount"]
    list_select_related = ["line__document", "line__product", "supplier"]
    search_fields = ["line__document__number", "line__product_name", "supplier__name"]
    readonly_fields = [field.name for field in NeighborSupply._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(TradeDocument)
class TradeDocumentAdmin(admin.ModelAdmin):
    list_display = ["number", "kind", "status", "effective_date", "warehouse", "party", "amount_total"]
    list_filter = ["kind", "status", "warehouse"]
    search_fields = ["number", "party__name"]
    readonly_fields = [field.name for field in TradeDocument._meta.fields]
    inlines = [TradeLineInline]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

