from django.urls import path
from .views import SyncChangesView, SyncStateView

urlpatterns = [path("state/", SyncStateView.as_view(), name="sync-state"), path("changes/", SyncChangesView.as_view(), name="sync-changes")]
