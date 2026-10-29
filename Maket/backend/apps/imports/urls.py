from django.urls import path

from .views import ApplyImportView, ImportTemplateView, ValidateImportView

urlpatterns = [
    path("imports/template/", ImportTemplateView.as_view(), name="import-template"),
    path("imports/validate/", ValidateImportView.as_view(), name="import-validate"),
    path("imports/<uuid:batch_id>/apply/", ApplyImportView.as_view(), name="import-apply"),
]
