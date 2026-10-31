import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, CalendarClock, CircleDollarSign, FilePlus2, HandCoins, History, Phone, RotateCcw, Search, UserRound } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, apiAll, idempotencyHeaders, queryString } from '../../api/client';
import type { Obligation, Page, Party, Payment } from '../../api/types';
import { useWarehouse } from '../../app/WarehouseContext';
import { Empty, ErrorState, FieldError, Loading, validationMessage } from '../../components/Feedback';
import { Modal } from '../../components/Modal';
import { Money, PageHeader, StatusBadge } from '../../components/Page';
import { Pagination } from '../../components/Pagination';
import { shortReferencedDocumentNumber, shortenDocumentNumbersInText } from '../documents/documentNumbers';

type Direction = 'incoming' | 'outgoing';
type FinanceDialog = { mode: 'debt' | 'payment'; partyId?: number; direction?: Direction; amount?: string };
type SettlementFilter = 'all' | 'receivable' | 'payable';

interface SettlementRow {
  party_id: number;
  party_name: string;
  party_phone: string;
  receivable: string;
  payable: string;
  balance: string;
  last_operation: string | null;
}

interface SettlementReport {
  rows: SettlementRow[];
  totals: { receivable: string; payable: string; balance: string };
}

interface SettlementMovement {
  id: number;
  event_type: 'obligation_created' | 'payment' | 'automatic_offset' | 'payment_voided';
  receivable_delta: string;
  payable_delta: string;
  description: string;
  document: number | null;
  occurred_at: string;
}

export function FinancePage() {
  const { warehouseId } = useWarehouse();
  const [view, setView] = useState<'people' | 'payments'>('people');
  const [filter, setFilter] = useState<SettlementFilter>('all');
  const [search, setSearch] = useState('');
  const [paymentPage, setPaymentPage] = useState(1);
  const [dialog, setDialog] = useState<FinanceDialog | null>(null);
  const [selected, setSelected] = useState<SettlementRow | null>(null);

  const settlements = useQuery({
    queryKey: ['settlement-summary', warehouseId],
    queryFn: () => api<SettlementReport>(`/reports/settlements/${queryString({ warehouse: warehouseId })}`),
    enabled: warehouseId !== null,
  });
  const payments = useQuery({
    queryKey: ['payments', warehouseId, paymentPage],
    queryFn: () => api<Page<Payment>>(`/finance/payments/${queryString({ warehouse: warehouseId, page_size: 50, page: paymentPage })}`),
    enabled: warehouseId !== null && view === 'payments',
  });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (settlements.data?.rows ?? []).filter((row) => {
      const matchesSearch = !term || row.party_name.toLowerCase().includes(term) || row.party_phone.toLowerCase().includes(term);
      const matchesFilter = filter === 'all' || (filter === 'receivable' ? Number(row.receivable) > 0 : Number(row.payable) > 0);
      return matchesSearch && matchesFilter;
    });
  }, [filter, search, settlements.data]);

  const refresh = () => {
    void settlements.refetch();
    if (view === 'payments') void payments.refetch();
  };
  const openPayment = (row: SettlementRow, direction: Direction) => setDialog({
    mode: 'payment',
    partyId: row.party_id,
    direction,
    amount: direction === 'incoming' ? row.receivable : row.payable,
  });

  if (settlements.isLoading) return <Loading />;
  if (settlements.error) return <ErrorState error={settlements.error} />;
  const totals = settlements.data?.totals ?? { receivable: '0', payable: '0', balance: '0' };

  return <>
    <PageHeader
      title="Взаиморасчёты"
      actions={<button className="button primary finance-header-action" onClick={() => setDialog({ mode: 'debt' })}><FilePlus2 size={20} />Записать долг</button>}
    />

    <div className="settlement-totals">
      <article className="settlement-total receivable"><span className="settlement-total-icon"><ArrowDown size={27} /></span><div><span>Нам должны</span><Money value={totals.receivable} tone="positive" /></div></article>
      <article className="settlement-total payable"><span className="settlement-total-icon"><ArrowUp size={27} /></span><div><span>Мы должны</span><Money value={totals.payable} tone="negative" /></div></article>
      <article className="settlement-total balance"><span className="settlement-total-icon"><CircleDollarSign size={27} /></span><div><span>Разница</span><Money value={totals.balance} tone={Number(totals.balance) >= 0 ? 'positive' : 'negative'} /></div></article>
    </div>

    <div className="finance-controls-row">
      <div className="finance-view-switch">
        <button className={view === 'people' ? 'active' : ''} onClick={() => setView('people')}><HandCoins size={19} />Долги по людям</button>
        <button className={view === 'payments' ? 'active' : ''} onClick={() => setView('payments')}><History size={19} />История оплат</button>
      </div>
      {view === 'people' && <div className="settlement-toolbar">
        <label className="search-box"><Search size={19} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти по имени или телефону" /></label>
        <div className="settlement-filters" aria-label="Фильтр долгов">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Все</button>
          <button className={filter === 'receivable' ? 'active' : ''} onClick={() => setFilter('receivable')}><ArrowDown size={16} />Нам должны</button>
          <button className={filter === 'payable' ? 'active' : ''} onClick={() => setFilter('payable')}><ArrowUp size={16} />Мы должны</button>
        </div>
      </div>}
    </div>

    {view === 'people' ? <>
      {!rows.length ? <Empty title={search || filter !== 'all' ? 'По выбранному фильтру ничего нет' : 'Открытых долгов нет'} /> : <div className="settlement-grid">{rows.map((row) => <SettlementCard key={row.party_id} row={row} onDetails={() => setSelected(row)} onPayment={(direction) => openPayment(row, direction)} />)}</div>}
    </> : payments.isLoading ? <Loading /> : payments.error ? <ErrorState error={payments.error} /> : <>
      <PaymentsTable rows={payments.data?.results ?? []} onChanged={refresh} />
      <Pagination page={payments.data?.page ?? 1} pages={payments.data?.pages ?? 1} total={payments.data?.count ?? 0} onChange={setPaymentPage} />
    </>}

    {selected && <PartyDetails row={selected} warehouseId={warehouseId!} onClose={() => setSelected(null)} onPayment={(direction) => { setSelected(null); openPayment(selected, direction); }} onChanged={refresh} />}
    {dialog && <Modal title={dialog.mode === 'debt' ? 'Записать долг' : dialog.direction === 'outgoing' ? 'Отдать деньги' : 'Получить деньги'} onClose={() => setDialog(null)}><FinanceForm mode={dialog.mode} warehouseId={warehouseId!} initialPartyId={dialog.partyId} initialDirection={dialog.direction} initialAmount={dialog.amount} onCancel={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} /></Modal>}
  </>;
}

function SettlementCard({ row, onDetails, onPayment }: { row: SettlementRow; onDetails(): void; onPayment(direction: Direction): void }) {
  return <article className="settlement-card">
    <header><span className="settlement-person-icon"><UserRound size={25} /></span><div><strong>{row.party_name}</strong>{row.party_phone ? <span><Phone size={13} />{row.party_phone}</span> : <span>Телефон не указан</span>}</div></header>
    <div className="settlement-amounts">
      <div className="receivable"><span><ArrowDown size={18} />Нам должны</span><Money value={row.receivable} tone="positive" /></div>
      <div className="payable"><span><ArrowUp size={18} />Мы должны</span><Money value={row.payable} tone="negative" /></div>
    </div>
    <div className="settlement-balance"><span>Итоговый баланс</span><Money value={Math.abs(Number(row.balance))} tone={Number(row.balance) >= 0 ? 'positive' : 'negative'} /><small>{Number(row.balance) >= 0 ? 'в нашу пользу' : 'в пользу человека'}</small></div>
    <div className="settlement-last"><CalendarClock size={15} />{row.last_operation ? `Последняя операция: ${formatDateTime(row.last_operation)}` : 'Операций пока нет'}</div>
    <footer>
      {Number(row.receivable) > 0 && <button className="settlement-action incoming" onClick={() => onPayment('incoming')}><ArrowDown size={22} /><span><strong>Получить деньги</strong><small>Деньги приходят нам</small></span></button>}
      {Number(row.payable) > 0 && <button className="settlement-action outgoing" onClick={() => onPayment('outgoing')}><ArrowUp size={22} /><span><strong>Отдать деньги</strong><small>Деньги уходят от нас</small></span></button>}
      <button className="settlement-details" onClick={onDetails}>Подробнее</button>
    </footer>
  </article>;
}

function PartyDetails({ row, warehouseId, onClose, onPayment, onChanged }: { row: SettlementRow; warehouseId: number; onClose(): void; onPayment(direction: Direction): void; onChanged(): void }) {
  const obligations = useQuery({ queryKey: ['party-obligations', warehouseId, row.party_id], queryFn: () => apiAll<Obligation>(`/finance/obligations/${queryString({ warehouse: warehouseId, party: row.party_id, open: 'true' })}`) });
  const payments = useQuery({ queryKey: ['party-payments', warehouseId, row.party_id], queryFn: () => apiAll<Payment>(`/finance/payments/${queryString({ warehouse: warehouseId, party: row.party_id })}`) });
  const ledger = useQuery({ queryKey: ['party-ledger', warehouseId, row.party_id], queryFn: () => apiAll<SettlementMovement>(`/finance/ledger/${queryString({ warehouse: warehouseId, party: row.party_id })}`) });
  const refresh = () => { void obligations.refetch(); void payments.refetch(); void ledger.refetch(); onChanged(); };
  return <Modal title={row.party_name} onClose={onClose} wide>
    <div className="party-settlement-detail">
      <div className="detail-balance-row">
        <div><span>Нам должны</span><Money value={row.receivable} tone="positive" /></div>
        <div><span>Мы должны</span><Money value={row.payable} tone="negative" /></div>
        <div className="detail-actions">{Number(row.receivable) > 0 && <button className="button finance-incoming" onClick={() => onPayment('incoming')}><ArrowDown size={19} />Получить деньги</button>}{Number(row.payable) > 0 && <button className="button finance-outgoing" onClick={() => onPayment('outgoing')}><ArrowUp size={19} />Отдать деньги</button>}</div>
      </div>
      <section><h3>Из чего состоит долг</h3>{obligations.isLoading ? <Loading /> : obligations.error ? <ErrorState error={obligations.error} /> : !obligations.data?.length ? <Empty title="Открытых долгов нет" /> : <div className="detail-list">{obligations.data.map((item) => <div key={item.id} className="detail-list-row"><span className={`movement ${item.side === 'receivable' ? 'incoming' : 'outgoing'}`}>{item.side === 'receivable' ? <ArrowDown size={15} /> : <ArrowUp size={15} />}{item.side === 'receivable' ? 'Нам должны' : 'Мы должны'}</span><div>{item.source_document ? <Link className="inline-operation-link" to={`/operations/document/${item.source_document}`}>{item.source_number ? shortReferencedDocumentNumber(item.source_number) : item.reason}</Link> : <strong>{item.source_number ? shortReferencedDocumentNumber(item.source_number) : item.reason}</strong>}<small>{formatDate(item.effective_date)}{item.due_date ? ` · срок до ${formatDate(item.due_date)}` : ''}</small></div><Money value={item.open_amount} tone={item.side === 'receivable' ? 'positive' : 'negative'} /></div>)}</div>}</section>
      <section><h3>Последние движения</h3>{ledger.isLoading ? <Loading /> : ledger.error ? <ErrorState error={ledger.error} /> : !ledger.data?.length ? <Empty title="Движений пока нет" /> : <div className="detail-list">{ledger.data.slice(0, 20).map((item) => <MovementRow key={item.id} item={item} />)}</div>}</section>
      <section><h3>Оплаты</h3>{payments.isLoading ? <Loading /> : payments.error ? <ErrorState error={payments.error} /> : !payments.data?.length ? <Empty title="Оплат пока нет" /> : <div className="detail-list">{payments.data.slice(0, 20).map((item) => <div key={item.id} className="detail-list-row"><span className={`movement ${item.direction}`}>{item.direction === 'incoming' ? <ArrowDown size={15} /> : <ArrowUp size={15} />}{item.direction === 'incoming' ? 'Получили' : 'Отдали'}</span><div>{item.source_document ? <Link className="inline-operation-link" to={`/operations/document/${item.source_document}`}>{item.number}</Link> : <strong>{item.number}</strong>}<small>{formatDate(item.effective_date)} · {paymentMethod(item.method)}</small></div><Money value={item.amount} />{item.status === 'posted' ? <VoidPaymentButton payment={item} onDone={refresh} /> : <StatusBadge value="voided" label="Отменена" />}</div>)}</div>}</section>
    </div>
  </Modal>;
}

function MovementRow({ item }: { item: SettlementMovement }) {
  const receivable = Number(item.receivable_delta);
  const payable = Number(item.payable_delta);
  const config = item.event_type === 'payment'
    ? { label: receivable < 0 ? 'Получили деньги' : 'Отдали деньги', icon: receivable < 0 ? <ArrowDown size={15} /> : <ArrowUp size={15} /> }
    : item.event_type === 'automatic_offset'
      ? { label: 'Взаимозачёт', icon: <HandCoins size={15} /> }
      : item.event_type === 'payment_voided'
        ? { label: 'Оплата отменена', icon: <RotateCcw size={15} /> }
        : { label: receivable > 0 ? 'Возник долг нам' : 'Возник наш долг', icon: receivable > 0 ? <ArrowDown size={15} /> : <ArrowUp size={15} /> };
  const amount = Math.max(Math.abs(receivable), Math.abs(payable));
  const description = item.description ? shortenDocumentNumbersInText(item.description) : config.label;
  return <div className="detail-list-row"><span className="movement neutral">{config.icon}{config.label}</span><div>{item.document ? <Link className="inline-operation-link" to={`/operations/document/${item.document}`}>{description}</Link> : <strong>{description}</strong>}<small>{formatDateTime(item.occurred_at)}</small></div><Money value={amount} /></div>;
}

function PaymentsTable({ rows, onChanged }: { rows: Payment[]; onChanged(): void }) {
  if (!rows.length) return <Empty title="Оплат ещё нет" />;
  return <div className="table-card finance-payments-table"><table><thead><tr><th>Номер</th><th>Человек</th><th>Дата</th><th>Направление</th><th>Способ</th><th>Статус</th><th className="numeric">Сумма</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.number}</strong></td><td>{row.party_name}</td><td>{formatDate(row.effective_date)}</td><td>{row.direction === 'incoming' ? <span className="movement incoming"><ArrowDown size={16} />Получили</span> : <span className="movement outgoing"><ArrowUp size={16} />Отдали</span>}</td><td>{paymentMethod(row.method)}</td><td><StatusBadge value={row.status} label={row.status === 'posted' ? 'Проведена' : 'Отменена'} /></td><td className="numeric"><Money value={row.amount} /></td><td>{row.status === 'posted' && <VoidPaymentButton payment={row} onDone={onChanged} />}</td></tr>)}</tbody></table></div>;
}

function VoidPaymentButton({ payment, onDone }: { payment: Payment; onDone(): void }) {
  const mutation = useMutation({ mutationFn: (reason: string) => api(`/finance/payments/${payment.id}/void/`, { method: 'POST', headers: idempotencyHeaders(), body: JSON.stringify({ reason }) }), onSuccess: onDone });
  const voidPayment = () => {
    const reason = window.prompt(`Почему отменяем оплату ${payment.number}?`);
    if (reason?.trim()) mutation.mutate(reason.trim());
  };
  return <button className="mini-action danger" onClick={voidPayment} disabled={mutation.isPending} title={mutation.error ? validationMessage(mutation.error) ?? 'Не удалось отменить оплату' : 'Отменить ошибочную оплату'}><RotateCcw size={14} />{mutation.isPending ? 'Отмена…' : 'Отменить'}</button>;
}

function FinanceForm({ mode, warehouseId, initialPartyId, initialDirection, initialAmount, onCancel, onDone }: { mode: 'debt' | 'payment'; warehouseId: number; initialPartyId?: number; initialDirection?: Direction; initialAmount?: string; onCancel(): void; onDone(): void }) {
  const parties = useQuery({ queryKey: ['parties-finance'], queryFn: () => apiAll<Party>('/parties/') });
  const [form, setForm] = useState({ party_id: initialPartyId ? String(initialPartyId) : '', side: 'receivable', direction: initialDirection ?? 'incoming', method: 'cash', amount: initialAmount ?? '', effective_date: new Date().toISOString().slice(0, 10), due_date: '', reason: 'Ручная запись долга', note: '' });
  const [cash, setCash] = useState(initialAmount ?? '');
  const [mbank, setMbank] = useState('');
  const [autoFill, setAutoFill] = useState(false);
  const totalPaid = Math.round((Number(cash || 0) + Number(mbank || 0)) * 100) / 100;
  const maximum = Number(initialAmount ?? 0);
  const paymentInvalid = totalPaid <= 0 || totalPaid > maximum + 0.001 || !Number.isFinite(totalPaid);
  const complementaryAmount = (value: string) => {
    const amount = Number(value);
    if (value === '' || !Number.isFinite(amount) || amount < 0) return '';
    return String(Math.max(0, Math.round((maximum - amount) * 100) / 100));
  };
  const changePaymentAmount = (method: 'cash' | 'mbank', value: string) => {
    if (method === 'cash') {
      setCash(value);
      if (autoFill) setMbank(complementaryAmount(value));
    } else {
      setMbank(value);
      if (autoFill) setCash(complementaryAmount(value));
    }
  };
  const fillPayment = (method: 'cash' | 'mbank') => {
    const fullAmount = initialAmount ?? '';
    setCash(method === 'cash' ? fullAmount : '');
    setMbank(method === 'mbank' ? fullAmount : '');
  };
  const mutation = useMutation({ mutationFn: () => {
    const common = { warehouse_id: warehouseId, party_id: Number(form.party_id), amount: form.amount, effective_date: form.effective_date };
    const body = mode === 'debt'
      ? { ...common, side: form.side, due_date: form.due_date || null, reason: form.reason }
      : { warehouse_id: warehouseId, party_id: Number(form.party_id), direction: form.direction, effective_date: form.effective_date, note: form.note, parts: [{ method: 'cash', amount: cash }, { method: 'mbank', amount: mbank }].filter((part) => Number(part.amount) > 0) };
    return api(mode === 'debt' ? '/finance/obligations/' : '/finance/payments/split/', { method: 'POST', headers: idempotencyHeaders(), body: JSON.stringify(body) });
  }, onSuccess: onDone });
  if (parties.isLoading) return <Loading />;
  const selectedParty = parties.data?.find((party) => party.id === Number(form.party_id));

  if (mode === 'payment') return <form className="finance-payment-dialog" onSubmit={(event: FormEvent) => { event.preventDefault(); mutation.mutate(); }}>
    <div className="finance-payment-total"><span>{form.direction === 'incoming' ? 'К получению' : 'К оплате'}</span><strong>{new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(maximum)} <small>сом</small></strong><small>{selectedParty?.name}</small></div>
    <div className="payment-fields-block"><label className="payment-auto"><input type="checkbox" checked={autoFill} onChange={(event) => { const checked = event.target.checked; setAutoFill(checked); if (checked) setMbank(complementaryAmount(cash)); }} /><span>Авто</span></label><div className="payment-fields"><label>Наличные<div className="payment-input"><input autoFocus type="number" min="0" max={initialAmount} step="0.01" value={cash} onChange={(event) => changePaymentAmount('cash', event.target.value)} placeholder="0" /><span>сом</span></div></label><label>МБанк<div className="payment-input"><input type="number" min="0" max={initialAmount} step="0.01" value={mbank} onChange={(event) => changePaymentAmount('mbank', event.target.value)} placeholder="0" /><span>сом</span></div></label></div></div>
    <div className="payment-methods" aria-label="Заполнить всю сумму"><button type="button" className={Number(cash) === maximum && Number(mbank || 0) === 0 ? 'active' : ''} onClick={() => fillPayment('cash')}>Наличные</button><button type="button" className={Number(mbank) === maximum && Number(cash || 0) === 0 ? 'active' : ''} onClick={() => fillPayment('mbank')}>МБанк</button></div>
    <details className="payment-extra"><summary>Дополнительно <span>дата и комментарий</span></summary><div className="form-grid two"><label>Дата операции<input type="date" value={form.effective_date} onChange={(event) => setForm({ ...form, effective_date: event.target.value })} required /><FieldError error={mutation.error} field="effective_date" /></label><label>Комментарий<input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Необязательно" /><FieldError error={mutation.error} field="note" /></label></div></details>
    {totalPaid > maximum + 0.001 && <div className="form-error">Сумма больше открытого долга на <Money value={totalPaid - maximum} />.</div>}
    {mutation.error && <div className="form-error">{validationMessage(mutation.error) ?? 'Операция отклонена сервером.'}</div>}
    <footer className="finance-payment-footer"><button type="button" className="button secondary" onClick={onCancel}>Назад</button><button className={`button ${form.direction === 'outgoing' ? 'finance-outgoing' : 'finance-incoming'}`} disabled={mutation.isPending || paymentInvalid}>{form.direction === 'incoming' ? <ArrowDown size={22} /> : <ArrowUp size={22} />}{mutation.isPending ? 'Проводим…' : form.direction === 'incoming' ? 'Получить деньги' : 'Отдать деньги'}</button></footer>
  </form>;

  return <form className="debt-entry-form" onSubmit={(event: FormEvent) => { event.preventDefault(); mutation.mutate(); }}>
    <label>Человек или организация<select value={form.party_id} onChange={(event) => setForm({ ...form, party_id: event.target.value })} required><option value="">Выберите…</option>{parties.data?.filter((party) => !party.is_system).map((party) => <option key={party.id} value={party.id}>{party.name}{party.phone ? ` · ${party.phone}` : ''}</option>)}</select><FieldError error={mutation.error} field="party_id" /></label>

    <fieldset className="debt-side-picker"><legend>Кто должен?</legend><button type="button" className={form.side === 'receivable' ? 'active' : ''} onClick={() => setForm({ ...form, side: 'receivable' })}><ArrowDown size={22} /><span><strong>Он должен нам</strong><small>Деньги должны прийти к нам</small></span></button><button type="button" className={form.side === 'payable' ? 'active' : ''} onClick={() => setForm({ ...form, side: 'payable' })}><ArrowUp size={22} /><span><strong>Мы должны ему</strong><small>Деньги должны уйти от нас</small></span></button></fieldset>

    <label className="debt-entry-amount">Сумма долга<div><input autoFocus type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} required placeholder="0" /><span>сом</span></div><FieldError error={mutation.error} field="amount" /></label>

    <details className="payment-extra"><summary>Дополнительно <span>даты операции и оплаты</span></summary><div className="form-grid two"><label>Дата операции<input type="date" value={form.effective_date} onChange={(event) => setForm({ ...form, effective_date: event.target.value })} required /><FieldError error={mutation.error} field="effective_date" /></label><label>Оплатить до <span className="optional-label">необязательно</span><input type="date" min={form.effective_date} value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} /><FieldError error={mutation.error} field="due_date" /></label></div></details>

    {mutation.error && <div className="form-error">{validationMessage(mutation.error) ?? 'Операция отклонена сервером.'}</div>}
    <footer className="finance-payment-footer"><button type="button" className="button secondary" onClick={onCancel}>Назад</button><button className="button primary" disabled={mutation.isPending}><FilePlus2 size={20} />{mutation.isPending ? 'Проводим…' : 'Записать долг'}</button></footer>
  </form>;
}

function paymentMethod(method: Payment['method']) { return ({ cash: 'Наличные', mbank: 'МБанк', aiyl: 'Айыл Банк' })[method]; }
function formatDate(value: string) { return new Intl.DateTimeFormat('ru-RU').format(new Date(`${value}T00:00:00`)); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
