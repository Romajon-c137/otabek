from django.urls import path

from .views import CurrentUserView, TokenLoginView, TokenLogoutView

urlpatterns = [
    path("auth/me/", CurrentUserView.as_view(), name="current-user"),
    path("auth/token/", TokenLoginView.as_view(), name="token-login"),
    path("auth/logout/", TokenLogoutView.as_view(), name="token-logout"),
]

