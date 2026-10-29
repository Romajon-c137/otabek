import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, ExternalLink, FileSpreadsheet, ShieldCheck, Upload } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import type { Page } from '../../api/types';
import { useAuth } from '../../app/AuthContext';
import { useWarehouse } from '../../app/WarehouseContext';
import { Empty, ErrorState, Loading } from '../../components/Feedback';
import { PageHeader } from '../../components/Page';
import { Pagination } from '../../components/Pagination';

interface AuditRow { id: number; actor_name: string | null; action: string; entity_type: string; entity_id: string; request_id: string; occurred_at: string }

export function SettingsPage() {
  const { user } = useAuth();
  const canAudit = user?.role === 'owner' || user?.role === 'auditor';
  return <><PageHeader eyebrow="Контроль системы" title="Управление" description="Импорт справочников, внешние каталоги, API-документация и неизменяемая история действий." /><section className="settings-grid"><ImportPanel /><OtabekPanel /><article className="settings-card"><div className="settings-icon"><ShieldCheck /></div><h2>Администрирование</h2><p>Пользователи, роли и доступ к складам управляются через защищённую административную панель.</p><div className="settings-links"><a className="button secondary" href="/admin/" target="_blank">Открыть Django Admin <ExternalLink size={16} /></a><a className="button ghost" href="/api/docs/" target="_blank">Документация API <ExternalLink size={16} /></a></div></article></section>{canAudit && <AuditPanel />}</>;
}

function OtabekPanel() {
  const sync = useMutation({ mutationFn: () => api<{ created: number; updated: number; disabled: number; variants: number }>('/catalog/products/sync-otabek/', { method: 'POST' }) });
  return <article className="settings-card"><div className="settings-icon"><ExternalLink /></div><h2>Каталог Otabek</h2><p>Размеры синхронизируются как отдельные варианты без складского FIFO — количество задаётся прямо в продаже.</p><div className="settings-links"><button className="button secondary" onClick={() => sync.mutate()} disabled={sync.isPending}>{sync.isPending ? 'Синхронизация…' : 'Синхронизировать'}</button><a className="button ghost" href="https://otabek.glasscenter.kg/add" target="_blank" rel="noreferrer">Новый товар <ExternalLink size={16} /></a></div>{sync.data && <div className="success-box">Вариантов: {sync.data.variants}, создано: {sync.data.created}, обновлено: {sync.data.updated}</div>}{sync.error && <div className="form-error">Синхронизация не выполнена. Проверьте серверные реквизиты Otabek.</div>}</article>;
}

function ImportPanel() {
  const { warehouseId } = useWarehouse();
  const [file, setFile] = useState<File | null>(null);
  const [batch, setBatch] = useState<{ id: number; rows: number; errors: { sheet?: string; row: number; field?: string; message: string }[] } | null>(null);
  const validate = useMutation({ mutationFn: async () => { const body = new FormData(); body.append('file', file!); return api<{ id: number; rows: number; errors: { sheet?: string; row: number; field?: string; message: string }[] }>('/import/validate/', { method: 'POST', body }); }, onSuccess: setBatch });
  const apply = useMutation({ mutationFn: () => api<{ products_created: number; products_updated: number; parties_created: number; parties_updated: number; stock_lines: number; debts: number }>(`/import/${batch!.id}/apply/`, { method: 'POST', body: JSON.stringify({ warehouse_id: warehouseId }) }) });
  function submit(event: FormEvent) { event.preventDefault(); if (file) validate.mutate(); }
  return <article className="settings-card"><div className="settings-icon green"><FileSpreadsheet /></div><h2>Начальная загрузка</h2><p>Товары, контрагенты, партии остатков и долги проверяются целиком. Изменения применяются одной транзакцией.</p><a className="text-link" href="/api/v1/import/template/"><Download size={16} />Скачать XLSX-шаблон</a><form className="upload-box" onSubmit={submit}><input type="file" accept=".xlsx" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setBatch(null); }} required /><button className="button secondary" disabled={!file || validate.isPending}><Upload size={17} />{validate.isPending ? 'Проверяем…' : 'Проверить файл'}</button></form>{validate.error && <div className="form-error">Файл отклонён. Проверьте формат и данные.</div>}{batch && <div className="import-result"><strong>Проверено строк: {batch.rows}</strong>{batch.errors.length ? <ul>{batch.errors.map((error, index) => <li key={index}>{error.sheet && `${error.sheet}, `}строка {error.row}{error.field && `, ${error.field}`}: {error.message}</li>)}</ul> : <><span>Ошибок нет. Можно применить изменения.</span><button className="button primary" onClick={() => apply.mutate()} disabled={apply.isPending || !warehouseId}>{apply.isPending ? 'Применяем…' : 'Применить импорт'}</button></>}</div>}{apply.data && <div className="success-box">Товары: +{apply.data.products_created}, контрагенты: +{apply.data.parties_created}, партии: {apply.data.stock_lines}, долги: {apply.data.debts}</div>}</article>;
}

function AuditPanel() {
  const [page, setPage] = useState(1);
  const audit = useQuery({ queryKey: ['audit', page], queryFn: () => api<Page<AuditRow>>(`/audit/?page_size=50&page=${page}`) });
  return <section className="audit-section"><div className="section-title"><div><span className="eyebrow">Безопасность</span><h2>Последние действия</h2></div></div>{audit.isLoading ? <Loading /> : audit.error ? <ErrorState error={audit.error} /> : !audit.data?.results.length ? <Empty title="Журнал пока пуст" /> : <><div className="table-card"><table><thead><tr><th>Время</th><th>Пользователь</th><th>Действие</th><th>Объект</th><th>Request ID</th></tr></thead><tbody>{audit.data.results.map((row) => <tr key={row.id}><td>{new Date(row.occurred_at).toLocaleString('ru-RU')}</td><td>{row.actor_name ?? 'Система'}</td><td><code>{row.action}</code></td><td>{row.entity_type} #{row.entity_id}</td><td><code>{row.request_id || '—'}</code></td></tr>)}</tbody></table></div><Pagination page={audit.data.page} pages={audit.data.pages} total={audit.data.count} onChange={setPage} /></>}</section>;
}

