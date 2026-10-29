import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, ClipboardList, Maximize2, Minus, Pencil, Plus, Search, ShoppingCart, UserRound, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, apiAll, ApiError, idempotencyHeaders } from '../../api/client';
import type { Party, Product, TradeDocument } from '../../api/types';
import { useWarehouse } from '../../app/WarehouseContext';
import { Empty, ErrorState, Loading, validationMessage } from '../../components/Feedback';
import { Modal } from '../../components/Modal';

type PriceMode = 'retail' | 'wholesale';
interface PaymentAmounts { cash: string; mbank: string }
interface NeighborTerms { supplier: Party; quantity: number; unitPrice: number }
interface LineTerms { unitPrice: number; discountAmount: number; neighborSupply?: NeighborTerms }
interface CartLine extends LineTerms { product: Product; quantity: number }
interface VariantDraft extends LineTerms { quantity: number }
interface ProductGroup { key: string; name: string; image: string; variants: Product[] }

const money = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const priceOf = (product: Product, mode: PriceMode) => Number(mode === 'retail' ? product.retail_price : product.wholesale_price);
const lineTotal = (line: Pick<CartLine, 'quantity' | 'unitPrice' | 'discountAmount'>) => Math.max(0, line.quantity * line.unitPrice - line.discountAmount);

export function PosPage({ flow = 'sale' }: { flow?: 'sale' | 'order' }) {
  const { warehouseId } = useWarehouse();
  const cache = useQueryClient();
  const navigate = useNavigate();
  const isOrder = flow === 'order';
  const [mode, setMode] = useState<PriceMode>('retail');
  const [search, setSearch] = useState('');
  const [party, setParty] = useState<Party | null>(null);
  const [partyOpen, setPartyOpen] = useState(isOrder);
  const [activeGroup, setActiveGroup] = useState<ProductGroup | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [cart, setCart] = useState<Record<number, CartLine>>({});
  const [notice, setNotice] = useState('');

  const products = useQuery({ queryKey: ['pos-products'], queryFn: () => apiAll<Product>('/catalog/products/?active=true') });
  const people = useQuery({ queryKey: ['pos-people'], queryFn: () => apiAll<Party>('/parties/?is_active=true') });
  const selectablePeople = (people.data ?? []).filter((person) =>
    !person.is_system
    && !person.system_key
    && person.is_active
    && person.name.trim().toLocaleLowerCase('ru-RU') !== 'розничный покупатель'
  );

  const groups = useMemo<ProductGroup[]>(() => {
    const grouped = new Map<string, Product[]>();
    for (const product of products.data ?? []) {
      const key = product.name.trim().toLocaleLowerCase('ru-RU');
      grouped.set(key, [...(grouped.get(key) ?? []), product]);
    }
    return [...grouped.entries()].map(([key, variants]) => ({
      key,
      name: variants[0].name,
      image: variants.find((item) => item.image || item.external_image_url)?.image || variants.find((item) => item.external_image_url)?.external_image_url || '',
      variants: variants.sort((a, b) => (a.variant_name || a.sku).localeCompare(b.variant_name || b.sku, 'ru')),
    })).filter((group) => group.name.toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU')));
  }, [products.data, search]);

  const lines = Object.values(cart);
  const total = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const groupedCart = (() => {
    const result = new Map<string, CartLine[]>();
    for (const line of lines) result.set(line.product.name, [...(result.get(line.product.name) ?? []), line]);
    return [...result.entries()];
  })();

  const sale = useMutation({
    mutationFn: async (amounts: PaymentAmounts) => {
      if (!warehouseId || !lines.length) throw new Error('Чек пуст.');
      const cash = Math.round(Number(amounts.cash || 0) * 100) / 100;
      const mbank = Math.round(Number(amounts.mbank || 0) * 100) / 100;
      const paid = Math.round((cash + mbank) * 100) / 100;
      if (!Number.isFinite(cash) || !Number.isFinite(mbank) || cash < 0 || mbank < 0) throw new Error('Проверьте суммы оплаты.');
      if (paid > total + 0.001) throw new Error('Сумма оплаты не может быть больше итога чека.');
      if (paid < total - 0.001 && !party) throw new Error('При неполной оплате выберите человека — остаток будет записан ему в долг.');
      const document = await api<TradeDocument>('/documents/', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'sale', warehouse_id: warehouseId, party_id: party?.id ?? null,
          effective_date: new Date().toISOString().slice(0, 10), note: '', document_discount_amount: '0.00', extra_costs: [],
          lines: lines.map((line) => ({
            product_id: line.product.id,
            quantity: String(line.quantity),
            unit_price: line.unitPrice.toFixed(2),
            discount_amount: line.discountAmount.toFixed(2),
            ...(line.neighborSupply ? { neighbor_supply: {
              supplier_id: line.neighborSupply.supplier.id,
              quantity: String(line.neighborSupply.quantity),
              unit_price: line.neighborSupply.unitPrice.toFixed(2),
            } } : {}),
          })),
        }),
      });
      return api<TradeDocument>(`/documents/${document.id}/post/`, {
        method: 'POST', headers: idempotencyHeaders(),
        body: JSON.stringify({ payments: [
          ...(cash > 0 ? [{ method: 'cash', amount: cash.toFixed(2) }] : []),
          ...(mbank > 0 ? [{ method: 'mbank', amount: mbank.toFixed(2) }] : []),
        ] }),
      });
    },
    onSuccess: (document) => {
      setCart({}); setPaymentOpen(false); setNotice(`Продажа ${document.number} успешно проведена.`);
      void cache.invalidateQueries();
    },
  });

  const order = useMutation({
    mutationFn: async (note: string) => {
      if (!warehouseId || !lines.length) throw new Error('Заказ пуст.');
      if (!party) throw new Error('Для заказа обязательно выберите человека.');
      return api<TradeDocument>('/documents/', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'customer_order', warehouse_id: warehouseId, party_id: party.id,
          effective_date: new Date().toISOString().slice(0, 10), note, document_discount_amount: '0.00', extra_costs: [],
          lines: lines.map((line) => ({
            product_id: line.product.id,
            quantity: String(line.quantity),
            unit_price: line.unitPrice.toFixed(2),
            discount_amount: line.discountAmount.toFixed(2),
            ...(line.neighborSupply ? { neighbor_supply: {
              supplier_id: line.neighborSupply.supplier.id,
              quantity: String(line.neighborSupply.quantity),
              unit_price: line.neighborSupply.unitPrice.toFixed(2),
            } } : {}),
          })),
        }),
      });
    },
    onSuccess: () => {
      setCart({}); setOrderOpen(false);
      void cache.invalidateQueries({ queryKey: ['documents'] });
      navigate('/orders');
    },
  });

  if (products.isLoading) return <Loading />;
  if (products.error || !products.data) return <ErrorState error={products.error} retry={() => void products.refetch()} />;

  function applyVariants(group: ProductGroup, values: Record<number, VariantDraft>) {
    setCart((current) => {
      const next = { ...current };
      for (const variant of group.variants) {
        const value = values[variant.id];
        if (value?.quantity > 0) next[variant.id] = { product: variant, ...value };
        else delete next[variant.id];
      }
      return next;
    });
    setActiveGroup(null);
  }

  return <section className="pos-page">
    <header className="pos-titlebar">
      <div><Link className="button secondary compact" to={isOrder ? '/orders' : '/'}><ArrowLeft size={15} />{isOrder ? 'Заказы' : 'Касса'}</Link><h1>{isOrder ? <ClipboardList size={24} /> : <ShoppingCart size={24} />}{isOrder ? 'Новый заказ' : 'Продажа'}</h1></div>
      <div className="price-switch"><button className={mode === 'retail' ? 'active' : ''} onClick={() => setMode('retail')}>Розница</button><button className={mode === 'wholesale' ? 'active' : ''} onClick={() => setMode('wholesale')}>Оптом</button></div>
    </header>
    {notice && <div className="pos-notice"><Check size={17} />{notice}<button onClick={() => setNotice('')} aria-label="Закрыть"><X size={15} /></button></div>}
    <div className="pos-workspace">
      <div className="catalog-pane">
        <label className="catalog-search"><Search size={18} /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск товара..." /></label>
        {groups.length === 0 ? <Empty title="Товары не найдены" /> : <div className="product-grid">{groups.map((group) => {
          const inCart = group.variants.reduce((sum, item) => sum + (cart[item.id]?.quantity ?? 0), 0);
          const prices = group.variants.map((item) => priceOf(item, mode));
          return <button className={`product-card ${inCart ? 'selected' : ''}`} key={group.key} onClick={() => setActiveGroup(group)}>
            {inCart > 0 && <span className="in-cart">В чеке: {inCart} шт</span>}
            <div className="product-photo">{group.image ? <img src={group.image} alt={group.name} loading="lazy" decoding="async" /> : <ShoppingCart size={42} />}</div>
            <strong>{group.name}</strong>
            <div className="product-price">{money.format(Math.min(...prices))}{Math.max(...prices) !== Math.min(...prices) && `–${money.format(Math.max(...prices))}`} <small>сом</small></div>
          </button>;
        })}</div>}
      </div>
      <aside className="cart-pane">
        <header>{isOrder ? <ClipboardList size={22} /> : <ShoppingCart size={22} />}<strong>{isOrder ? 'Заказ' : 'Чек'}</strong><span>{lines.length ? `${lines.length} ${lines.length === 1 ? 'товар' : 'товара'}` : ''}</span><button className={`cart-person-button ${isOrder && !party ? 'required' : ''}`} onClick={() => setPartyOpen(true)} title={party ? `Человек: ${party.name}` : 'Выбрать человека'}><UserRound size={16} /><span>{party?.name ?? 'Выбрать человека'}</span></button></header>
        <div className="cart-columns"><span>Товар / размер</span><span>Кол-во</span><span>Сумма</span></div>
        <div className="cart-lines">{groupedCart.length === 0 ? <div className="cart-empty">{isOrder ? <ClipboardList size={36} /> : <ShoppingCart size={36} />}<strong>{isOrder ? 'Заказ пуст' : 'Чек пуст'}</strong><span>{isOrder && !party ? 'Сначала выберите человека, затем товары' : 'Выберите товар слева'}</span></div> : groupedCart.map(([name, groupLines]) => <article className="cart-group" key={name}>
          <div className="cart-group-title"><strong>{name}</strong><button onClick={() => setActiveGroup(groups.find((item) => item.name === name) ?? null)} aria-label={`Изменить ${name}`}><Pencil size={15} /></button><button onClick={() => setCart((current) => { const next = { ...current }; groupLines.forEach((line) => delete next[line.product.id]); return next; })} aria-label={`Удалить ${name}`}><X size={14} /></button></div>
          {groupLines.map((line) => <div className="cart-row" key={line.product.id}><span>{line.product.variant_name || line.product.sku || 'Без размера'}{line.neighborSupply && <small>От соседа: {line.neighborSupply.quantity} шт</small>}</span><span>{line.quantity} {unitLabel(line.product.unit)}</span><strong>{money.format(lineTotal(line))}</strong></div>)}
        </article>)}</div>
        <footer><div><span>Итого:</span><strong>{money.format(total)} сом</strong></div><button className="accept-payment" disabled={!lines.length || (isOrder && !party)} onClick={() => isOrder ? setOrderOpen(true) : setPaymentOpen(true)}><Check size={19} />{isOrder ? 'Сохранить заказ' : 'Принять оплату'}</button></footer>
      </aside>
    </div>
    {activeGroup && <VariantDialog group={activeGroup} mode={mode} cart={cart} people={selectablePeople} onClose={() => setActiveGroup(null)} onApply={(values) => applyVariants(activeGroup, values)} />}
    {partyOpen && <PartyDialog parties={selectablePeople} selected={party} allowNone={!isOrder} title="Выбрать человека" onSelect={(value) => { setParty(value); setPartyOpen(false); }} onClose={() => setPartyOpen(false)} />}
    {!isOrder && paymentOpen && <PaymentDialog total={total} canDebt={Boolean(party)} pending={sale.isPending} error={sale.error} onPay={(value) => sale.mutate(value)} onClose={() => { if (!sale.isPending) setPaymentOpen(false); }} />}
    {isOrder && orderOpen && party && <OrderDialog party={party} total={total} pending={order.isPending} error={order.error} onSave={(note) => order.mutate(note)} onClose={() => { if (!order.isPending) setOrderOpen(false); }} />}
  </section>;
}

function VariantDialog({ group, mode, cart, people, onApply, onClose }: { group: ProductGroup; mode: PriceMode; cart: Record<number, CartLine>; people: Party[]; onApply(values: Record<number, VariantDraft>): void; onClose(): void }) {
  const [values, setValues] = useState<Record<number, VariantDraft>>(() => Object.fromEntries(group.variants.map((item) => [item.id, cart[item.id] ? { quantity: cart[item.id].quantity, unitPrice: cart[item.id].unitPrice, discountAmount: cart[item.id].discountAmount, neighborSupply: cart[item.id].neighborSupply } : { quantity: 0, unitPrice: priceOf(item, mode), discountAmount: 0 }])));
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<Product | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const shown = group.variants.filter((item) => (item.variant_name || item.sku || '').toLocaleLowerCase('ru-RU').includes(filter.trim().toLocaleLowerCase('ru-RU')));
  const total = group.variants.reduce((sum, item) => sum + lineTotal(values[item.id]), 0);
  const count = Object.values(values).reduce((sum, value) => sum + value.quantity, 0);
  const hadSelection = group.variants.some((item) => Boolean(cart[item.id]?.quantity));
  const patchQuantity = (id: number, quantity: number) => setValues((current) => ({ ...current, [id]: { ...current[id], quantity: Math.max(0, Math.floor(quantity || 0)) } }));
  return <>
    <Modal title={group.name} onClose={onClose} wide className="product-variant-modal"><div className="variant-dialog">
      <div className="variant-photo-pane">{group.image ? <button className="variant-photo-button" onClick={() => setPhotoOpen(true)} aria-label={`Открыть фотографию ${group.name} на весь экран`}><img src={group.image} alt={group.name} decoding="async" /><span><Maximize2 size={17} />На весь экран</span></button> : <div className="variant-photo-empty"><ShoppingCart size={46} /></div>}</div>
      <div className="variant-main">
        <div className="variant-actions"><em>{group.variants.length} {variantWord(group.variants.length)}</em><label className="variant-search"><Search size={15} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Найти размер..." /></label><button className="variant-small-button" onClick={() => setValues((current) => Object.fromEntries(group.variants.map((item) => [item.id, { ...current[item.id], quantity: current[item.id].quantity + 1 }])))}>+1 всем</button><button className="variant-small-button" onClick={() => setValues((current) => Object.fromEntries(group.variants.map((item) => [item.id, { ...current[item.id], quantity: 0 }])))}>Очистить</button></div>
        <div className="variant-table"><div className="variant-head"><span>Размер</span><span>Цена, сом</span><span>Количество</span><span>Сумма, сом</span></div>{shown.map((variant) => { const value = values[variant.id]; return <div className={value.quantity > 0 ? 'variant-row active' : 'variant-row'} key={variant.id}><strong>{variant.variant_name || variant.sku || 'Без размера'}</strong><button className={`variant-price-button ${value.discountAmount || value.neighborSupply ? 'configured' : ''}`} onClick={() => setEditing(variant)} aria-label={`Цена и условия ${variant.variant_name || variant.sku || variant.name}`}>{money.format(value.unitPrice)}</button><div className="quantity-stepper"><button onClick={() => patchQuantity(variant.id, value.quantity - 1)} aria-label={`Уменьшить ${variant.variant_name}`}><Minus size={17} /></button><input aria-label={`Количество ${variant.variant_name || variant.sku || variant.name}`} type="number" min="0" value={value.quantity || ''} onChange={(event) => patchQuantity(variant.id, Number(event.target.value))} /><button onClick={() => patchQuantity(variant.id, value.quantity + 1)} aria-label={`Увеличить ${variant.variant_name}`}><Plus size={17} /></button></div><strong>{value.quantity ? money.format(lineTotal(value)) : '—'}</strong></div>; })}</div>
        <footer className="variant-footer"><div><span>{count ? `Выбрано: ${count} шт` : 'Выберите нужные количества'}</span><strong>{money.format(total)} <small>сом</small></strong></div><button className="variant-cancel" onClick={onClose}>Отмена</button><button className="variant-submit" disabled={!count && !hadSelection} onClick={() => onApply(values)}>{hadSelection ? 'Обновить' : 'Добавить в чек'}</button></footer>
      </div>
    </div></Modal>
    {editing && <PriceTermsDialog variant={editing} value={values[editing.id]} people={people} onClose={() => setEditing(null)} onSave={(value) => { setValues((current) => ({ ...current, [editing.id]: value })); setEditing(null); }} />}
    {photoOpen && group.image && <PhotoLightbox title={group.name} src={group.image} onClose={() => setPhotoOpen(false)} />}
  </>;
}

function PriceTermsDialog({ variant, value, people, onSave, onClose }: { variant: Product; value: VariantDraft; people: Party[]; onSave(value: VariantDraft): void; onClose(): void }) {
  const cache = useQueryClient();
  const [unitPrice, setUnitPrice] = useState(value.unitPrice);
  const [discountAmount, setDiscountAmount] = useState(value.discountAmount);
  const [borrowed, setBorrowed] = useState(Boolean(value.neighborSupply));
  const [createdPeople, setCreatedPeople] = useState<Party[]>([]);
  const [addingNeighbor, setAddingNeighbor] = useState(false);
  const [neighborName, setNeighborName] = useState('');
  const [neighborPhone, setNeighborPhone] = useState('');
  const neighbors = [...people, ...createdPeople];
  const [supplierId, setSupplierId] = useState(value.neighborSupply?.supplier.id ?? people[0]?.id ?? 0);
  const [neighborQuantity, setNeighborQuantity] = useState(value.neighborSupply?.quantity ?? Math.max(value.quantity, 1));
  const [neighborUnitPrice, setNeighborUnitPrice] = useState(value.neighborSupply?.unitPrice ?? Number(variant.purchase_price || 0));
  const supplier = neighbors.find((item) => item.id === supplierId);
  const createNeighbor = useMutation({
    mutationFn: () => api<Party>('/parties/', {
      method: 'POST',
      body: JSON.stringify({ name: neighborName.trim(), phone: neighborPhone.trim(), kind: 'both', is_active: true }),
    }),
    onSuccess: (person) => {
      setCreatedPeople((current) => [...current, person]);
      setSupplierId(person.id);
      setNeighborName('');
      setNeighborPhone('');
      setAddingNeighbor(false);
      void cache.invalidateQueries({ queryKey: ['pos-people'] });
      void cache.invalidateQueries({ queryKey: ['parties-list'] });
    },
  });
  const quantity = Math.max(value.quantity, borrowed ? neighborQuantity : 0);
  const saleAmount = Math.max(0, quantity * unitPrice - discountAmount);
  const debtAmount = neighborQuantity * neighborUnitPrice;
  const invalid = unitPrice < 0 || discountAmount < 0 || discountAmount > quantity * unitPrice || (borrowed && (!supplier || neighborQuantity <= 0 || neighborQuantity > quantity || neighborUnitPrice <= 0));
  return <Modal title="Цена и условия" onClose={onClose} className="price-terms-modal" backdropClassName="price-terms-backdrop">
    <div className="price-terms">
      <div className="terms-product"><span>{variant.name}</span><strong>{variant.variant_name || variant.sku || 'Без размера'}</strong></div>
      <label>Цена продажи, сом<input autoFocus type="number" min="0" step="0.01" value={unitPrice || ''} onChange={(event) => setUnitPrice(Number(event.target.value))} /></label>
      <label>Скидка, сом<input type="number" min="0" step="0.01" value={discountAmount || ''} onChange={(event) => setDiscountAmount(Number(event.target.value))} /></label>
      <label className="neighbor-check"><input type="checkbox" checked={borrowed} onChange={(event) => setBorrowed(event.target.checked)} /><span>Взяли у соседа</span></label>
      {borrowed && <div className="neighbor-fields">
        <div className="neighbor-person-row"><label>Сосед<select value={supplierId} onChange={(event) => setSupplierId(Number(event.target.value))}><option value="">Выберите человека…</option>{neighbors.map((item) => <option key={item.id} value={item.id}>{item.name}{item.phone ? ` · ${item.phone}` : ''}</option>)}</select></label><button type="button" className="button secondary compact" onClick={() => setAddingNeighbor((value) => !value)}><Plus size={15} />Добавить соседа</button></div>
        {addingNeighbor && <div className="quick-neighbor-form"><label>Имя<input autoFocus value={neighborName} onChange={(event) => setNeighborName(event.target.value)} placeholder="Имя человека" /></label><label>Телефон<input value={neighborPhone} onChange={(event) => setNeighborPhone(event.target.value)} placeholder="Номер телефона" /></label><button type="button" className="button primary compact" disabled={!neighborName.trim() || createNeighbor.isPending} onClick={() => createNeighbor.mutate()}>{createNeighbor.isPending ? 'Добавляем…' : 'Добавить'}</button>{createNeighbor.error && <div className="form-error">{validationMessage(createNeighbor.error) ?? 'Не удалось добавить человека.'}</div>}</div>}
        <div><label>Взяли, шт<input type="number" min="1" step="1" value={neighborQuantity || ''} onChange={(event) => setNeighborQuantity(Math.max(0, Math.floor(Number(event.target.value))))} /></label><label>Цена соседа за 1 шт, сом<input type="number" min="0.01" step="0.01" value={neighborUnitPrice || ''} onChange={(event) => setNeighborUnitPrice(Number(event.target.value))} /></label></div>
        <p>Будем должны соседу <strong>{money.format(debtAmount)} сом</strong></p>
        {!neighbors.length && !addingNeighbor && <span className="terms-warning">Добавьте соседа прямо здесь.</span>}
      </div>}
      <div className="terms-sale-total"><span>Сумма продажи</span><strong>{money.format(saleAmount)} сом</strong></div>
      <footer><button className="button secondary" onClick={onClose}>Отмена</button><button className="button primary" disabled={invalid} onClick={() => onSave({ quantity, unitPrice, discountAmount, ...(borrowed && supplier ? { neighborSupply: { supplier, quantity: neighborQuantity, unitPrice: neighborUnitPrice } } : {}) })}>Сохранить</button></footer>
    </div>
  </Modal>;
}

function PhotoLightbox({ title, src, onClose }: { title: string; src: string; onClose(): void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return <div className="photo-lightbox" role="dialog" aria-modal="true" aria-label={`Фотография ${title}`} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <strong>{title}</strong>
    <button onClick={onClose} aria-label="Закрыть фотографию"><X size={28} /></button>
    <img src={src} alt={title} decoding="async" />
  </div>;
}

function PartyDialog({ parties, selected, allowNone, title, onSelect, onClose }: { parties: Party[]; selected: Party | null; allowNone: boolean; title: string; onSelect(value: Party | null): void; onClose(): void }) {
  const [search, setSearch] = useState('');
  const shown = parties.filter((party) => party.name.toLowerCase().includes(search.toLowerCase()) || party.phone.includes(search));
  return <Modal title={title} onClose={onClose}><label className="catalog-search"><Search size={18} /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Имя или телефон" /></label><div className="party-picker">{allowNone && <button className={!selected ? 'active' : ''} onClick={() => onSelect(null)}><strong>Розничный покупатель</strong><span>Без персонального долга</span></button>}{shown.map((party) => <button className={selected?.id === party.id ? 'active' : ''} key={party.id} onClick={() => onSelect(party)}><strong>{party.name}</strong><span>{party.phone || party.code}</span></button>)}</div></Modal>;
}

function OrderDialog({ party, total, pending, error, onSave, onClose }: { party: Party; total: number; pending: boolean; error: unknown; onSave(note: string): void; onClose(): void }) {
  const [note, setNote] = useState('');
  return <Modal title="Сохранить заказ" onClose={onClose}><div className="payment-dialog"><span>Человек</span><strong>{party.name}</strong><span>Сумма заказа</span><strong className="payment-total">{money.format(total)} <small>сом</small></strong><label>Комментарий<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Срок, доставка, пожелания" /></label>{Boolean(error) && <div className="form-error">{validationMessage(error) ?? (error instanceof ApiError ? error.message : String(error))}</div>}<footer><button className="button secondary" onClick={onClose} disabled={pending}>Назад</button><button className="button primary" onClick={() => onSave(note)} disabled={pending}>{pending ? 'Сохраняем…' : 'Сохранить заказ'}</button></footer></div></Modal>;
}

function PaymentDialog({ total, canDebt, pending, error, onPay, onClose }: { total: number; canDebt: boolean; pending: boolean; error: unknown; onPay(amounts: PaymentAmounts): void; onClose(): void }) {
  const [cash, setCash] = useState('');
  const [mbank, setMbank] = useState('');
  const cashValue = Number(cash || 0);
  const mbankValue = Number(mbank || 0);
  const paid = Math.round((cashValue + mbankValue) * 100) / 100;
  const remainder = Math.max(0, Math.round((total - paid) * 100) / 100);
  const invalidNumbers = !Number.isFinite(cashValue) || !Number.isFinite(mbankValue) || cashValue < 0 || mbankValue < 0;
  const overpaid = paid > total + 0.001;
  const underpaidRetail = paid < total - 0.001 && !canDebt;
  const disabled = pending || invalidNumbers || overpaid || underpaidRetail;
  return <Modal title="Оплата" onClose={onClose}><div className="payment-dialog"><span>К оплате</span><strong className="payment-total">{money.format(total)} <small>сом</small></strong><div className="payment-fields"><label>Наличные<div className="payment-input"><input autoFocus type="number" min="0" step="0.01" value={cash} onChange={(event) => setCash(event.target.value)} placeholder="0" /><span>сом</span></div></label><label>МБанк<div className="payment-input"><input type="number" min="0" step="0.01" value={mbank} onChange={(event) => setMbank(event.target.value)} placeholder="0" /><span>сом</span></div></label></div><div className="payment-summary"><span>Оплачено <strong>{money.format(paid)} сом</strong></span><span>Остаток <strong>{money.format(remainder)} сом</strong></span></div>{overpaid && <div className="form-error">Оплата больше итога чека на {money.format(paid - total)} сом.</div>}{underpaidRetail && <div className="form-error">Для розничного покупателя нужна полная оплата. Не хватает {money.format(remainder)} сом.</div>}{canDebt && remainder > 0 && !overpaid && <div className="debt-message">Остаток {money.format(remainder)} сом будет записан выбранному человеку в долг.</div>}{Boolean(error) && <div className="form-error">{validationMessage(error) ?? (error instanceof ApiError ? error.message : String(error))}</div>}<footer><button className="button secondary" onClick={onClose} disabled={pending}>Назад</button><button className="button primary" onClick={() => onPay({ cash, mbank })} disabled={disabled}>{pending ? 'Проводим…' : 'Завершить'}</button></footer></div></Modal>;
}

function variantWord(count: number) { return count === 1 ? 'размер' : count > 1 && count < 5 ? 'размера' : 'размеров'; }
function unitLabel(unit: Product['unit']) { return unit === 'kg' ? 'кг' : unit === 'meter' ? 'м' : 'шт'; }
