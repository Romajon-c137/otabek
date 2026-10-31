import type { DocumentKind } from '../../api/types';

const prefixes: Record<DocumentKind, string> = {
  sale: 'S',
  customer_order: 'Z',
  receipt: 'P',
  customer_return: 'R',
  supplier_return: 'R',
  opening: 'O',
};

export function shortDocumentNumber(kind: DocumentKind, number: string): string {
  const sequence = number.match(/(\d+)$/)?.[1] ?? number;
  return `${prefixes[kind]}${sequence.slice(-4).padStart(4, '0')}`;
}

export function shortReferencedDocumentNumber(number: string): string {
  const sourcePrefix = number.split('-')[0]?.toUpperCase();
  const prefix = sourcePrefix === 'SAL'
    ? 'S'
    : sourcePrefix === 'ORD'
      ? 'Z'
    : sourcePrefix === 'REC'
      ? 'P'
      : sourcePrefix?.includes('RET')
        ? 'R'
        : sourcePrefix === 'OPN'
          ? 'O'
          : null;
  const sequence = number.match(/(\d+)$/)?.[1];
  return prefix && sequence ? `${prefix}${sequence.slice(-4).padStart(4, '0')}` : number;
}

export function shortenDocumentNumbersInText(value: string): string {
  return value.replace(/\b(?:SAL|ORD|REC|[A-Z]*RET[A-Z]*|OPN)(?:-[A-Z0-9]+)+\b/gi, (number) => shortReferencedDocumentNumber(number));
}
