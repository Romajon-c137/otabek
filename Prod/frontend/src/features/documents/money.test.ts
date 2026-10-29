import { describe, expect, it } from 'vitest';
import { calculateDocumentTotal, calculateLineTotal } from './money';

describe('document totals for immediate UI feedback', () => {
  it('uses quantity, price and discount without floating artefacts', () => {
    expect(calculateLineTotal({ quantity: '3', unit_price: '19.99', discount_amount: '9.97' })).toBe(50);
  });

  it('never displays a negative line total', () => {
    expect(calculateLineTotal({ quantity: '1', unit_price: '10', discount_amount: '12' })).toBe(0);
  });

  it('rounds the document sum to two decimals', () => {
    expect(calculateDocumentTotal([
      { quantity: '1', unit_price: '0.10', discount_amount: '0' },
      { quantity: '1', unit_price: '0.20', discount_amount: '0' },
    ])).toBe(0.3);
  });
});

