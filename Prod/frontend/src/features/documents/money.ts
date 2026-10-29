export interface CalculableLine {
  quantity: string;
  unit_price: string;
  discount_amount: string;
}

export function calculateLineTotal(line: CalculableLine): number {
  const gross = Number(line.quantity) * Number(line.unit_price);
  const discount = Number(line.discount_amount);
  if (!Number.isFinite(gross) || !Number.isFinite(discount)) return 0;
  return Math.max(0, Math.round((gross - discount + Number.EPSILON) * 100) / 100);
}

export function calculateDocumentTotal(lines: CalculableLine[]): number {
  return Math.round((lines.reduce((sum, line) => sum + calculateLineTotal(line), 0) + Number.EPSILON) * 100) / 100;
}

