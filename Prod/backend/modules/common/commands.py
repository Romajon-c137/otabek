from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from .models import CommandReceipt


class CommandInProgress(APIException):
    status_code = 409
    default_detail = "Команда с этим ключом уже выполняется."
    default_code = "command_in_progress"


def _json_default(value: Any) -> str:
    if isinstance(value, Decimal):
        return format(value, "f")
    return str(value)


def request_digest(payload: Any) -> str:
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=_json_default)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class CommandHandle:
    receipt: CommandReceipt
    replayed: bool


def acquire_command(*, actor, operation: str, key: str, payload: Any) -> CommandHandle:
    if not key or len(key) > 120:
        raise ValidationError({"idempotency_key": "Укажите корректный ключ идемпотентности."})
    digest = request_digest(payload)
    try:
        # The savepoint keeps an outer business transaction usable after a
        # uniqueness race on the idempotency key.
        with transaction.atomic():
            receipt = CommandReceipt.objects.create(
                actor=actor, operation=operation, key=key, request_hash=digest
            )
        return CommandHandle(receipt=receipt, replayed=False)
    except IntegrityError:
        receipt = CommandReceipt.objects.select_for_update().get(actor=actor, operation=operation, key=key)
        if receipt.request_hash != digest:
            raise ValidationError({"idempotency_key": "Этот ключ уже использован с другими данными."})
        if receipt.status != CommandReceipt.Status.COMPLETED:
            raise CommandInProgress()
        return CommandHandle(receipt=receipt, replayed=True)


def complete_command(receipt: CommandReceipt, *, result_kind: str, result_id: Any, snapshot: dict | None = None) -> None:
    receipt.status = CommandReceipt.Status.COMPLETED
    receipt.result_kind = result_kind
    receipt.result_id = str(result_id)
    receipt.response_snapshot = snapshot or {}
    receipt.completed_at = timezone.now()
    receipt.save(update_fields=["status", "result_kind", "result_id", "response_snapshot", "completed_at"])

