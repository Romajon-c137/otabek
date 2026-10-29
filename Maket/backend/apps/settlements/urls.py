from django.urls import path

from .views import CounterpartySettlementView, ObligationListView

urlpatterns = [
    path("settlements/obligations/", ObligationListView.as_view(), name="settlement-obligations-all"),
    path("settlements/<uuid:counterparty_id>/balance/", CounterpartySettlementView.as_view(mode="balance"), name="settlement-balance"),
    path("settlements/<uuid:counterparty_id>/ledger/", CounterpartySettlementView.as_view(mode="ledger"), name="settlement-ledger"),
    path("settlements/<uuid:counterparty_id>/obligations/", CounterpartySettlementView.as_view(mode="obligations"), name="settlement-obligations"),
]
