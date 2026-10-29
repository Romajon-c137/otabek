/* Изолированный UI-прототип. Только GET каталога; учётные операции — локальные. */
(function () {
  const P = window.Prototype = {
    requested: new URLSearchParams(window.location?.search || '').get('ui') === '1',
    key: 'hozuchet-ui-prototype-v1', online: true, failNext: false, jobs: [], listeners: [],
    authenticated: true, catalogSource: 'Локальная копия', seeding: false,
  };
  const notify = () => { P.listeners.forEach((f) => f()); E.notify(); };
  P.day = (iso = E.now()) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bishkek', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
    return ['year', 'month', 'day'].map((key) => parts.find((p) => p.type === key).value).join('-');
  };
  P.inPeriod = (iso, from, to = from) => !!iso && (!from || P.day(iso) >= from) && (!to || P.day(iso) <= to);
  P.summary = (from = P.day(), to = from) => {
    const sales = E.S.sales.filter((s) => s.status === 'posted' && P.inPeriod(s.postedAt, from, to));
    const returns = E.S.returns.filter((r) => r.status === 'posted' && P.inPeriod(r.postedAt, from, to));
    const payments = E.S.payments.filter((p) => p.status === 'posted' && P.inPeriod(p.postedAt || p.at, from, to));
    const sum = (xs, fn) => U.r2(xs.reduce((n, x) => n + fn(x), 0));
    return {
      count: sales.length, sales: sum(sales, (s) => s.total), returns: sum(returns, (r) => r.amount),
      revenue: U.r2(sum(sales, (s) => s.total) - sum(returns, (r) => r.amount)),
      received: sum(payments.filter((p) => p.dir === 'in'), (p) => p.amount),
      paidOut: sum(payments.filter((p) => p.dir === 'out'), (p) => p.amount),
      givenDebt: sum(sales, (s) => Math.max(0, s.total - s.paid)),
      receivable: sum(E.S.cps, (c) => E.balance(c.id).recv), payable: sum(E.S.cps, (c) => E.balance(c.id).pay),
    };
  };
  P.saleDebt = (sale) => U.r2(E.S.debts.filter((d) => !d.cancelled && d.ref?.t === 'sale' && d.ref.id === sale.id).reduce((n, d) => n + E.debtRem(d), 0));
  P.drafts = () => E.S.sales.filter((s) => s.status === 'draft' && s.lines.length).sort((a, b) => b.at.localeCompare(a.at));
  P.store = () => {
    E.save();
    try { localStorage.setItem(P.key + '-transport', JSON.stringify({ jobs: P.jobs, online: P.online, authenticated: P.authenticated })); } catch (e) { /* isolated preview */ }
  };
  P.deliver = (job) => {
    if (!P.online) job.state = 'pending';
    else {
      job.attempts++;
      if (P.failNext) { P.failNext = false; job.state = 'error'; job.error = 'Тестовая ошибка отправки. Операция сохранена.'; }
      else { job.state = 'sent'; job.error = ''; }
    }
    const d = E.doc(job.ref);
    if (d) d.pending = P.jobs.some((j) => j.ref.t === job.ref.t && j.ref.id === job.ref.id && ['pending', 'error'].includes(j.state));
  };
  P.track = (kind, ref) => {
    if (P.seeding) return;
    const d = E.doc(ref);
    const job = { id: `${kind}:${ref.t}:${ref.id}`, kind, ref: { ...ref }, title: `${E.TITLE[ref.t]} ${d?.no || ''}`, state: 'pending', attempts: 0, at: E.now(), error: '' };
    if (P.jobs.some((x) => x.id === job.id)) return;
    P.jobs.push(job); P.deliver(job);
    P.store(); notify();
  };
  P.retry = (id) => {
    if (!P.online) throw new E.AccErr('Сначала восстановите связь');
    const job = P.jobs.find((x) => x.id === id);
    if (!job || job.state === 'sent' || job.state === 'cancelled') return;
    P.deliver(job); P.store(); notify();
  };
  P.setOnline = (online) => {
    P.online = online;
    if (online) P.jobs.filter((j) => j.state === 'pending').forEach(P.deliver);
    P.store(); notify();
  };
  P.fixPendingSale = (id) => {
    const sale = E.doc({ t: 'sale', id });
    if (!sale?.pending || !['pending', 'error'].includes(P.jobs.find((j) => j.kind === 'sale' && j.ref.id === id)?.state)) throw new E.AccErr('Операция уже отправлена');
    const draft = E.tx(() => { P.originalCancel(id); return E.copyDoc(E.ref(sale),{neighbor:true}); });
    P.jobs.filter((j) => j.ref.t === 'sale' && j.ref.id === id && j.state !== 'sent').forEach((j) => { j.state = 'cancelled'; });
    sale.pending = false; P.store(); notify();
    return draft;
  };
  P.recordDebt = (cp, dir, amount, comment) => E.newDebtNote({ cp, dir, amount, comment });
  P.cancelFinancial = (ref, reason) => {
    const d = E.doc(ref);
    if (!reason?.trim()) throw new E.AccErr('Укажите причину');
    if (!d || d.status !== 'posted' || !['pay', 'debt', 'off'].includes(ref.t)) throw new E.AccErr('Операция уже отменена или недоступна');
    if (ref.t === 'pay' && d.src) throw new E.AccErr('Эта оплата связана с документом. Исправьте исходный чек.');
    if (ref.t === 'debt' && d.sourceSaleId) throw new E.AccErr('Долг соседу связан с продажей. Исправьте исходный чек.');
    const debts = E.S.debts.filter((x) => !x.cancelled && x.ref.t === ref.t && x.ref.id === ref.id);
    if (debts.some((x) => E.allocsOf(x.id).length)) throw new E.AccErr('Долг уже погашали. Сначала отмените связанные оплаты или взаимозачёт.');
    E.tx(() => {
      E.S.allocs.filter((a) => a.ref.t === ref.t && a.ref.id === ref.id).forEach((a) => { a.cancelled = true; });
      debts.forEach((x) => { x.cancelled = true; });
      d.status = 'cancelled'; d.cancelReason = reason.trim(); d.cancelledAt = E.now();
    });
    P.jobs.filter((j) => j.ref.t === ref.t && j.ref.id === ref.id && j.state !== 'sent').forEach((j) => { j.state = 'cancelled'; });
    P.track('cancel', ref);
  };
  P.correctSale = (id, reason) => {
    const sale = E.doc({ t: 'sale', id });
    if (!reason?.trim()) throw new E.AccErr('Укажите причину');
    const draft = E.tx(() => { P.originalCancel(id); sale.cancelReason = reason.trim(); return E.copyDoc(E.ref(sale),{neighbor:true}); });
    P.jobs.filter((j) => j.ref.t === 'sale' && j.ref.id === id && j.state !== 'sent').forEach((j) => { j.state = 'cancelled'; });
    P.track('cancel', E.ref(sale));
    return draft;
  };
  P.orderStage = (o) => o.status === 'cancelled' ? 'cancelled' : o.status === 'done' ? 'done' : E.ORDER_ACTIVE.includes(o.status) ? (o.shipped ? 'shipped' : 'working') : 'new';
  P.orderStages = [{ k: 'new', t: 'Новые' }, { k: 'working', t: 'В работе' }, { k: 'shipped', t: 'Отправлены' }, { k: 'done', t: 'Завершены' }];
  P.moveOrder = (o, stage) => {
    if (o.status === 'cancelled' || o.status === 'done') throw new E.AccErr('Заказ уже завершён или отменён');
    if (stage === P.orderStage(o)) return;
    if (stage === 'new') { if (o.status !== 'draft') E.setOrderStatus(o.id, 'draft'); }
    else {
      if (o.status === 'draft') E.setOrderStatus(o.id, 'assembling');
      if (stage === 'done') return E.saleFromOrder(o.id);
      E.setShipped(o.id, stage === 'shipped');
    }
    o.updatedRevision = (o.updatedRevision || 0) + 1;
    P.track('order-' + stage + '-' + o.updatedRevision, E.ref(o));
    E.changed();
  };
  P.settle = (cp, dir, amount, method = 'cash', comment = '') => {
    if (!U.isNum(amount) || amount <= 0) throw new E.AccErr('Укажите положительную сумму');
    const debts = E.openDebts(cp, dir), total = U.r2(debts.reduce((n, d) => n + E.debtRem(d), 0));
    if (amount > total + .0001) throw new E.AccErr('Сумма больше долга');
    let left = amount;
    const rows = debts.map((d) => { const money = U.r2(Math.min(left, E.debtRem(d))); left = U.r2(left - money); return { debtId: d.id, goods: 0, money }; });
    return E.postSettlement(cp, dir, rows, amount, comment, { method });
  };
  P.login = (login, password) => {
    if (login !== 'demo' || password !== 'demo') throw new E.AccErr('Неверный логин или пароль');
    P.authenticated = true; P.store(); notify();
  };
  P.logout = () => { P.authenticated = false; P.store(); notify(); };

  async function cachedCatalog() {
    if (!window.indexedDB || !indexedDB.databases) return [];
    try {
      if (!(await indexedDB.databases()).some((d) => d.name === 'hozuchet')) return [];
      return await new Promise((resolve) => {
        const req = indexedDB.open('hozuchet');
        req.onerror = () => resolve([]);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('kv')) { db.close(); resolve([]); return; }
          const get = db.transaction('kv', 'readonly').objectStore('kv').get('state');
          get.onsuccess = () => { try { resolve(JSON.parse(get.result || '{}').products || []); } catch (e) { resolve([]); } db.close(); };
          get.onerror = () => { db.close(); resolve([]); };
        };
      });
    } catch (e) { return []; }
  }
  P.refreshCatalog = async () => {
    let cfg;
    try { cfg = JSON.parse(localStorage.getItem('hoz_server') || 'null'); } catch (e) { /* no config */ }
    if (!cfg?.url || !cfg.token) throw new E.AccErr('Нет сохранённого подключения к каталогу. Текущий каталог оставлен без изменений.');
    const products = new Map();
    for (let page = 1; page <= 100; page++) {
      const response = await fetch(cfg.url.replace(/\/+$/, '') + `/api/v1/products/?page_size=1000&page=${page}`, {
        method: 'GET', headers: { Authorization: 'Token ' + cfg.token }, signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new E.AccErr('Не удалось обновить каталог. Текущие данные сохранены.');
      const data = await response.json(), rows = Array.isArray(data) ? data : data.results;
      if (!Array.isArray(rows)) throw new E.AccErr('Неизвестный формат каталога');
      rows.forEach((p) => products.set(p.id, {
        id: p.id, code: p.code, name: p.name, variantName: p.variant_name || '', category: p.category_name || '',
        unit: { pcs: 'шт', kg: 'кг', m: 'м' }[p.unit] || p.unit, photo: p.display_photo || p.external_image_url || p.photo || '',
        active: p.active, externalProductId: p.external_product_id, externalSizeId: p.external_size_id,
        purchasePrice: 0, retailPrice: Number(p.retail_price), wholesalePrice: Number(p.wholesale_price),
      }));
      if (Array.isArray(data) || !data.next) break;
      if (page === 100) throw new E.AccErr('Каталог слишком большой: обновление не применено');
    }
    if (!products.size) throw new E.AccErr('Пустой каталог: текущие товары сохранены');
    // Исторические товары не удаляются: старые документы должны оставаться читаемыми.
    const missing = E.S.products.filter((p) => !products.has(p.id)).map((p) => ({ ...p, active: false }));
    E.S.products = [...products.values(), ...missing];
    P.catalogSource = 'Каталог API'; E.changed();
    return products.size;
  };
  P.reset = (catalog = E.S?.products || Seed.catalog(), { seed = true } = {}) => {
    P.seeding = true;
    try {
      E.S = E.blank(); E.S.user = 'Тестовый продавец'; E.S.products = U.clone(catalog); P.jobs = []; P.online = true; P.failNext = false;
      E.saveCp({ name: 'Покупатель «Пример»', phone: '+996 000 000001', note: 'Тестовые данные' });
      E.saveCp({ name: 'Магазин «Пример»', phone: '+996 000 000002', note: 'Тестовые данные' });
      E.saveCp({ name: 'Поставщик «Пример»', phone: '+996 000 000003', note: 'Тестовые данные' });
      if (seed && E.S.products.length) {
        const groups = E.productGroups(E.S.products.filter((p) => p.active)), products = groups[0]?.products || [];
        if (products.length) {
          const makeSale = (cp, fraction, method = 'cash') => {
            const sale = E.newSale({ cp, lines: products.slice(0, 2).map((p) => ({ ...E.lineFromProduct(p), qty: 2 })) });
            const total = E.calcLines(sale).total; sale.paid = U.r2(total * fraction); sale.payMethods = sale.paid ? { [method]: sale.paid } : {};
            E.postSale(sale.id); return sale;
          };
          makeSale(null, 1);
          makeSale(E.S.cps[0].id, .5, 'mbank');
          makeSale(E.S.cps[1].id, 0);
          E.newDebtNote({ cp: E.S.cps[2].id, dir: 'pay', amount: 3500, comment: 'Тестовый долг поставщику' });
          const order = E.newOrder({ cp: E.S.cps[1].id, lines: products.slice(0, 2).map((p) => ({ ...E.lineFromProduct(p), qty: 3 })), comment: 'Тестовый заказ' });
          E.orderSaved(order.id);
        }
      }
    } finally { P.seeding = false; E._time = null; }
    P.store(); notify();
  };
  P.init = async ({ catalog, seed = true } = {}) => {
    E.prototypeMode = true; E.inventoryEnabled = false; E.storageKey = P.key;
    if (!P.wrapped) {
      P.wrapped = true;
      for (const [name, kind, type] of [['postSale', 'sale', 'sale'], ['postReturn', 'return', 'ret'], ['newDebtNote', 'debt', 'debt']]) {
        const original = E[name];
        E[name] = (...args) => { const result = original(...args); const d = name === 'newDebtNote' ? result : E.doc({ t: type, id: args[0] }); P.track(kind, E.ref(d)); return result; };
      }
      P.originalCancel = E.cancelSale;
      E.cancelSale = (id) => { const result = P.originalCancel(id); P.jobs.filter((j) => j.ref.t === 'sale' && j.ref.id === id && j.state !== 'sent').forEach((j) => { j.state = 'cancelled'; }); P.track('cancel', { t: 'sale', id }); return result; };
      const offset = E.applyOffset;
      E.applyOffset = (cp) => { const d = offset(cp); if (d) P.track('offset', E.ref(d)); return d; };
      const settlement = E.postSettlement;
      E.postSettlement = (...args) => { const refs = settlement(...args); refs.forEach((ref) => P.track('payment', ref)); return refs; };
      E.orderSaved = (id) => { const o = E.doc({ t: 'order', id }); if (o) { P.track('order-save-' + (o.updatedRevision || 0), E.ref(o)); } };
      E.reset = () => P.reset();
    }
    let state;
    try { state = JSON.parse(localStorage.getItem(P.key) || 'null'); const saved = JSON.parse(localStorage.getItem(P.key + '-transport') || '{}'); P.jobs = saved.jobs || []; P.online = saved.online !== false; P.authenticated = saved.authenticated !== false; } catch (e) { /* fresh preview */ }
    if (state?.products?.length && !catalog) E.S = E.normalizeProducts({ ...E.blank(), ...state });
    else {
      const cached = catalog || await cachedCatalog();
      P.catalogSource = cached.length ? 'Копия реального каталога' : 'Демонстрационный каталог';
      P.reset(cached.length ? cached : Seed.catalog(), { seed });
    }
  };
})();
