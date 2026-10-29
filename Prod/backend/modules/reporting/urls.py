from django.urls import path
from .views import DashboardReportView, GrossProfitReportView, SalesReportView, SettlementReportView, StockReportView

urlpatterns = [
    path("dashboard/", DashboardReportView.as_view(), name="dashboard-report"),
    path("stock/", StockReportView.as_view(), name="stock-report"),
    path("sales/", SalesReportView.as_view(), name="sales-report"),
    path("gross-profit/", GrossProfitReportView.as_view(), name="gross-profit-report"),
    path("settlements/", SettlementReportView.as_view(), name="settlement-report"),
]

