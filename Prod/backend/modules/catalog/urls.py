from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import CategoryViewSet, ProductViewSet
from .webhooks import OtabekWebhookView

router = DefaultRouter()
router.register("categories", CategoryViewSet)
router.register("products", ProductViewSet)
urlpatterns = [
    path("otabek/webhook/", OtabekWebhookView.as_view(), name="otabek-webhook"),
    path("", include(router.urls)),
]

