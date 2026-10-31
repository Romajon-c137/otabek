import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ClipboardList, ExternalLink, PackagePlus, Search, ShoppingCart, UsersRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, queryString } from '../../api/client';
import type { DocumentKind, Page, TradeDocument } from '../../api/types';
import { useWarehouse } from '../../app/WarehouseContext';
import { Empty, ErrorState, Loading } from '../../components/Feedback';
import { Money } from '../../components/Page';
import { Pagination } from '../../components/Pagination';
import { shortDocumentNumber } from '../documents/documentNumbers';

const tabs: { kind: DocumentKind; label: string; icon: typeof ShoppingCart }[] = [
  { kind: 'sale', label: 'Продажи', icon: ShoppingCart },
  { kind: 'receipt', label: 'Приходы', icon: PackagePlus },
  { kind: 'customer_order', label: 'Заказы', icon: ClipboardList },
];

export function HistoryPage() {
  const { warehouseId } = useWarehouse();
  const [kind, setKind] = useState<DocumentKind>('sale');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const documents = useQuery({
    queryKey: ['history', kind, warehouseId, page],
    queryFn: () => api<Page<TradeDocument>>(`/documents/${queryString({ warehouse: warehouseId, kind, page_size: 50, page })}`),
    enabled: warehouseId !== null,
  });
  const rows = useMemo(() => (documents.data?.results ?? []).filter((item) => {
    const term = search.trim().toLowerCase();
    return !term || item.number.toLowerCase().includes(term) || (item.party_name ?? '').toLowerCase().includes(term);
  }), [documents.data?.results, search]);
  return <section className="history-page">
    <header className="history-heading"><Link className="button secondary compact" to="/"><ArrowLeft size={15} />Касса</Link><h1>Просмотр</h1></header>
    <nav className="history-tabs">
      {tabs.map(({ kind: value, label, icon: Icon }) => <button key={value} className={kind === value ? 'active' : ''} onClick={() => { setKind(value); setPage(1); }}><Icon size={18} />{label}</button>)}
      <Link to="/finance"><UsersRound size={18} />Люди и долги</Link>
    </nav>
    <label className="history-search"><Search size={21} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Номер или покупатель" /></label>
    {documents.isLoading ? <Loading /> : documents.error ? <ErrorState error={documents.error} /> : rows.length === 0 ? <Empty title="Записей пока нет" /> : <div className="history-table"><table><thead><tr><th>{kind === 'receipt' ? 'Поставщик' : 'Покупатель'}</th><th>Дата</th><th className="numeric">Сумма, сом</th><th className="numeric">Статус</th><th>Документ</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.party_name ?? 'Розничный покупатель'}</strong><small>{shortDocumentNumber(row.kind, row.number)}</small></td><td>{row.effective_date}</td><td className="numeric"><Money value={row.amount_total} /></td><td className="numeric">{row.status_label}</td><td>{row.kind_label}</td><td><Link className="operation-link" to={`/operations/document/${row.id}`}><ExternalLink size={15} />Подробнее</Link></td></tr>)}</tbody></table></div>}
    {documents.data && <Pagination page={documents.data.page} pages={documents.data.pages} total={documents.data.count} onChange={setPage} />}
  </section>;
}
