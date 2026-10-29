from django.urls import path

from .views import AuditReportView, SalesReportView, StockReportView

urlpatterns = [
    path("reports/stock/", StockReportView.as_view(), name="report-stock"),
    path("reports/sales/", SalesReportView.as_view(), name="report-sales"),
    path("reports/gross-profit/", SalesReportView.as_view(), name="report-gross-profit"),
    path("reports/audit/", AuditReportView.as_view(), name="report-audit"),
]
