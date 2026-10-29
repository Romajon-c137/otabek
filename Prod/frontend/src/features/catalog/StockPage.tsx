import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackagePlus, Pencil, Plus, Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, queryString } from '../../api/client';
import type { Product } from '../../api/types';
import { useWarehouse } from '../../app/WarehouseContext';
import { Empty, ErrorState, FieldError, Loading, validationMessage } from '../../components/Feedback';
import { Modal } from '../../components/Modal';
import { Money, PageHeader } from '../../components/Page';

interface StockRow { warehouse_id: number; warehouse_name: string; product_id: number; product_name: string; variant_name: string; track_stock: boolean; sku: string; category: string; quantity: string; reserved: string; available: string; inventory_value: string; retail_value: string }
interface StockReport { rows: StockRow[]; totals: { quantity: string; reserved: string; inventory_value: string; retail_value: string } }

export function StockPage() {
  const { warehouseId } = useWarehouse();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [productOpen, setProductOpen] = useState(() => searchParams.get('new') === '1');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [loadError, setLoadError] = useState('');
  const stock = useQuery({ queryKey: ['stock', warehouseId, search], queryFn: () => api<StockReport>(`/reports/stock/${queryString({ warehouse: warehouseId, q: search })}`), enabled: warehouseId !== null });
  if (stock.isLoading) return <Loading />;
  if (stock.error || !stock.data) return <ErrorState error={stock.error} retry={() => void stock.refetch()} />;
  async function editProduct(id: number) {
    setLoadError('');
    try {
      setEditingProduct(await api<Product>(`/catalog/products/${id}/`));
      setProductOpen(true);
    } catch {
      setLoadError('Не удалось загрузить карточку товара.');
    }
  }
  function closeProduct() {
    setProductOpen(false);
    setEditingProduct(null);
    if (searchParams.has('new')) setSearchParams({}, { replace: true });
  }
  return <><PageHeader eyebrow="Складской регистр" title="Товары и остатки" description="Фактическое количество, активные резервы и свободный остаток выбранного склада." actions={<><Link className="button secondary" to="/opening"><PackagePlus size={18} />Ввод остатков</Link><button className="button primary" onClick={() => { setEditingProduct(null); setProductOpen(true); }}><Plus size={18} />Новый товар</button></>} />{loadError && <div className="form-error page-error">{loadError}</div>}<div className="toolbar"><label className="search-box"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Название, артикул или штрихкод" /></label><div className="toolbar-summary"><span>Всего</span><strong>{stock.data.totals.quantity}</strong><span>Резерв</span><strong>{stock.data.totals.reserved}</strong><span>Себестоимость</span><Money value={stock.data.totals.inventory_value} /></div></div>{stock.data.rows.length === 0 ? <Empty title="Каталог пока пуст"><span>Создайте товар или синхронизируйте внешний каталог.</span></Empty> : <div className="table-card"><table><thead><tr><th>Товар</th><th>Категория</th><th className="numeric">В наличии</th><th className="numeric">Резерв</th><th className="numeric">Доступно</th><th className="numeric">Себестоимость</th><th /></tr></thead><tbody>{stock.data.rows.map((row) => <tr key={`${row.warehouse_id}-${row.product_id}`}><td><strong>{row.product_name}{row.variant_name && ` — ${row.variant_name}`}</strong><small>{row.sku || (row.track_stock ? 'Без артикула' : 'Внешний каталог')}</small></td><td>{row.category || '—'}</td><td className="numeric">{row.track_stock ? row.quantity : '—'}</td><td className="numeric muted">{row.track_stock ? row.reserved : '—'}</td><td className="numeric"><strong>{row.track_stock ? row.available : 'без учёта'}</strong></td><td className="numeric"><Money value={row.inventory_value} /></td><td><button className="mini-action" onClick={() => void editProduct(row.product_id)}><Pencil size={15} />Изменить</button></td></tr>)}</tbody></table></div>}{productOpen && <Modal title={editingProduct ? `Товар · ${editingProduct.code}` : 'Новый товар'} onClose={closeProduct}><ProductForm key={editingProduct?.id ?? 'new'} initial={editingProduct ?? undefined} onDone={() => { closeProduct(); void stock.refetch(); }} /></Modal>}</>;
}

function ProductForm({ initial, onDone }: { initial?: Product; onDone(): void }) {
  const cache = useQueryClient();
  const [form, setForm] = useState({ name: initial?.name ?? '', sku: initial?.sku ?? '', barcode: initial?.barcode ?? '', unit: initial?.unit ?? 'piece', purchase_price: initial?.purchase_price === '0.00' ? '' : initial?.purchase_price ?? '', retail_price: initial?.retail_price === '0.00' ? '' : initial?.retail_price ?? '', wholesale_price: initial?.wholesale_price === '0.00' ? '' : initial?.wholesale_price ?? '', is_active: initial?.is_active ?? true });
  const [image, setImage] = useState<File | null>(null);
  const mutation = useMutation({ mutationFn: () => { const body = new FormData(); Object.entries(form).forEach(([key, value]) => body.append(key, ['purchase_price', 'retail_price', 'wholesale_price'].includes(key) && value === '' ? '0.00' : String(value))); if (image) body.append('image', image); return api<Product>(initial ? `/catalog/products/${initial.id}/` : '/catalog/products/', { method: initial ? 'PATCH' : 'POST', body }); }, onSuccess: () => { void cache.invalidateQueries({ queryKey: ['products-active'] }); onDone(); } });
  function submit(event: FormEvent) { event.preventDefault(); mutation.mutate(); }
  return <form onSubmit={submit}><div className="form-grid two"><label className="span-two">Название<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /><FieldError error={mutation.error} field="name" /></label><label>Артикул<input value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} /><FieldError error={mutation.error} field="sku" /></label><label>Штрихкод<input value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} /><FieldError error={mutation.error} field="barcode" /></label><label>Единица<select value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value as Product['unit'] })}><option value="piece">шт.</option><option value="kg">кг</option><option value="meter">м</option></select><FieldError error={mutation.error} field="unit" /></label><label>Фотография<input type="file" accept="image/*" onChange={(event) => setImage(event.target.files?.[0] ?? null)} /><FieldError error={mutation.error} field="image" /></label><label>Закупочная цена<input type="number" min="0" step="0.01" value={form.purchase_price} onChange={(event) => setForm({ ...form, purchase_price: event.target.value })} /><FieldError error={mutation.error} field="purchase_price" /></label><label>Розничная цена<input type="number" min="0" step="0.01" value={form.retail_price} onChange={(event) => setForm({ ...form, retail_price: event.target.value })} /><FieldError error={mutation.error} field="retail_price" /></label><label>Оптовая цена<input type="number" min="0" step="0.01" value={form.wholesale_price} onChange={(event) => setForm({ ...form, wholesale_price: event.target.value })} /><FieldError error={mutation.error} field="wholesale_price" /></label><label><input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /> Активен</label></div>{mutation.error && <div className="form-error">{validationMessage(mutation.error) ?? 'Не удалось сохранить товар.'}</div>}<footer className="form-footer"><button className="button primary" disabled={mutation.isPending}>{mutation.isPending ? 'Сохраняем…' : initial ? 'Сохранить изменения' : 'Создать товар'}</button></footer></form>;
}

