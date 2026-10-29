from django.contrib import admin

from .models import Counterparty


@admin.register(Counterparty)
class CounterpartyAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "phone", "system_key", "active")
    search_fields = ("code", "name", "phone")
    list_filter = ("active",)

# Register your models here.
