from rest_framework.routers import DefaultRouter
from .views import TradeDocumentViewSet

router = DefaultRouter()
router.register("", TradeDocumentViewSet, basename="document")
urlpatterns = router.urls

