import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, ExternalLink, HandCoins, ImageOff, Printer, Tag } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, apiAll, queryString } from '../../api/client';
import type { Obligation, Payment, TradeDocument } from '../../api/types';
import { ErrorState, Loading } from '../../components/Feedback';
import { Money, StatusBadge } from '../../components/Page';
import { shortDocumentNumber } from '../documents/documentNumbers';

export function OperationDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const documentId = Number(id);
  const document = useQuery({ queryKey: ['operation-document', documentId], queryFn: () => api<TradeDocument>(`/documents/${documentId}/`), enabled: Number.isInteger(documentId) && documentId > 0 });
  const payments = useQuery({ queryKey: ['operation-payments', documentId], queryFn: () => apiAll<Payment>(`/finance/payments/${queryString({ source_document: documentId })}`), enabled: Boolean(document.data) });
  const obligations = useQuery({ queryKey: ['operation-obligations', documentId], queryFn: () => apiAll<Obligation>(`/finance/obligations/${queryString({ source_document: documentId })}`), enabled: Boolean(document.data) });
  const related = useQuery({ queryKey: ['operation-related', documentId], queryFn: () => apiAll<TradeDocument>(`/documents/${queryString({ source_document: documentId })}`), enabled: Boolean(document.data) });

  if (document.isLoading) return <Loading />;
  if (document.error || !document.data) return <ErrorState error={document.error ?? new Error('Операция не найдена.')} />;

  const item = document.data;
  const shortNumber = shortDocumentNumber(item.kind, item.number);
  const postedPayments = (payments.data ?? []).filter((payment) => payment.status === 'posted');
  const cash = postedPayments.filter((payment) => payment.method === 'cash').reduce((sum, payment) => sum + Number(payment.amount), 0);
  const mbank = postedPayments.filter((payment) => payment.method === 'mbank').reduce((sum, payment) => sum + Number(payment.amount), 0);
  const aiyl = postedPayments.filter((payment) => payment.method === 'aiyl').reduce((sum, payment) => sum + Number(payment.amount), 0);
  const paid = cash + mbank + aiyl;
  const openDebt = (obligations.data ?? []).filter((debt) => !debt.reversed_at).reduce((sum, debt) => sum + Number(debt.open_amount), 0);
  const sourceNumber = item.source_document ? `Документ #${item.source_document}` : null;

  return <section className="operation-detail">
    <header className="operation-detail-header">
      <button className="button secondary" onClick={() => navigate(-1)}><ArrowLeft size={17} />Назад</button>
      <div><span>{item.kind_label}</span><h1>{shortNumber}</h1><small>{item.number}</small></div>
      <div className="operation-header-actions"><StatusBadge value={item.status} label={item.status_label} /><button className="button secondary" onClick={() => window.print()}><Printer size={17} />Печать</button></div>
    </header>

    <section className="operation-products">
      {item.lines.map((line) => {
        const image = line.product_image || line.product_external_image_url;
        return <article className="operation-product-card" key={line.id}>
          <div className={`operation-product-image${image ? '' : ' empty'}`}>{image ? <img src={image} alt={line.product_name} /> : <><ImageOff size={30} /><span>Фото нет</span></>}</div>
          <div className="operation-product-main">
            <span className="operation-product-label">Товар</span>
            <h2>{line.product_name}</h2>
            <div className="operation-product-calculation"><strong>{formatQuantity(line.quantity)} {unitLabel(line.unit)}</strong><span>×</span><Money value={line.unit_price} /><span>=</span><Money value={line.line_total} /></div>
            {Number(line.discount_amount) > 0 && <div className="operation-product-discount"><Tag size={15} />Скидка <Money value={line.discount_amount} /></div>}
            {line.neighbor_supply && <div className="neighbor-source"><HandCoins size={16} /><span>Взято у соседа: <strong>{line.neighbor_supply.supplier_name}</strong> · {formatQuantity(line.neighbor_supply.quantity)} {unitLabel(line.unit)} × <Money value={line.neighbor_supply.unit_price} /> = <Money value={line.neighbor_supply.amount} /></span></div>}
          </div>
          <div className="operation-product-total"><span>Сумма товара</span><Money value={line.line_total} /></div>
        </article>;
      })}
      {Number(item.document_discount_amount) > 0 && <div className="operation-document-discount"><Tag size={16} />Скидка на весь документ <Money value={item.document_discount_amount} /></div>}
    </section>

    <div className="operation-summary">
      <div><span>{item.kind === 'receipt' ? 'Поставщик' : 'Покупатель'}</span><strong>{item.party_name ?? 'Розничный покупатель'}</strong></div>
      <div><span>Дата</span><strong>{formatDate(item.effective_date)}</strong></div>
      <div><span>Итого по операции</span><Money value={item.amount_total} /></div>
    </div>

    <section className="operation-section">
      <h2>Оплата и долг</h2>
      {payments.isLoading || obligations.isLoading ? <Loading /> : <div className="operation-payment-grid">
        <div><span>Наличные</span><Money value={cash} /></div><div><span>МБанк</span><Money value={mbank} /></div>{aiyl > 0 && <div><span>Айыл Банк</span><Money value={aiyl} /></div>}<div><span>Оплачено</span><Money value={paid} /></div><div><span>Осталось по долгу</span><Money value={openDebt} /></div>
      </div>}
    </section>

    {(item.source_document || related.data?.length || payments.data?.length) ? <section className="operation-section"><h2>Связанные операции</h2><div className="related-operations">
      {item.source_document && <Link to={`/operations/document/${item.source_document}`}><ExternalLink size={16} /><span><strong>Исходная операция</strong><small>{sourceNumber}</small></span></Link>}
      {related.data?.map((document) => <Link key={document.id} to={`/operations/document/${document.id}`}><ExternalLink size={16} /><span><strong>{document.kind_label} {shortDocumentNumber(document.kind, document.number)}</strong><small>{formatDate(document.effective_date)} · {document.status_label}</small></span></Link>)}
      {payments.data?.map((payment) => <div key={payment.id} className="related-payment">{payment.direction === 'incoming' ? <ArrowDown size={16} /> : <ArrowUp size={16} />}<span><strong>{payment.direction === 'incoming' ? 'Получена оплата' : 'Выдана оплата'} · {payment.number}</strong><small>{formatDate(payment.effective_date)} · {paymentMethod(payment.method)} · {payment.status === 'posted' ? 'проведена' : 'отменена'}</small></span><Money value={payment.amount} /></div>)}
    </div></section> : null}

    {item.note && <section className="operation-section"><h2>Комментарий</h2><p className="operation-note">{item.note}</p></section>}
    {item.status === 'cancelled' && item.cancellation_reason && <section className="operation-section"><h2>Отмена</h2><p className="operation-note">{item.cancellation_reason}</p></section>}
  </section>;
}

function formatDate(value: string) { return new Intl.DateTimeFormat('ru-RU').format(new Date(`${value}T00:00:00`)); }
function formatQuantity(value: string) { return Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 3 }); }
function unitLabel(unit: string) { return unit === 'kg' ? 'кг' : unit === 'meter' ? 'м' : 'шт'; }
function paymentMethod(method: Payment['method']) { return ({ cash: 'Наличные', mbank: 'МБанк', aiyl: 'Айыл Банк' })[method]; }
