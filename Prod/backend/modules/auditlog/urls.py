from rest_framework.routers import DefaultRouter
from .views import AuditRecordViewSet

router = DefaultRouter()
router.register("", AuditRecordViewSet, basename="audit")
urlpatterns = router.urls

