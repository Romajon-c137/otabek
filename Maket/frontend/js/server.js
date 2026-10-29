/* Режим сервера: касса работает мгновенно на локальной копии, а действия отправляются на сервер.
 *
 * Принцип:
 *  - правда хранится на сервере (Django + PostgreSQL); локально лежит его копия (E.S) и очередь отправки;
 *  - действие сначала выполняется локально (движок E, как в демо) и тут же ставится в очередь;
 *  - очередь уходит на сервер по порядку, повтор безопасен (идентификаторы и Idempotency-Key от клиента);
 *  - лента изменений /sync/changes сообщает, что появилось у других пользователей;
 *  - когда очередь пуста, локальная копия обновляется данными сервера. */
(function () {
  const { html, useState, useEffect } = window.htmPreact;
  const S = (window.Server = {
    available: false, on: false, online: true, cursor: 0, queue: [], failed: [], cfg: null, retailId: null,
    warehouse: null, listeners: [],
  });
  const CFG_KEY = 'hoz_server';
  const UNIT = { pcs: 'шт', kg: 'кг', m: 'м' };
  const UNIT_BACK = { 'шт': 'pcs', 'кг': 'kg', 'м': 'm' };
  const num = (v) => (v == null || v === '' ? 0 : Number(v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); }));
  const notify = () => S.listeners.forEach((f) => f());

  /* ---------- хранилище (IndexedDB): копия данных, очередь, курсор ---------- */
  const idb = {
    db: null,
    open() {
      if (this.db) return this.db;
      this.db = new Promise((resolve, reject) => {
        const r = indexedDB.open('hozuchet', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      return this.db;
    },
    async get(key) { const db = await this.open(); return new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(key); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); },
    async set(key, val) { const db = await this.open(); return new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(val, key); t.oncomplete = () => res(); t.onerror = () => res(); }); },
  };
  // очередь и ошибки пишутся сразу (это несохранённые действия), копия данных — с задержкой (её можно перезагрузить с сервера)
  let saveTimer = null;
  const persist = () => {
    idb.set('queue', JSON.stringify(S.queue)); idb.set('failed', JSON.stringify(S.failed)); idb.set('cursor', S.cursor);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => idb.set('state', JSON.stringify(E.S)), 250);
  };
  window.addEventListener('beforeunload', () => { if (S.available && E.S) { clearTimeout(saveTimer); idb.set('state', JSON.stringify(E.S)); } });

  /* ---------- HTTP ---------- */
  class ApiError extends Error {
    constructor(status, data, network, message) { super(message); this.status = status; this.data = data; this.network = !!network; }
  }
  S.ApiError = ApiError;
  function flatten(d) {
    if (d == null) return '';
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) return d.map(flatten).filter(Boolean).join('; ');
    if (typeof d === 'object') return Object.keys(d).filter((k) => k !== 'request_id' && k !== 'code').map((k) => { const v = flatten(d[k]); return ['detail', 'non_field_errors'].includes(k) ? v : `${k}: ${v}`; }).filter(Boolean).join('; ');
    return String(d);
  }
  const errText = (data, status) => {
    if (data && data.code === 'INSUFFICIENT_STOCK' && data.available != null) return `Не хватает товара: доступно ${data.available}, нужно ${data.requested}`;
    return flatten(data) || `Ошибка сервера (${status})`;
  };
  async function api(method, path, body, opts = {}) {
    const headers = opts.form ? {} : { 'Content-Type': 'application/json' };
    if (S.cfg && S.cfg.token && !opts.anon) headers.Authorization = 'Token ' + S.cfg.token;
    if (opts.key) headers['Idempotency-Key'] = opts.key;
    let res;
    try {
      res = await fetch(S.cfg.url + '/api/v1' + path, { method, headers, body: body == null ? undefined : opts.form ? body : JSON.stringify(body), signal: AbortSignal.timeout(opts.timeout || 20000) });
    } catch (e) { throw new ApiError(0, null, true, 'Нет связи с сервером'); }
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch (e) { data = { detail: text.slice(0, 200) }; } }
    if (res.status === 401 && !opts.anon) { S.authLost(); throw new ApiError(401, data, false, 'Нужно войти заново'); }
    if (!res.ok) throw new ApiError(res.status, data, false, errText(data, res.status));
    return data;
  }
  S.api = api;
  async function listAll(path, { max = 20000 } = {}) {
    const out = [];
    let url = path + (path.includes('?') ? '&' : '?') + 'page_size=1000';
    for (let page = 1; out.length < max; page++) {
      const d = await api('GET', `${url}&page=${page}`);
      if (Array.isArray(d)) return d;
      out.push(...(d.results || []));
      if (!d.next) break;
    }
    return out;
  }
  const firstPage = async (path, size) => {
    const d = await api('GET', `${path}${path.includes('?') ? '&' : '?'}page_size=${size}`);
    return Array.isArray(d) ? d : d.results || [];
  };

  /* ---------- вход ---------- */
  const normUrl = (u) => String(u || '').trim().replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  S.saveCfgValue = (c) => { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (e) { /* ignore */ } };
  S.saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(S.cfg)); } catch (e) { /* ignore */ } };
  S.authLost = () => { if (S.cfg) { S.cfg.token = ''; S.saveCfg(); } S.on = false; S.ready = false; notify(); };
  S.login = async (url, username, password) => {
    S.cfg = { url: normUrl(url), token: '', username };
    const r = await api('POST', '/auth/token/', { username, password }, { anon: true });
    S.cfg.token = r.token; S.saveCfg();
    await S.start();
  };
  S.logout = async () => {
    try { await api('POST', '/auth/logout/', {}); } catch (e) { /* уже не авторизованы */ }
    S.authLost();
  };

  /* ---------- проекция данных сервера в модель движка ---------- */
  const STATE_MAP = { draft: 'draft', reserved: 'assembling', assembled: 'assembled', shipped: 'assembled', completed: 'done', cancelled: 'cancelled' };
  const TYPE_MAP = { sale: 'sale', receipt: 'receipt', order: 'order', buyer_return: 'ret', supplier_return: 'sret', payment: 'pay', offset: 'off', opening_stock: 'imp', opening_debt: 'imp' };
  const breakdownMap = (list) => { const m = {}; (list || []).forEach((b) => { m[b.method] = num(b.amount); }); return m; };

  function project(raw, old) {
    const st = E.blank();
    st.user = S.cfg.username;
    st.seq = old && old.seq ? old.seq : st.seq;
    const cpOf = (id) => (!id || id === S.retailId ? null : id);
    st.products = raw.products.map((p) => ({
      id: p.id, code: p.code, importCode: p.code, name: p.name, category: p.category_name || '', unit: UNIT[p.unit] || p.unit,
      purchasePrice: num(p.purchase_price), wholesalePrice: num(p.wholesale_price), retailPrice: num(p.retail_price),
      photo: p.display_photo || p.external_image_url || p.photo || '', active: p.active,
      variantName: p.variant_name || '', externalProductId: p.external_product_id, externalSizeId: p.external_size_id,
    }));
    st.cps = raw.cps.filter((c) => c.system_key !== 'retail-customer').map((c) => ({ id: c.id, code: c.code, importCode: c.code, name: c.name, phone: c.phone || '', note: c.note || '', active: c.active }));
    st.lots = raw.stock.map((r, i) => {
      const q = num(r.quantity), cost = num(r.cost);
      return { id: 'stk-' + r.product_id, seq: i + 1, pid: r.product_id, ref: null, li: 0, cp: null, source: 'initial', at: raw.at, qtyInitial: q, qtyLeft: q, purchasePrice: 0, purchaseCost: cost, extraCost: 0, cost, costLeft: cost, unitCost: q ? cost / q : 0, cancelled: false };
    });
    const docLines = (lines) => lines.map((l) => ({ pid: l.product, qty: num(l.quantity), price: num(l.price), dType: 'сум', dVal: num(l.discount) }));
    const head = (d, t) => ({ id: d.id, no: d.number, t, at: d.created_at, author: d.author, version: d.version, synced: true, cp: cpOf(d.counterparty), comment: d.reason || '' });
    st.sales = raw.sales.filter((d) => d.status !== 'draft').map((d) => {
      const lines = d.lines.map((l) => ({ sid: l.id, pid: l.product, qty: num(l.quantity), price: num(l.price), dType: 'сум', dVal: num(l.discount), amount: num(l.amount), disc: num(l.discount), gross: num(l.quantity) * num(l.price), cogs: num(l.cost), wo: [] }));
      const total = lines.reduce((a, l) => a + l.amount, 0);
      const paid = num(d.paid);
      return { ...head(d, 'sale'), status: d.status === 'reversed' ? 'cancelled' : 'posted', postedAt: d.posted_at || d.created_at, postedBy: d.author, lines, dType: '%', dVal: 0, total: U.r2(total), gross: U.r2(lines.reduce((a, l) => a + l.gross, 0)), disc: U.r2(lines.reduce((a, l) => a + l.disc, 0)), paid, payMethods: breakdownMap(d.payment_breakdown), transfer: paid === 0 && !!cpOf(d.counterparty) && total > 0, priceType: 'retail', orderId: null };
    });
    st.receipts = raw.receipts.filter((d) => d.status !== 'draft').map((d) => {
      const lines = d.lines.map((l) => ({ sid: l.id, pid: l.product, qty: num(l.quantity), price: num(l.price), wholesale: l.wholesale_price == null ? null : num(l.wholesale_price), retail: l.retail_price == null ? null : num(l.retail_price), amount: num(l.goods_amount), extra: num(l.allocated_extra_cost), cost: num(l.total_cost) }));
      return { ...head(d, 'receipt'), status: d.status === 'reversed' ? 'cancelled' : 'posted', postedAt: d.posted_at || d.created_at, postedBy: d.author, lines, extras: (d.extra_costs || []).map((x) => ({ name: x.name, amount: num(x.amount) })), goods: U.r2(lines.reduce((a, l) => a + l.amount, 0)), paid: num(d.paid), payMethods: breakdownMap(d.payment_breakdown), source: 'supplier' };
    });
    const saleById = {};
    st.sales.forEach((x) => { saleById[x.id] = x; });
    st.returns = (raw.returns || []).filter((d) => d.status !== 'draft' && saleById[d.source_sale]).map((d) => {
      const sale = saleById[d.source_sale];
      const lines = d.lines.map((l) => ({ li: sale.lines.findIndex((z) => z.sid === l.source_line), qty: num(l.quantity), amount: num(l.amount), cogs: num(l.cost), pid: l.product }));
      return { ...head(d, 'ret'), saleId: d.source_sale, status: 'posted', postedAt: d.posted_at || d.created_at, postedBy: d.author, lines, amount: U.r2(lines.reduce((a, l) => a + l.amount, 0)), refundNow: num(d.paid), payMethods: breakdownMap(d.payment_breakdown) };
    });
    st.sreturns = (raw.sreturns || []).filter((d) => d.status !== 'draft').map((d) => ({ ...head(d, 'sret'), status: 'posted', postedAt: d.posted_at || d.created_at, postedBy: d.author, receiptId: d.source_receipt, lines: d.lines.map((l) => ({ pid: l.product, qty: num(l.quantity), amount: num(l.amount) })), amount: U.r2(d.lines.reduce((a, l) => a + num(l.amount), 0)) }));
    st.orders = raw.orders.map((d) => ({ ...head(d, 'order'), status: STATE_MAP[d.state] || 'draft', shipped: d.state === 'shipped', lines: docLines(d.lines), dType: '%', dVal: 0, saleId: d.completed_sale || null, serverState: d.state }));
    st.payments = raw.payments.filter((p) => p.status === 'posted').map((p) => {
      const m = breakdownMap(p.breakdown);
      return { id: p.id, no: p.number, t: 'pay', at: p.posted_at || p.created_at, postedAt: p.posted_at || p.created_at, author: p.author, status: 'posted', cp: cpOf(p.counterparty), dir: p.direction === 'incoming' ? 'in' : 'out', amount: num(p.amount), src: p.source_document ? { t: TYPE_MAP[p.source_type] || 'sale', id: p.source_document } : null, method: Object.keys(m).length === 1 ? Object.keys(m)[0] : '', methods: m, comment: p.reason || '' };
    });
    raw.obligations.forEach((o, i) => {
      const d = { id: o.id, seq: i + 1, at: o.created_at, cancelled: false, li: null, pid: null, qty: null, price: null, note: o.source_number, cp: cpOf(o.counterparty), dir: o.side === 'receivable' ? 'recv' : 'pay', ref: { t: TYPE_MAP[o.source_type] || 'sale', id: o.source_document }, amount: num(o.original_amount) };
      st.debts.push(d);
      const paid = U.r2(num(o.original_amount) - num(o.open_amount));
      if (paid > 0) st.allocs.push({ id: 'a' + i, debtId: d.id, kind: 'pay', amount: paid, qty: null, ref: { t: 'pay', id: 'srv' }, at: o.created_at, cancelled: false });
    });
    // что не успело уйти на сервер, сохраняем: черновики и документы в очереди
    if (old) {
      const keepDocs = (coll, serverList) => {
        const ids = new Set(serverList.map((d) => d.id));
        (old[coll] || []).forEach((d) => { if (!ids.has(d.id) && (d.status === 'draft' || d.pending)) serverList.push(d); });
      };
      keepDocs('sales', st.sales); keepDocs('receipts', st.receipts); keepDocs('orders', st.orders);
    }
    return st;
  }

  /* ---------- загрузка снимка ---------- */
  S.pullNow = async () => {
    if (S.pulling || !S.on) return;
    S.pulling = true;
    try {
      const at = new Date().toISOString();
      const [products, cps, stock, obligations, sales, receipts, orders, payments, returns, sreturns] = await Promise.all([
        listAll('/products/'), listAll('/counterparties/'), api('GET', '/reports/stock/').then((d) => d.results),
        api('GET', '/settlements/obligations/').then((d) => d.results), listAll('/sales/?status=posted'), listAll('/receipts/?status=posted'),
        listAll('/orders/'), listAll('/payments/?status=posted'),
        listAll('/buyer-returns/?status=posted'), listAll('/supplier-returns/?status=posted'),
      ]);
      const retail = cps.find((c) => c.system_key === 'retail-customer');
      S.retailId = retail ? retail.id : null;
      if (S.retailId && S.cfg.retailId !== S.retailId) { S.cfg.retailId = S.retailId; S.saveCfg(); }
      const raw = { at, products, cps, stock, obligations, sales, receipts, orders, payments, returns, sreturns };
      if (S.queue.length) return; // за время загрузки появились новые действия: данные устарели
      E.S = project(raw, E.S);
      S.lastPull = Date.now(); S.online = true;
      E.changed();
    } catch (e) {
      if (e.network) S.online = false;
      else if (e.status !== 401) console.error('pull', e);
    } finally { S.pulling = false; notify(); }
  };
  let pullTimer = null;
  S.schedulePull = (delay = 300) => { clearTimeout(pullTimer); pullTimer = setTimeout(() => { if (!S.queue.length) S.pullNow(); }, delay); };
  S.syncOtabek = async () => {
    const result = await api('POST', '/products/sync-otabek/', {});
    await S.pullNow();
    return result;
  };

  /* ---------- очередь отправки ---------- */
  const methodsOf = (m) => Object.keys(m || {}).filter((k) => num(m[k]) > 0).map((k) => ({ method: k, amount: num(m[k]).toFixed(2) }));
  S.enqueue = (op) => {
    S.queue.push({ id: uuid(), key: uuid(), tries: 0, at: new Date().toISOString(), ...op });
    persist(); notify(); S.kick();
  };
  // без человека — служебный «розничный покупатель»; пока он неизвестен (запуск без связи), действие ждёт в очереди
  const serverCp = (cp) => { if (cp || S.retailId) return cp || S.retailId; throw new ApiError(0, null, true, 'Ждём загрузки данных с сервера'); };
  const pendingFlag = (t, id, v) => { const d = E.doc({ t, id }); if (d) { d.pending = v; } };

  /* Создание с идентификатором клиента. Повтор после потерянного ответа безопасен: сервер отвечает ошибкой поля id
   * («уже создан»), и тогда берём существующий объект (или обновляем его, если передан patch). */
  async function createOnce(path, body, patch) {
    try { return await api('POST', path, body); } catch (e) {
      if (!(e.status === 400 && e.data && e.data.id)) throw e;
      const url = `${path}${body.id}/`;
      if (!patch) return api('GET', url);
      if (typeof patch !== 'function') return api('PATCH', url, patch);
      const existing = await api('GET', url);
      const change = patch(existing); // функция решает по текущему состоянию, что обновить (null — ничего)
      return change ? api('PATCH', url, change) : existing;
    }
  }
  const lineBody = (lines) => lines.map((l) => ({ product: l.pid, quantity: String(l.qty), price: String(l.price), discount: String(l.discount != null ? l.discount : 0) }));

  const OPS = {
    async sale(op) {
      const p = op.payload;
      const doc = await createOnce('/sales/', { id: p.id, counterparty: serverCp(p.cp), warehouse: S.warehouse, reason: p.comment || '', lines: lineBody(p.lines) });
      if (doc.status === 'posted') return;
      await api('POST', `/sales/${p.id}/post-with-payment/`, { version: doc.version, breakdown: p.breakdown }, { key: op.key });
    },
    async order_sale(op) {
      const p = op.payload;
      const o = await api('GET', `/orders/${p.orderId}/`);
      if (o.state === 'completed') return;
      await api('POST', `/orders/${p.orderId}/sale/`, { version: o.version, breakdown: p.breakdown }, { key: op.key });
    },
    async receipt(op) {
      const p = op.payload;
      const doc = await createOnce('/receipts/', { id: p.id, counterparty: serverCp(p.cp), warehouse: S.warehouse, reason: p.comment || '', lines: p.lines.map((l) => ({ product: l.pid, quantity: String(l.qty), price: String(l.price), wholesale_price: U.isNum(l.wholesale) ? String(l.wholesale) : null, retail_price: U.isNum(l.retail) ? String(l.retail) : null })), extra_costs: (p.extras || []).map((x) => ({ name: x.name, amount: String(x.amount) })) });
      if (doc.status === 'posted') return;
      await api('POST', `/receipts/${p.id}/post-with-payment/`, { version: doc.version, breakdown: p.breakdown }, { key: op.key });
    },
    async order_save(op) {
      const p = op.payload;
      const fields = { counterparty: serverCp(p.cp), reason: p.comment || '', lines: lineBody(p.lines) };
      // заказ уже был на сервере: черновик обновляем целиком (состав, человек, комментарий)
      await createOnce('/orders/', { id: p.id, warehouse: S.warehouse, ...fields }, (o) => (o.state === 'draft' ? { version: o.version, ...fields } : null));
    },
    async order_status(op) {
      const p = op.payload;
      const o = await api('GET', `/orders/${p.orderId}/`);
      const target = { reserve: ['reserved'], release: ['draft'], cancel: ['cancelled'], ship: ['shipped'], unship: ['assembled'], assembled: ['assembled'] }[p.action];
      if (target.includes(o.state)) return;
      await api('POST', `/orders/${p.orderId}/${p.action}/`, { version: o.version }, { key: op.key });
    },
    async order_delete(op) {
      try { await api('DELETE', `/orders/${op.payload.orderId}/`); } catch (e) { if (e.status !== 404) throw e; }
    },
    async debt_payment(op) {
      const p = op.payload;
      const amount = p.breakdown.reduce((a, b) => a + num(b.amount), 0).toFixed(2);
      const pay = await createOnce('/payments/', { id: p.id, counterparty: serverCp(p.cp), direction: p.dir === 'recv' ? 'incoming' : 'outgoing', amount, reason: p.comment || '', breakdown: p.breakdown });
      if (pay.status === 'posted') return;
      const obligations = (await api('GET', '/settlements/obligations/')).results;
      const allocations = p.rows.map((r) => {
        const ob = obligations.find((o) => o.source_document === r.docId && o.counterparty === serverCp(p.cp));
        if (!ob) throw new ApiError(422, null, false, 'Долг по документу не найден на сервере: он уже погашен или не отправлен');
        return { obligation: ob.id, amount: r.amount.toFixed(2) };
      });
      await api('POST', `/payments/${p.id}/post/`, { version: pay.version, allocations }, { key: op.key });
    },
    async product_save(op) {
      const p = op.payload;
      let category = null;
      if (p.category) {
        const cats = await api('GET', '/categories/');
        let c = cats.find((x) => x.name.toLowerCase() === p.category.toLowerCase());
        if (!c) c = await api('POST', '/categories/', { name: p.category });
        category = c.id;
      }
      const fields = { name: p.name, unit: UNIT_BACK[p.unit] || p.unit, category, purchase_price: String(p.purchasePrice), retail_price: String(p.retailPrice), wholesale_price: String(p.wholesalePrice), active: p.active };
      await createOnce('/products/', { id: p.id, ...fields }, fields);
      if (p.photo && p.photo.startsWith('data:')) {
        const blob = await (await fetch(p.photo)).blob();
        const form = new FormData();
        form.append('photo', blob, 'photo.jpg');
        await api('PATCH', `/products/${p.id}/`, form, { form: true });
      } else if (p.photo === '' && p.photoCleared) {
        await api('PATCH', `/products/${p.id}/`, { photo: null });
      }
    },
    async opening_stock(op) {
      const p = op.payload;
      const doc = await createOnce('/opening-stocks/', { id: p.id, warehouse: S.warehouse, reason: 'Начальный остаток', lines: [{ product: p.pid, quantity: String(p.qty), unit_cost: String(p.unitCost) }] });
      if (doc.status === 'posted') return;
      await api('POST', `/opening-stocks/${p.id}/post/`, { version: doc.version }, { key: op.key });
    },
    async buyer_return(op) {
      const p = op.payload;
      const doc = await createOnce('/buyer-returns/', { id: p.id, source_sale: p.saleId, warehouse: S.warehouse, reason: p.comment || 'Возврат покупателя', lines: p.lines.map((l) => ({ source_line: l.saleLineId, quantity: String(l.qty) })) });
      if (doc.status === 'posted') return;
      await api('POST', `/buyer-returns/${p.id}/post-with-refund/`, { version: doc.version, breakdown: p.breakdown }, { key: op.key });
    },
    async cp_save(op) {
      const c = op.payload;
      const fields = { name: c.name, phone: c.phone || '', note: c.note || '' };
      await createOnce('/counterparties/', { id: c.id, ...fields }, fields);
    },
  };

  const transient = (e) => e.network || e.status >= 500 || e.status === 408 || e.status === 429;
  S.kick = async () => {
    if (S.running || !S.on || !S.warehouse) return; // без склада отправлять нельзя: ждём запуска на сервере
    S.running = true;
    let backoff = 2000;
    try {
      while (S.queue.length && S.on) {
        const op = S.queue[0];
        try {
          await OPS[op.kind](op);
          S.queue.shift(); S.online = true; backoff = 2000;
          if (op.docType) pendingFlag(op.docType, op.docId, false);
          persist(); notify();
        } catch (e) {
          if (e.status === 401) break;
          if (transient(e)) {
            S.online = false; op.tries++; persist(); notify();
            await sleep(Math.min(backoff, 15000)); backoff *= 1.7;
            continue;
          }
          S.queue.shift();
          S.failed.push({ op, error: e.message, at: new Date().toISOString() });
          if (op.docType) pendingFlag(op.docType, op.docId, false);
          UI.toast(`Не отправлено на сервер: ${op.title || op.kind}. ${e.message}`, 'err');
          persist(); notify();
        }
      }
    } finally {
      S.running = false;
      if (!S.queue.length && S.on) S.schedulePull(200);
    }
  };

  /* ---------- перехват действий движка: локально сразу, на сервер через очередь ---------- */
  function wrapEngine() {
    if (E._wrapped) return; E._wrapped = true;
    E.genId = () => uuid();
    E.genNo = (t, n) => `${E.PFX[t]}~${n}`;
    const orig = {};
    ['postSale', 'postReceipt', 'setOrderStatus', 'setShipped', 'saveCp', 'saveProduct', 'postSettlement', 'deleteDraft', 'saleFromOrder'].forEach((k) => { orig[k] = E[k]; });
    const ensureOrderSaved = (o) => {
      if (o.synced) return;
      o.synced = true;
      S.enqueue({ kind: 'order_save', title: `заказ ${o.no}`, payload: { id: o.id, cp: o.cp, comment: o.comment, lines: o.lines.map((l) => ({ pid: l.pid, qty: l.qty, price: l.price, discount: orderDiscount(o, l) })) } });
    };
    const orderDiscount = (o, l) => { const c = E.calcLines({ lines: [l], dType: '%', dVal: 0 }); return U.r2(c.lines[0].gross - c.lines[0].amount); };
    E.orderSaved = (id) => {
      const o = E.doc({ t: 'order', id });
      o.synced = false; ensureOrderSaved(o); persist();
    };
    E.postSale = (id) => {
      const s = E.doc({ t: 'sale', id });
      const orderId = s.orderId;
      const res = orig.postSale(id);
      s.pending = true;
      const breakdown = methodsOf(s.payMethods);
      if (orderId) S.enqueue({ kind: 'order_sale', title: `продажа ${s.no}`, docType: 'sale', docId: s.id, payload: { orderId, breakdown } });
      else S.enqueue({ kind: 'sale', title: `продажа ${s.no}`, docType: 'sale', docId: s.id, payload: { id: s.id, cp: s.cp, comment: s.comment, breakdown, lines: s.lines.map((l) => ({ pid: l.pid, qty: l.qty, price: l.price, discount: l.disc })) } });
      return res;
    };
    E.postReceipt = (id) => {
      const r = E.doc({ t: 'receipt', id });
      const res = orig.postReceipt(id);
      r.pending = true;
      S.enqueue({ kind: 'receipt', title: `приход ${r.no}`, docType: 'receipt', docId: r.id, payload: { id: r.id, cp: r.cp, comment: r.comment, breakdown: methodsOf(r.payMethods), extras: r.extras || [], lines: r.lines.map((l) => ({ pid: l.pid, qty: l.qty, price: l.price, wholesale: l.wholesale, retail: l.retail })) } });
      return res;
    };
    const statusAction = { 'draft>assembling': 'reserve', 'assembling>assembled': 'assembled', 'assembling>draft': 'release', 'assembled>draft': 'release', 'draft>cancelled': 'cancel', 'assembling>cancelled': 'cancel', 'assembled>cancelled': 'cancel' };
    E.setOrderStatus = (id, to) => {
      const o = E.doc({ t: 'order', id });
      const from = o.status, wasShipped = !!o.shipped;
      const action = statusAction[`${from}>${to}`];
      if (!action) throw new E.AccErr('Собранный заказ нельзя вернуть на сборку: верните его в «Новые» и начните сборку заново.');
      orig.setOrderStatus(id, to);
      ensureOrderSaved(o);
      if (wasShipped && to !== 'assembling') S.enqueue({ kind: 'order_status', title: `заказ ${o.no}`, payload: { orderId: id, action: 'unship' } });
      S.enqueue({ kind: 'order_status', title: `заказ ${o.no}`, payload: { orderId: id, action } });
    };
    E.setShipped = (id, v) => {
      const o = E.doc({ t: 'order', id });
      orig.setShipped(id, v);
      ensureOrderSaved(o);
      S.enqueue({ kind: 'order_status', title: `заказ ${o.no}`, payload: { orderId: id, action: v ? 'ship' : 'unship' } });
    };
    E.saleFromOrder = (id) => { const o = E.doc({ t: 'order', id }); ensureOrderSaved(o); return orig.saleFromOrder(id); };
    E.deleteDraft = (ref) => {
      const d = E.doc(ref);
      const wasOnServer = ref.t === 'order' && d && d.synced;
      orig.deleteDraft(ref);
      if (wasOnServer) S.enqueue({ kind: 'order_delete', title: `заказ ${d.no}`, payload: { orderId: ref.id } });
    };
    E.saveProduct = (data, id) => {
      const before = id ? { ...E.product(id) } : null;
      const p = orig.saveProduct(data, id);
      const photoChanged = !before || before.photo !== p.photo;
      S.enqueue({ kind: 'product_save', title: `товар ${p.name}`, payload: { id: p.id, name: p.name, unit: p.unit, category: p.category, purchasePrice: p.purchasePrice, retailPrice: p.retailPrice, wholesalePrice: p.wholesalePrice, active: p.active, photo: photoChanged ? p.photo : null, photoCleared: photoChanged && !p.photo && !!(before && before.photo) } });
      return p;
    };
    orig.addOpeningStock = E.addOpeningStock;
    E.addOpeningStock = (pid, qty, unitCost) => {
      const lot = orig.addOpeningStock(pid, qty, unitCost);
      const doc = E.doc(lot.ref);
      S.enqueue({ kind: 'opening_stock', title: `остаток ${E.pName(pid)}`, payload: { id: doc.id, pid, qty, unitCost } });
      return lot;
    };
    E.saveCp = (data, id) => {
      const c = orig.saveCp(data, id);
      S.enqueue({ kind: 'cp_save', title: `человек ${c.name}`, payload: { id: c.id, name: c.name, phone: c.phone, note: c.note } });
      return c;
    };
    orig.postReturn = E.postReturn;
    E.postReturn = (id) => {
      const r = E.doc({ t: 'ret', id });
      const sale = E.doc({ t: 'sale', id: r.saleId });
      if (sale.pending) throw new E.AccErr('Продажа ещё не отправлена на сервер. Дождитесь отправки и повторите возврат.');
      const lines = r.lines.map((l) => ({ qty: l.qty, saleLineId: sale.lines[l.li].sid })).filter((l) => num(l.qty) > 0);
      if (lines.some((l) => !l.saleLineId)) throw new E.AccErr('Эта продажа не загружена с сервера полностью. Обновите данные и повторите.');
      const breakdown = methodsOf(r.payMethods);
      const res = orig.postReturn(id);
      r.pending = true;
      S.enqueue({ kind: 'buyer_return', title: `возврат ${r.no}`, docType: 'ret', docId: r.id, payload: { id: r.id, saleId: r.saleId, comment: r.comment, lines, breakdown } });
      return res;
    };
    E.postSettlement = (cp, dir, rows, moneyTotal, comment, opts = {}) => {
      if (rows.some((r) => num(r.goods) > 0)) throw new E.AccErr('Возврат товаром пока доступен только в режиме администратора на сервере.');
      const alloc = rows.filter((r) => num(r.money) > 0).map((r) => ({ docId: E.debt(r.debtId).ref.id, amount: U.r2(num(r.money)) }));
      const res = orig.postSettlement(cp, dir, rows, moneyTotal, comment, opts);
      const method = opts.method || 'cash';
      S.enqueue({ kind: 'debt_payment', title: 'оплата долга', payload: { id: uuid(), cp, dir, comment, rows: alloc, breakdown: [{ method, amount: U.r2(num(moneyTotal)).toFixed(2) }] } });
      return res;
    };
    // этих действий сервер пока не принимает: локально их не выполняем, чтобы копия не разошлась с сервером
    const notOnServer = (what) => () => { throw new E.AccErr(`${what} в рабочем режиме пока недоступно.`); };
    E.cancelSale = notOnServer('Отмена проведения продажи');
    E.cancelReceipt = notOnServer('Отмена проведения прихода');
    E.saveOrderEdit = notOnServer('Изменение заказа на сборке (верните его в «Новые» и измените)');
    E.saleToOrder = notOnServer('Перенос продажи в заказ');
    E.applyImport = notOnServer('Импорт начальных данных');
    E.save = persist;
    E.load = () => {};
  }

  /* Возврат поставщику — только при связи: товар уходит со склада сразу, расчёт делает сервер. */
  S.supplierReturn = async (receiptId, lines, comment) => {
    if (S.queue.length) throw new E.AccErr('Сначала дождитесь отправки предыдущих действий на сервер.');
    const receipt = E.doc({ t: 'receipt', id: receiptId });
    const id = uuid();
    const body = { id, source_receipt: receiptId, warehouse: S.warehouse, reason: comment || 'Возврат поставщику', lines: lines.map((l) => ({ source_line: receipt.lines[l.li].sid, quantity: String(l.qty) })) };
    let doc;
    try { doc = await api('POST', '/supplier-returns/', body); } catch (e) { throw new E.AccErr(e.message); }
    try { await api('POST', `/supplier-returns/${id}/post/`, { version: doc.version }, { key: uuid() }); } catch (e) { throw new E.AccErr(e.message); }
    await S.pullNow();
  };

  /* ---------- лента изменений ---------- */
  S.feedLoop = async () => {
    const token = (S.feedToken = uuid());
    let fails = 0;
    while (S.on && S.feedToken === token) {
      try {
        const r = await api('GET', `/sync/changes/?since=${S.cursor}&wait=25`, null, { timeout: 40000 });
        fails = 0;
        if (!S.ready) { // программа запускалась без связи: дозапуск (S.start откроет свою ленту, эта завершится)
          try { await S.start(); } catch (e) { if (e.status === 401) return; await sleep(5000); }
          continue;
        }
        if (!S.online) { S.online = true; notify(); S.kick(); }
        S.cursor = r.last_seq; persist();
        const fresh = r.events.filter((e) => e.entity === 'document' && e.actor && e.actor !== S.cfg.username);
        S.announced = S.announced || new Set();
        fresh.forEach((e) => {
          if (e.action === 'deleted' || S.announced.has(e.id)) return;
          const known = E.S && [...E.S.orders, ...E.S.receipts].some((d) => d.id === e.id);
          if (!known && ['order', 'receipt'].includes(e.doc_type)) S.announced.add(e.id);
          if (!known && e.doc_type === 'order') UI.toast(`Новый заказ ${e.number} от «${e.actor}»`, 'ok');
          else if (!known && e.doc_type === 'receipt') UI.toast(`Новый приход ${e.number} от «${e.actor}»`, 'ok');
        });
        if (r.events.length) S.schedulePull(250);
      } catch (e) {
        if (e.status === 401) return;
        if (S.online) { S.online = false; notify(); }
        fails++; await sleep(Math.min(2000 * fails, 15000));
      }
    }
  };

  /* ---------- запуск ---------- */
  S.start = async () => {
    wrapEngine();
    const me = await api('GET', '/auth/me/');
    S.isAdmin = !!(me.is_superuser || (me.warehouses || []).some((w) => w.role === 'admin'));
    const wh = (me.warehouses && me.warehouses[0]) || (await firstPage('/warehouses/', 10))[0];
    S.warehouse = wh ? wh.id : null;
    if (!S.warehouse) throw new ApiError(403, null, false, 'Пользователю не назначен склад. Попросите администратора выдать доступ.');
    // склад и права запоминаются: без связи программа запускается и копит действия с правильным складом
    Object.assign(S.cfg, { username: me.username, warehouse: S.warehouse, isAdmin: S.isAdmin }); S.saveCfg();
    S.on = true;
    const state = await api('GET', '/sync/state/');
    if (!S.cursor || S.cursor > state.last_seq) S.cursor = state.last_seq;
    S.ready = true;
    await S.pullNow();
    notify();
    S.feedLoop(); S.kick();
  };

  S.boot = async () => {
    let cfg = null;
    try { cfg = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch (e) { /* ignore */ }
    const forced = new URLSearchParams(location.search).get('server');
    if (forced) { if (!cfg || cfg.url !== normUrl(forced)) cfg = { url: normUrl(forced), token: '', username: '' }; localStorage.setItem('hoz_use_server', '1'); S.saveCfgValue(cfg); }
    S.available = !!(window.__TAURI__ || window.__TAURI_INTERNALS__ || localStorage.getItem('hoz_use_server') === '1' || window.HOZ_SERVER_URL);
    if (!S.available) return;
    if (!cfg) cfg = { url: normUrl(window.HOZ_SERVER_URL || ''), token: '', username: '' };
    S.cfg = cfg;
    wrapEngine();
    const [state, queue, failed, cursor] = await Promise.all([idb.get('state'), idb.get('queue'), idb.get('failed'), idb.get('cursor')]);
    if (state) { try { E.S = E.normalizeProducts(JSON.parse(state)); } catch (e) { E.S = null; } }
    if (!E.S) E.S = E.blank();
    try { S.queue = JSON.parse(queue || '[]'); S.failed = JSON.parse(failed || '[]'); } catch (e) { S.queue = []; S.failed = []; }
    S.cursor = cursor || 0;
    if (cfg.token) {
      try { await S.start(); } catch (e) {
        if (e.network) {
          // без связи работаем на локальной копии; когда связь появится, лента изменений выполнит запуск (S.start)
          S.warehouse = cfg.warehouse || null; S.isAdmin = !!cfg.isAdmin; S.retailId = cfg.retailId || null;
          S.on = true; S.online = false; S.feedLoop();
        } else if (e.status === 401) S.cfg.token = '';
        else console.error(e);
      }
    }
  };

  /* ---------- экран входа и индикатор связи ---------- */
  S.LoginScreen = () => {
    const [url, setUrl] = useState(S.cfg.url || '');
    const [user, setUser] = useState(S.cfg.username || '');
    const [pass, setPass] = useState('');
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);
    const go = async (e) => {
      e && e.preventDefault();
      setBusy(true); setErr('');
      try { await S.login(url, user, pass); } catch (x) { setErr(x.message || 'Не удалось войти'); }
      setBusy(false);
    };
    return html`<div class="mode-select">
      <div class="mode-brand">ХозУчёт</div>
      <div class="mode-sub">Вход в систему</div>
      <form class="login-card" onSubmit=${go}>
        <label>Адрес сервера</label><input class="in" value=${url} placeholder="https://uchet.example.com" onInput=${(e) => setUrl(e.target.value)} />
        <label>Логин</label><input class="in" value=${user} autofocus onInput=${(e) => setUser(e.target.value)} />
        <label>Пароль</label><input class="in" type="password" value=${pass} onInput=${(e) => setPass(e.target.value)} />
        ${err ? html`<div class="note err">${err}</div>` : null}
        <button class="btn pri big" type="submit" disabled=${busy || !url || !user || !pass}>${busy ? 'Входим…' : 'Войти'}</button>
      </form>
    </div>`;
  };
  S.Badge = () => {
    const [, f] = useState(0);
    useEffect(() => { const h = () => f((x) => x + 1); S.listeners.push(h); return () => { S.listeners = S.listeners.filter((x) => x !== h); }; }, []);
    if (!S.on) return null;
    const q = S.queue.length, bad = S.failed.length;
    const showFailed = () => UI.modal({ title: 'Не отправлено на сервер', body: (mid) => html`<div>
      ${S.failed.map((x, i) => html`<div class="fail-row" key=${i}><b>${x.op.title || x.op.kind}</b><div class="muted">${x.error}</div></div>`)}
      <div class="pay-footer"><span class="sp"></span><button class="btn pri" onClick=${() => { S.failed = []; persist(); notify(); UI.close(mid); S.pullNow(); }}>Понятно, убрать</button></div></div>` });
    return html`<span class="sync-badge ${S.online ? (q ? 'wait' : 'ok') : 'off'}" title=${S.cfg.url}>
      <i></i>${S.online ? (q ? `Отправка… (${q})` : 'Онлайн') : `Нет связи${q ? ` · в очереди ${q}` : ''}`}
      ${bad ? html` <a onClick=${showFailed}>ошибок: ${bad}</a>` : null}
    </span>`;
  };
})();
