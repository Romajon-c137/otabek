from rest_framework.routers import SimpleRouter

from .views import CounterpartyViewSet

router = SimpleRouter()
router.register("counterparties", CounterpartyViewSet, basename="counterparty")
urlpatterns = router.urls

