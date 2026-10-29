from rest_framework.pagination import PageNumberPagination


class FlexiblePagination(PageNumberPagination):
    """Клиент может запросить страницу побольше (?page_size=500) для загрузки справочников целиком."""

    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 1000
