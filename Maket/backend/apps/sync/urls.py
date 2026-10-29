from django.urls import path

from .views import ChangesView, SyncStateView

urlpatterns = [
    path("sync/state/", SyncStateView.as_view(), name="sync-state"),
    path("sync/changes/", ChangesView.as_view(), name="sync-changes"),
]
