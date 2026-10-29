import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, UserRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, queryString } from '../../api/client';
import type { Page, Party } from '../../api/types';
import { Empty, ErrorState, FieldError, Loading, validationMessage } from '../../components/Feedback';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/Page';
import { Pagination } from '../../components/Pagination';

export function PartiesPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Party | null>(null);
  const query = useQuery({ queryKey: ['parties-list', search, page], queryFn: () => api<Page<Party>>(`/parties/${queryString({ q: search, page_size: 60, page })}`) });
  if (query.isLoading) return <Loading />;
  if (query.error || !query.data) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  function close() { setOpen(false); setEditing(null); }
  return <><PageHeader eyebrow="Справочник" title="Люди" description="У каждого человека единая история заказов, продаж, поступлений, оплат и долгов." actions={<button className="button primary" onClick={() => { setEditing(null); setOpen(true); }}><Plus size={18} />Добавить человека</button>} /><div className="toolbar"><label className="search-box"><Search size={18} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Имя, код или телефон" /></label></div>{query.data.results.length === 0 ? <Empty title="Люди не найдены" /> : <div className="party-grid">{query.data.results.map((party) => <article className="party-card" key={party.id}><div className="party-avatar"><UserRound /></div><div><strong>{party.name}</strong><span>{party.code}</span></div><dl><div><dt>Телефон</dt><dd>{party.phone || '—'}</dd></div><div><dt>Адрес</dt><dd>{party.address || '—'}</dd></div></dl>{!party.is_system && <button className="mini-action party-edit" onClick={() => { setEditing(party); setOpen(true); }}><Pencil size={15} />Изменить</button>}</article>)}</div>}<Pagination page={query.data.page} pages={query.data.pages} total={query.data.count} onChange={setPage} />{open && <Modal title={editing ? `Человек · ${editing.code}` : 'Новый человек'} onClose={close}><PartyForm key={editing?.id ?? 'new'} initial={editing ?? undefined} onDone={() => { close(); void query.refetch(); }} /></Modal>}</>;
}

function PartyForm({ initial, onDone }: { initial?: Party; onDone(): void }) {
  const cache = useQueryClient();
  const [form, setForm] = useState({ code: initial?.code ?? '', name: initial?.name ?? '', phone: initial?.phone ?? '', address: initial?.address ?? '', note: initial?.note ?? '' });
  const mutation = useMutation({ mutationFn: () => api<Party>(initial ? `/parties/${initial.id}/` : '/parties/', { method: initial ? 'PATCH' : 'POST', body: JSON.stringify(form) }), onSuccess: () => { void cache.invalidateQueries({ queryKey: ['parties'] }); void cache.invalidateQueries({ queryKey: ['pos-people'] }); onDone(); } });
  return <form className="person-form" onSubmit={(event: FormEvent) => { event.preventDefault(); mutation.mutate(); }}><div className="form-grid two"><label>Имя<input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /><FieldError error={mutation.error} field="name" /></label><label>Телефон<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /><FieldError error={mutation.error} field="phone" /></label></div><details className="optional-person-fields"><summary>Дополнительные данные</summary><div className="form-grid two"><label>Код<input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="Создастся автоматически" /><FieldError error={mutation.error} field="code" /></label><label>Адрес<input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /><FieldError error={mutation.error} field="address" /></label><label className="span-two">Комментарий<textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} rows={3} /><FieldError error={mutation.error} field="note" /></label></div></details>{mutation.error && <div className="form-error">{validationMessage(mutation.error) ?? 'Не удалось сохранить человека.'}</div>}<footer className="form-footer"><button className="button primary" disabled={mutation.isPending}>{mutation.isPending ? 'Сохраняем…' : initial ? 'Сохранить изменения' : 'Создать человека'}</button></footer></form>;
}

