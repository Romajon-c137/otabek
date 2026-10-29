import { useQuery } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { api, ApiError, idempotencyHeaders } from '../../api/client';
import type { DocumentKind, Page, Party, Product, TradeDocument } from '../../api/types';
import { useWarehouse } from '../../app/WarehouseContext';
import { ErrorState, FieldError, Loading, validationMessage } from '../../components/Feedback';
import { calculateDocumentTotal, calculateLineTotal } from './money';

interface DraftLine { product_id: number; quantity: string; unit_price: string; discount_amount: string; source_line_id?: number }
interface ExtraCost { name: string; amount: string }

const customerKinds: DocumentKind[] = ['sale', 'customer_return', 'customer_order'];

export function DocumentEditor({ initialKind, initialDocument, initialProductId, initialQuantity, postAfterSave = false, onSaved, onCancel }: { initialKind: DocumentKind; initialDocument?: TradeDocument; initialProductId?: number; initialQuantity?: string; postAfterSave?: boolean; onSaved(document: TradeDocument): void; onCancel(): void }) {
  const { warehouseId } = useWarehouse();
  const [kind, setKind] = useState(initialDocument?.kind ?? initialKind);
  const [partyId, setPartyId] = useState(initialDocument?.party ? String(initialDocument.party) : '');
  const [date, setDate] = useState(initialDocument?.effective_date ?? new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState(initialDocument?.note ?? '');
  // A legacy document-level discount is preserved when an old draft is edited.
  // New documents expose only per-line discounts, as required by the accounting rules.
  const documentDiscount = initialDocument?.document_discount_amount ?? '0.00';
  const [extraCosts, setExtraCosts] = useState<ExtraCost[]>(initialDocument?.extra_costs.map(({ name, amount }) => ({ name, amount })) ?? []);
  const [sourceDocumentId, setSourceDocumentId] = useState(initialDocument?.source_document ? String(initialDocument.source_document) : '');
  const [lines, setLines] = useState<DraftLine[]>(initialDocument?.lines.map((line) => ({ product_id: line.product_id, source_line_id: line.source_line_id ?? undefined, quantity: line.quantity, unit_price: line.unit_price === '0.00' ? '' : line.unit_price, discount_amount: line.discount_amount === '0.00' ? '' : line.discount_amount })) ?? [{ product_id: initialProductId ?? 0, quantity: initialQuantity ?? '1.000', unit_price: '', discount_amount: '' }]);
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const products = useQuery({ queryKey: ['products-active', Boolean(initialDocument)], queryFn: () => api<Page<Product>>(`/catalog/products/?page_size=200${initialDocument ? '' : '&active=true'}`) });
  const parties = useQuery({ queryKey: ['people'], queryFn: () => api<Page<Party>>('/parties/?page_size=200'), enabled: kind !== 'opening' });
  const isReturn = kind === 'customer_return' || kind === 'supplier_return';
  const sourceDocuments = useQuery({ queryKey: ['return-sources', kind, warehouseId], queryFn: () => api<Page<TradeDocument>>(`/documents/?warehouse=${warehouseId}&kind=${kind === 'customer_return' ? 'sale' : 'receipt'}&status=posted&page_size=200`), enabled: isReturn && warehouseId !== null });
  const productMap = useMemo(() => new Map(products.data?.results.map((item) => [item.id, item])), [products.data]);

  function changeProduct(index: number, productId: number) {
    const product = productMap.get(productId);
    const price = customerKinds.includes(kind) ? product?.retail_price : product?.purchase_price;
    setLines((current) => current.map((line, position) => position === index ? { ...line, product_id: productId, unit_price: price === '0.00' ? '' : price ?? '' } : line));
  }

  function patchLine(index: number, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line, position) => position === index ? { ...line, ...patch } : line));
  }

  const total = Math.max(0, calculateDocumentTotal(lines) - Number(documentDiscount || 0));

  function selectSource(documentId: string) {
    setSourceDocumentId(documentId);
    const source = sourceDocuments.data?.results.find((item) => item.id === Number(documentId));
    if (!source) return;
    setPartyId(String(source.party ?? ''));
    setLines(source.lines.map((line) => ({ product_id: line.product_id, source_line_id: line.id, quantity: '0.000', unit_price: line.line_total === '0.00' ? '0.00' : (Number(line.line_total) / Number(line.quantity)).toFixed(2), discount_amount: '0.00' })));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!warehouseId) return;
    setError(null);
    setSubmitting(true);
    try {
      const preparedLines = lines.map((line) => ({ ...line, unit_price: line.product_id === initialProductId && !line.unit_price ? productMap.get(line.product_id)?.purchase_price ?? line.unit_price : line.unit_price, discount_amount: line.discount_amount || '0.00' }));
      const submittedLines = isReturn ? preparedLines.filter((line) => Number(line.quantity) > 0) : preparedLines;
      if (!submittedLines.length) throw new ApiError(400, 'Укажите хотя бы одну возвращаемую позицию.', null);
      const payload = { kind, warehouse_id: warehouseId, party_id: kind === 'opening' || (kind === 'sale' && !partyId) ? null : Number(partyId), effective_date: date, note, lines: submittedLines, document_discount_amount: documentDiscount, extra_costs: kind === 'receipt' ? extraCosts.filter((item) => item.name && Number(item.amount) > 0) : [], ...(initialDocument ? { version: initialDocument.version } : {}) };
      let document = await api<TradeDocument>(initialDocument ? `/documents/${initialDocument.id}/` : '/documents/', { method: initialDocument ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      if (postAfterSave) document = await api<TradeDocument>(`/documents/${document.id}/post/`, { method: 'POST', headers: idempotencyHeaders(), body: JSON.stringify({ paid_amount: '0.00', payment_method: 'cash' }) });
      onSaved(document);
    } catch (reason) {
      setError(reason);
    } finally { setSubmitting(false); }
  }

  if (products.isLoading || parties.isLoading || (isReturn && sourceDocuments.isLoading)) return <Loading />;
  if (products.error || parties.error || sourceDocuments.error) return <ErrorState error={products.error ?? parties.error ?? sourceDocuments.error} />;
  return <form onSubmit={submit} className="document-editor">
    <div className="form-grid three">
      <label>Операция<select value={kind} onChange={(event) => setKind(event.target.value as DocumentKind)} disabled={Boolean(initialDocument) || initialKind !== 'customer_return'}>{initialKind === 'customer_return' ? <><option value="customer_return">Возврат покупателя</option><option value="supplier_return">Возврат поставщику</option></> : <option value={kind}>{labelForKind(kind)}</option>}</select></label>
      <label>Дата<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /><FieldError error={error} field="effective_date" /></label>
      {kind !== 'opening' && <label>Человек<select value={partyId} onChange={(event) => setPartyId(event.target.value)} required={kind !== 'sale'}><option value="">{kind === 'sale' ? 'Без человека (только полная оплата)' : 'Выберите человека…'}</option>{parties.data?.results.filter((party) => !party.is_system).map((party) => <option key={party.id} value={party.id}>{party.name}</option>)}</select><FieldError error={error} field="party_id" /></label>}
    </div>
    {isReturn && <label>Исходный документ<select value={sourceDocumentId} onChange={(event) => selectSource(event.target.value)} required><option value="">Выберите проведённый документ…</option>{sourceDocuments.data?.results.map((item) => <option key={item.id} value={item.id}>{item.number} · {item.effective_date} · {item.party_name}</option>)}</select></label>}
    <div className="line-editor"><div className="line-head"><span>Товар</span><span>Количество</span><span>Цена</span><span>Скидка</span><span>Сумма</span><span /></div>{lines.map((line, index) => <div className="line-row" key={index}><select aria-label={`Товар ${index + 1}`} value={line.product_id || ''} onChange={(event) => changeProduct(index, Number(event.target.value))} required disabled={isReturn}><option value="">Выберите товар…</option>{products.data?.results.map((product) => <option key={product.id} value={product.id}>{product.name}{product.variant_name && ` — ${product.variant_name}`} {product.sku && `· ${product.sku}`}</option>)}</select><input aria-label={`Количество ${index + 1}`} type="number" min={isReturn ? '0' : '0.001'} step="0.001" value={line.quantity} onChange={(event) => patchLine(index, { quantity: event.target.value })} required /><input aria-label={`Цена ${index + 1}`} type="number" min="0" step="0.01" value={line.unit_price} onChange={(event) => patchLine(index, { unit_price: event.target.value })} required readOnly={isReturn} /><input aria-label={`Скидка ${index + 1}`} type="number" min="0" step="0.01" value={line.discount_amount} onChange={(event) => patchLine(index, { discount_amount: event.target.value })} readOnly={isReturn} /><strong>{calculateLineTotal(line).toFixed(2)}</strong><button type="button" className="icon-button danger" disabled={lines.length === 1 || isReturn} onClick={() => setLines((current) => current.filter((_, position) => position !== index))}><Minus size={17} /></button></div>)}</div>
    {!isReturn && <button type="button" className="button ghost" onClick={() => setLines((current) => [...current, { product_id: 0, quantity: '1.000', unit_price: '', discount_amount: '' }])}><Plus size={17} />Добавить строку</button>}
    {kind === 'receipt' && <div><strong>Дополнительные расходы</strong>{extraCosts.map((item, index) => <div className="form-grid three" key={index}><label>Название<input value={item.name} onChange={(event) => setExtraCosts((rows) => rows.map((row, i) => i === index ? { ...row, name: event.target.value } : row))} /></label><label>Сумма<input type="number" min="0.01" step="0.01" value={item.amount === '0.00' ? '' : item.amount} onChange={(event) => setExtraCosts((rows) => rows.map((row, i) => i === index ? { ...row, amount: event.target.value } : row))} /></label><button type="button" className="button ghost" onClick={() => setExtraCosts((rows) => rows.filter((_, i) => i !== index))}>Удалить</button></div>)}<button type="button" className="button ghost" onClick={() => setExtraCosts((rows) => [...rows, { name: '', amount: '' }])}><Plus size={17} />Добавить расход</button></div>}
    <label>Комментарий<textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} /></label>
    <FieldError error={error} field="lines" />
    {Boolean(error) && <div className="form-error">{validationMessage(error) ?? (error instanceof ApiError ? error.message : 'Не удалось сохранить документ.')}</div>}
    <footer className="form-footer"><div className="document-total"><span>Итого</span><strong>{total.toFixed(2)} сом</strong></div><button type="button" className="button secondary" onClick={onCancel}>Отмена</button><button className="button primary" disabled={submitting}>{submitting ? 'Сохраняем…' : initialDocument ? 'Сохранить изменения' : 'Сохранить черновик'}</button></footer>
  </form>;
}

export function labelForKind(kind: DocumentKind): string {
  return ({ opening: 'Ввод остатков', receipt: 'Поступление', sale: 'Продажа', customer_return: 'Возврат покупателя', supplier_return: 'Возврат поставщику', customer_order: 'Заказ покупателя' })[kind];
}

