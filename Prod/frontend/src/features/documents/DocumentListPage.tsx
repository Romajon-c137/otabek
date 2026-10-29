import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleX, Pencil, Plus, Printer, Send, ShoppingBag, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError, getToken, idempotencyHeaders, queryString } from '../../api/client';
import type { DocumentKind, Page, TradeDocument } from '../../api/types';
import { useWarehouse } from '../../app/WarehouseContext';
import { Empty, ErrorState, Loading } from '../../components/Feedback';
import { Modal } from '../../components/Modal';
import { Money, PageHeader, StatusBadge } from '../../components/Page';
import { Pagination } from '../../components/Pagination';
import { DocumentEditor, labelForKind } from './DocumentEditor';

export function DocumentListPage({ kind, title, alternateKind }: { kind: DocumentKind; title: string; alternateKind?: DocumentKind }) {
  const { warehouseId } = useWarehouse();
  const cache = useQueryClient();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [editorOpen, setEditorOpen] = useState(searchParams.get('quick') === '1');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<TradeDocument | null>(null);
  const [actionError, setActionError] = useState('');
  const [shortage, setShortage] = useState<{ product_id: number; product_name: string; missing: string } | null>(null);
  const kinds = alternateKind ? `${kind},${alternateKind}` : kind;
  const documents = useQuery({
    queryKey: ['documents', kinds, warehouseId, page],
    queryFn: () => api<Page<TradeDocument>>(`/documents/${queryString({ warehouse: warehouseId, kind: kinds, page_size: 50, page })}`),
    enabled: warehouseId !== null,
  });
  const command = useMutation({ mutationFn: ({ id, action, body }: { id: number; action: string; body?: object }) => api<TradeDocument>(`/documents/${id}/${action}/`, { method: 'POST', headers: idempotencyHeaders(), body: JSON.stringify(body ?? {}) }), onSuccess: () => { setActionError(''); setShortage(null); void cache.invalidateQueries({ queryKey: ['documents'] }); void cache.invalidateQueries({ queryKey: ['dashboard'] }); }, onError: (error) => { setActionError(error instanceof ApiError ? JSON.stringify(error.details) : 'Операция не выполнена.'); setShortage(error instanceof ApiError && error.code === 'insufficient_stock' ? error.details as { product_id: number; product_name: string; missing: string } : null); } });
  const removeDraft = useMutation({
    mutationFn: (id: number) => api<void>(`/documents/${id}/`, { method: 'DELETE' }),
    onSuccess: () => {
      setActionError('');
      void cache.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (error) => setActionError(error instanceof ApiError ? JSON.stringify(error.details) : 'Черновик не удалён.'),
  });

  function openCreate() {
    if (kind === 'customer_order') {
      navigate('/orders/new');
      return;
    }
    setEditing(null);
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditing(null);
  }

  function post(document: TradeDocument) {
    if (!['sale', 'receipt'].includes(document.kind)) {
      command.mutate({ id: document.id, action: 'post' });
      return;
    }
    const paid = window.prompt(`Оплачено сейчас (0–${document.amount_total})`, document.amount_total);
    if (paid === null) return;
    const method = window.prompt('Способ: cash, mbank или aiyl', 'cash');
    if (!method || !['cash', 'mbank', 'aiyl'].includes(method)) {
      setActionError('Укажите способ оплаты: cash, mbank или aiyl.');
      return;
    }
    command.mutate({ id: document.id, action: 'post', body: { paid_amount: paid, payment_method: method } });
  }

  async function printAssemblySheet(id: number) {
    const response = await fetch(`/api/v1/documents/${id}/assembly-sheet/`, { headers: { Authorization: `Token ${getToken() ?? ''}` } });
    if (!response.ok) { setActionError('Не удалось открыть лист сборки.'); return; }
    const url = URL.createObjectURL(await response.blob());
    const page = window.open(url, '_blank');
    page?.addEventListener('load', () => page.print(), { once: true });
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  if (documents.isLoading) return <Loading />;
  if (documents.error || !documents.data) return <ErrorState error={documents.error} retry={() => void documents.refetch()} />;
  return <><PageHeader eyebrow="Учётные документы" title={title} description="Черновик можно менять или удалить; проведение и отмена выполняются отдельными контролируемыми командами." actions={<button className="button primary" onClick={openCreate}><Plus size={18} />Создать</button>} />{actionError && <div className="form-error page-error">{actionError}{shortage && <Link className="button secondary" to={`/receipts?quick=1&product=${shortage.product_id}&quantity=${shortage.missing}&returnTo=/sales`}>Создать приход на {shortage.missing} · {shortage.product_name}</Link>}</div>}{documents.data.results.length === 0 ? <Empty title={`Нет документов: ${title.toLowerCase()}`}><button className="button secondary" onClick={openCreate}>Создать первый</button></Empty> : <div className="table-card"><table><thead><tr><th>Номер / дата</th><th>Операция</th><th>Контрагент</th><th>Статус</th><th className="numeric">Сумма</th><th /></tr></thead><tbody>{documents.data.results.map((document) => <tr key={document.id}><td><strong>{document.number}</strong><small>{document.effective_date}</small></td><td>{document.kind_label}</td><td>{document.party_name ?? '—'}</td><td><StatusBadge value={document.status} label={document.status_label} /></td><td className="numeric"><Money value={document.amount_total} /></td><td><div className="row-actions">{document.status === 'draft' && <button className="mini-action" onClick={() => { setEditing(document); setEditorOpen(true); }}><Pencil size={15} />Изменить</button>}{document.status === 'draft' && document.kind !== 'customer_order' && <button className="mini-action positive" disabled={command.isPending} onClick={() => post(document)}><Send size={15} />Провести</button>}{document.status === 'draft' && document.kind === 'customer_order' && <button className="mini-action positive" disabled={command.isPending} onClick={() => command.mutate({ id: document.id, action: 'confirm' })}><Check size={15} />На сборку</button>}{document.status === 'draft' && <button className="mini-action danger" disabled={removeDraft.isPending} onClick={() => { if (window.confirm(`Удалить черновик ${document.number}?`)) removeDraft.mutate(document.id); }}><Trash2 size={15} />Удалить</button>}{document.status === 'confirmed' && <button className="mini-action positive" disabled={command.isPending} onClick={() => command.mutate({ id: document.id, action: 'assembled', body: { assembled: true } })}><Check size={15} />Собран</button>}{document.status === 'assembled' && <button className="mini-action positive" disabled={command.isPending} onClick={() => command.mutate({ id: document.id, action: 'fulfill' })}><ShoppingBag size={15} />Продать</button>}{document.kind === 'customer_order' && document.status !== 'draft' && <button className="mini-action" onClick={() => void printAssemblySheet(document.id)}><Printer size={15} />Печать</button>}{document.status !== 'draft' && !['cancelled', 'fulfilled'].includes(document.status) && <button className="mini-action danger" disabled={command.isPending} onClick={() => { const reason = window.prompt('Причина отмены'); if (reason) command.mutate({ id: document.id, action: 'cancel', body: { reason } }); }}><CircleX size={15} />Отменить</button>}</div></td></tr>)}</tbody></table></div>}<Pagination page={documents.data.page} pages={documents.data.pages} total={documents.data.count} onChange={setPage} />{editorOpen && <Modal title={editing ? `Черновик · ${editing.number}` : `Новый документ · ${labelForKind(kind)}`} onClose={closeEditor} wide><DocumentEditor key={editing?.id ?? 'new'} initialKind={editing?.kind ?? kind} initialDocument={editing ?? undefined} initialProductId={Number(searchParams.get('product')) || undefined} initialQuantity={searchParams.get('quantity') ?? undefined} postAfterSave={!editing && searchParams.get('quick') === '1'} onCancel={closeEditor} onSaved={() => { closeEditor(); void cache.invalidateQueries({ queryKey: ['documents'] }); const returnTo = searchParams.get('returnTo'); if (returnTo) navigate(returnTo); }} /></Modal>}</>;
}

