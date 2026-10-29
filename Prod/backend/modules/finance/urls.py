from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import ObligationViewSet, PaymentViewSet, SettlementMovementViewSet

router = DefaultRouter()
router.register("obligations", ObligationViewSet, basename="obligation")
router.register("payments", PaymentViewSet, basename="payment")
router.register("ledger", SettlementMovementViewSet, basename="settlement-ledger")
urlpatterns = [path("", include(router.urls))]

