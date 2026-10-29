from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP

from django.core.exceptions import ValidationError


MONEY = Decimal("0.01")
QUANTITY = Decimal("0.001")
UNIT_COST = Decimal("0.000001")


def money(value: Decimal) -> Decimal:
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)


def quantity(value: Decimal) -> Decimal:
    return Decimal(value).quantize(QUANTITY, rounding=ROUND_HALF_UP)


def unit_cost(value: Decimal) -> Decimal:
    return Decimal(value).quantize(UNIT_COST, rounding=ROUND_HALF_UP)


def validate_product_quantity(product, value: Decimal) -> Decimal:
    result = quantity(value)
    if result <= 0:
        raise ValidationError("Количество должно быть больше нуля.")
    if product.unit == product.Unit.PIECE and result != result.to_integral_value():
        raise ValidationError("Для товара в штуках количество должно быть целым.")
    return result


def allocate_money(total: Decimal, bases: list[Decimal]) -> list[Decimal]:
    """Distribute cents by largest remainder with stable row order."""
    total = money(total)
    normalized = [money(value) for value in bases]
    if total < 0 or any(value < 0 for value in normalized):
        raise ValidationError("Суммы распределения не могут быть отрицательными.")
    base_total = sum(normalized, Decimal("0.00"))
    if total == 0:
        return [Decimal("0.00") for _ in normalized]
    if base_total == 0:
        raise ValidationError("Дополнительные расходы нельзя распределить при нулевой стоимости товаров.")

    exact = [(total * value / base_total) for value in normalized]
    allocated = [value.quantize(MONEY, rounding=ROUND_DOWN) for value in exact]
    cents_left = int((total - sum(allocated, Decimal("0.00"))) / MONEY)
    order = sorted(range(len(exact)), key=lambda i: (exact[i] - allocated[i], -i), reverse=True)
    for index in order[:cents_left]:
        allocated[index] += MONEY
    return allocated
