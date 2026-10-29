from rest_framework.routers import SimpleRouter

from .views import (BuyerReturnViewSet, CustomerOrderViewSet, DocumentViewSet,
                    OpeningStockViewSet, ReceiptViewSet, SaleViewSet,
                    SupplierReturnViewSet)

router = SimpleRouter()
router.register("documents", DocumentViewSet, basename="document")
router.register("opening-stocks", OpeningStockViewSet, basename="opening-stock")
router.register("buyer-returns", BuyerReturnViewSet, basename="buyer-return")
router.register("orders", CustomerOrderViewSet, basename="order")
router.register("supplier-returns", SupplierReturnViewSet, basename="supplier-return")
router.register("receipts", ReceiptViewSet, basename="receipt")
router.register("sales", SaleViewSet, basename="sale")
urlpatterns = router.urls

