from django.urls import path
from .views import ApplyImportView, TemplateView, ValidateImportView

urlpatterns = [
    path("template/", TemplateView.as_view(), name="import-template"),
    path("validate/", ValidateImportView.as_view(), name="import-validate"),
    path("<int:pk>/apply/", ApplyImportView.as_view(), name="import-apply"),
]

