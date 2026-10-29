from rest_framework.pagination import PageNumberPagination


class StandardPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200

    def get_paginated_response(self, data):
        response = super().get_paginated_response(data)
        response.data["page"] = self.page.number
        response.data["pages"] = self.page.paginator.num_pages
        return response

