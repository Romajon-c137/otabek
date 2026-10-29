from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from modules.common.views import HealthView


urlpatterns = [
    path("admin/", admin.site.urls),
    path("health/", HealthView.as_view(), name="health"),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger"),
    path("api/v1/auth/", include("modules.identity.urls")),
    path("api/v1/warehouses/", include("modules.warehouses.urls")),
    path("api/v1/catalog/", include("modules.catalog.urls")),
    path("api/v1/parties/", include("modules.parties.urls")),
    path("api/v1/documents/", include("modules.documents.urls")),
    path("api/v1/finance/", include("modules.finance.urls")),
    path("api/v1/reports/", include("modules.reporting.urls")),
    path("api/v1/import/", include("modules.data_import.urls")),
    path("api/v1/audit/", include("modules.auditlog.urls")),
    path("api/v1/sync/", include("modules.syncfeed.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

