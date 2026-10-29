from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from apps.catalog.models import Product
from apps.documents.models import CustomerOrder, Document
from apps.partners.models import Counterparty

from .models import ChangeEvent
from .services import emit


def _document_fields(document, action, status=None):
    if status is None:
        status = document.status
        if document.type == Document.Type.ORDER:
            order = CustomerOrder.objects.filter(pk=document.pk).only("state").first()
            if order:
                status = order.state
    return dict(
        entity=ChangeEvent.Entity.DOCUMENT, entity_id=document.pk, action=action,
        doc_type=document.type, number=document.number, status=status,
        warehouse_id=document.warehouse_id, counterparty_id=document.counterparty_id,
        actor=document.author.username if document.author_id else "",
    )


@receiver(post_save, sender=Document)
def document_saved(sender, instance, raw=False, **kwargs):
    if not raw:
        emit(**_document_fields(instance, ChangeEvent.Action.SAVED))


@receiver(post_save, sender=CustomerOrder)
def order_saved(sender, instance, raw=False, **kwargs):
    if not raw:
        emit(**_document_fields(instance.document, ChangeEvent.Action.SAVED, status=instance.state))


@receiver(post_delete, sender=Document)
def document_deleted(sender, instance, **kwargs):
    emit(**_document_fields(instance, ChangeEvent.Action.DELETED, status=instance.status))


@receiver(post_save, sender=Product)
def product_saved(sender, instance, raw=False, **kwargs):
    if not raw:
        emit(entity=ChangeEvent.Entity.PRODUCT, entity_id=instance.pk, number=instance.code)


@receiver(post_save, sender=Counterparty)
def counterparty_saved(sender, instance, raw=False, **kwargs):
    if not raw:
        emit(entity=ChangeEvent.Entity.COUNTERPARTY, entity_id=instance.pk, number=instance.code)
