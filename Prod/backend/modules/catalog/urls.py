from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import CategoryViewSet, ProductViewSet

router = DefaultRouter()
router.register("categories", CategoryViewSet)
router.register("products", ProductViewSet)
urlpatterns = [path("", include(router.urls))]

