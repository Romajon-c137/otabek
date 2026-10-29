from rest_framework.routers import SimpleRouter

from .views import WarehouseViewSet

router = SimpleRouter()
router.register("warehouses", WarehouseViewSet, basename="warehouse")
urlpatterns = router.urls

