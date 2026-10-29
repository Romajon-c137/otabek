from collections import defaultdict
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from apps.audit.models import AuditEvent
from apps.documents.models import Document
from .models import Obligation, SettlementAllocation, SettlementMovement


@transaction.atomic
def apply_auto_offset(*, counterparty, trigger_document, actor):
    obligations = list(Obligation.objects.select_for_update().filter(
        counterparty=counterparty, open_amount__gt=0,
    ).order_by("created_at", "id"))
    receivables = [item for item in obligations if item.side == Obligation.Side.RECEIVABLE]
    payables = [item for item in obligations if item.side == Obligation.Side.PAYABLE]
    total = min(
        sum((item.open_amount for item in receivables), Decimal("0.00")),
        sum((item.open_amount for item in payables), Decimal("0.00")),
    )
    if total <= 0:
        return None

    offset_document = Document.objects.create(
        type=Document.Type.OFFSET,
        status=Document.Status.POSTED,
        version=2,
        counterparty=counterparty,
        author=actor,
        posted_at=timezone.now(),
        reason=f"Автоматически после {trigger_document.number}",
    )
    movement_totals = defaultdict(lambda: Decimal("0.00"))
    sequence = 1
    ri = pi = 0
    while ri < len(receivables) and pi < len(payables):
        receivable = receivables[ri]
        payable = payables[pi]
        amount = min(receivable.open_amount, payable.open_amount)
        for obligation in (receivable, payable):
            SettlementAllocation.objects.create(
                source_document=offset_document, obligation=obligation,
                kind=SettlementAllocation.Kind.OFFSET, sequence=sequence, amount=amount,
            )
            sequence += 1
        receivable.open_amount -= amount
        payable.open_amount -= amount
        receivable.save(update_fields=["open_amount"])
        payable.save(update_fields=["open_amount"])
        movement_totals[receivable.id] -= amount
        movement_totals[payable.id] += amount
        if receivable.open_amount == 0:
            ri += 1
        if payable.open_amount == 0:
            pi += 1

    by_id = {item.id: item for item in obligations}
    for obligation_id, signed_amount in movement_totals.items():
        obligation = by_id[obligation_id]
        SettlementMovement.objects.create(
            document=offset_document, counterparty=counterparty,
            obligation=obligation, signed_amount=signed_amount,
        )
    AuditEvent.objects.create(
        actor=actor, action="offset.posted", document=offset_document,
        payload={"amount": str(total), "trigger_document_id": str(trigger_document.id)},
    )
    return offset_document
