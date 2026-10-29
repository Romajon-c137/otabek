import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, queryString } from '../../api/client';
import { useWarehouse } from '../../app/WarehouseContext';
import { Empty, ErrorState, Loading } from '../../components/Feedback';
import { Money, PageHeader } from '../../components/Page';

type ReportKind = 'sales' | 'gross-profit' | 'settlements' | 'stock';

export function ReportsPage() {
  const { warehouseId } = useWarehouse();
  const [kind, setKind] = useState<ReportKind>('sales');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const report = useQuery({ queryKey: ['report', kind, warehouseId, dateFrom, dateTo], queryFn: () => api<any>(`/reports/${kind}/${queryString({ warehouse: warehouseId, date_from: dateFrom, date_to: dateTo })}`), enabled: warehouseId !== null });
  return <><PageHeader eyebrow="Серверные агрегаты" title="Отчёты" description="Итоги рассчитаны по всему набору данных, а не только по строкам на экране." /><div className="report-controls"><div className="segmented"><button className={kind === 'sales' ? 'active' : ''} onClick={() => setKind('sales')}>Продажи</button><button className={kind === 'gross-profit' ? 'active' : ''} onClick={() => setKind('gross-profit')}>Валовая прибыль</button><button className={kind === 'settlements' ? 'active' : ''} onClick={() => setKind('settlements')}>Долги</button><button className={kind === 'stock' ? 'active' : ''} onClick={() => setKind('stock')}>Остатки</button></div>{['sales', 'gross-profit'].includes(kind) && <div className="date-range"><label>С<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label>По<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label></div>}</div>{report.isLoading ? <Loading /> : report.error ? <ErrorState error={report.error} /> : <ReportTable kind={kind} data={report.data} />}</>;
}

function ReportTable({ kind, data }: { kind: ReportKind; data: any }) {
  if (!data?.rows?.length) return <Empty title="За выбранный период данных нет" />;
  if (kind === 'sales') return <div className="table-card"><table><thead><tr><th>Товар</th><th className="numeric">Количество</th><th className="numeric">Выручка</th></tr></thead><tbody>{data.rows.map((row: any) => <tr key={row.product_id}><td>{row.product_name}</td><td className="numeric">{row.quantity}</td><td className="numeric"><Money value={row.revenue} /></td></tr>)}</tbody><tfoot><tr><th>Итого</th><th className="numeric">{data.totals.quantity}</th><th className="numeric"><Money value={data.totals.revenue} /></th></tr></tfoot></table></div>;
  if (kind === 'gross-profit') return <div className="table-card"><table><thead><tr><th>Товар</th><th className="numeric">Выручка</th><th className="numeric">Себестоимость FIFO</th><th className="numeric">Валовая прибыль</th></tr></thead><tbody>{data.rows.map((row: any) => <tr key={row.product_id}><td>{row.product_name}</td><td className="numeric"><Money value={row.revenue} /></td><td className="numeric"><Money value={row.cost} /></td><td className="numeric"><Money value={row.gross_profit} tone={Number(row.gross_profit) >= 0 ? 'positive' : 'negative'} /></td></tr>)}</tbody><tfoot><tr><th>Итого</th><th className="numeric"><Money value={data.totals.revenue} /></th><th className="numeric"><Money value={data.totals.cost} /></th><th className="numeric"><Money value={data.totals.gross_profit} /></th></tr></tfoot></table></div>;
  if (kind === 'settlements') return <div className="table-card"><table><thead><tr><th>Контрагент</th><th className="numeric">Нам должны</th><th className="numeric">Мы должны</th><th className="numeric">Баланс</th></tr></thead><tbody>{data.rows.map((row: any) => <tr key={row.party_id}><td>{row.party_name}</td><td className="numeric"><Money value={row.receivable} /></td><td className="numeric"><Money value={row.payable} /></td><td className="numeric"><Money value={row.balance} tone={Number(row.balance) >= 0 ? 'positive' : 'negative'} /></td></tr>)}</tbody></table></div>;
  return <div className="table-card"><table><thead><tr><th>Товар</th><th>Склад</th><th className="numeric">Количество</th><th className="numeric">Доступно</th><th className="numeric">Себестоимость остатка</th></tr></thead><tbody>{data.rows.map((row: any) => <tr key={`${row.warehouse_id}-${row.product_id}`}><td>{row.product_name}</td><td>{row.warehouse_name}</td><td className="numeric">{row.track_stock ? row.quantity : '—'}</td><td className="numeric">{row.track_stock ? row.available : 'без учёта'}</td><td className="numeric"><Money value={row.inventory_value} /></td></tr>)}</tbody></table></div>;
}

