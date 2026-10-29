from django.urls import include, path


urlpatterns = [
    path("", include("apps.catalog.urls")),
    path("", include("apps.partners.urls")),
    path("", include("apps.warehouses.urls")),
    path("", include("apps.documents.urls")),
    path("", include("apps.payments.urls")),
    path("", include("apps.settlements.urls")),
    path("", include("apps.reporting.urls")),
    path("", include("apps.imports.urls")),
    path("", include("apps.access.urls")),
    path("", include("apps.sync.urls")),
]
