/* Учётное ядро макета.
 * Все проведения выполняются транзакционно (tx): при ошибке состояние откатывается целиком.
 * В реальной программе эта логика должна выполняться на сервере (см. п. 24 ТЗ). */
(function () {
  const E = (window.E = {});
  const KEY = 'hozuchet-local-v2';
  const { r2, r3, eq, gt0, sum } = U;

  class AccErr extends Error {
    constructor(msg, details) { super(msg); this.details = details || []; }
  }
  E.AccErr = AccErr;

  E.PFX = { receipt: 'ПТ', sale: 'ПР', order: 'ЗК', ret: 'ВК', sret: 'ВП', pay: 'ОП', off: 'ВЗ', imp: 'ИМ', debt: 'ДЛ' };
  E.TITLE = { receipt: 'Поступление', sale: 'Продажа', order: 'Заказ', ret: 'Возврат покупателя', sret: 'Возврат поставщику', pay: 'Оплата', off: 'Взаимозачёт', imp: 'Импорт начальных данных', debt: 'Запись долга' };
  const COLL = { receipt: 'receipts', sale: 'sales', order: 'orders', ret: 'returns', sret: 'sreturns', pay: 'payments', off: 'offsets', imp: 'imports', debt: 'debtNotes' };
  E.STATUS = { draft: 'Черновик', posted: 'Проведён', cancelled: 'Отменён', assembling: 'На сборке', assembled: 'Собран', done: 'Выполнен' };
  E.ORDER_ACTIVE = ['assembling', 'assembled'];
  E.UNITS = ['шт', 'кг', 'м'];

  function blank() {
    return {
      v: 1, seq: {}, user: 'Продавец 1',
      products: [], cps: [], lots: [], receipts: [], sales: [], orders: [], returns: [], sreturns: [],
      payments: [], offsets: [], debts: [], allocs: [], moves: [], log: [], imports: [], debtNotes: [],
    };
  }

  E.blank = blank;
  E.orderSaved = () => {}; // режим сервера подменяет: заказ сохранён и должен уйти на сервер
  E.S = null;
  E.listeners = [];
  E._time = null;
  E.now = () => E._time || new Date().toISOString();
  E.normalizeProducts = (state = E.S) => {
    (state && state.products || []).forEach((p) => {
      const legacySize = String(p.size || '').trim();
      if (legacySize && !p.variantName) p.variantName = legacySize;
      delete p.size;
    });
    return state;
  };
  E.load = () => {
    try { const raw = localStorage.getItem(KEY); if (raw) { E.S = E.normalizeProducts(JSON.parse(raw)); E.save(); return; } } catch (e) { /* нет хранилища */ }
    E.reset(false);
  };
  E.save = () => { try { localStorage.setItem(E.storageKey || KEY, JSON.stringify(E.S)); } catch (e) { /* ignore */ } };
  E.reset = (notify = true) => { E.S = blank(); window.Seed.run(); E.save(); if (notify) E.notify(); };
  E.notify = () => E.listeners.forEach((f) => f());
  E.changed = () => { E.save(); E.notify(); };

  const next = (k) => (E.S.seq[k] = (E.S.seq[k] || 0) + 1);
  // Режим сервера подменяет генерацию идентификаторов (UUID) и номеров (назначает сервер).
  E.genId = null; E.genNo = null;
  const newId = (kind, n, prefix) => (E.genId ? E.genId(kind, n) : prefix + n);
  const newDocHead = (t) => { const n = next(t); return { id: newId(t, n, t), no: E.genNo ? E.genNo(t, n) : `${E.PFX[t]}-${U.pad(n)}`, t, at: E.now(), author: E.S.user, status: 'draft' }; };
  E.ref = (d) => ({ t: d.t, id: d.id });
  E.doc = (ref) => (ref ? E.S[COLL[ref.t]].find((d) => d.id === ref.id) : null);
  E.refNo = (ref) => { const d = E.doc(ref); return d ? d.no : '—'; };
  E.refTitle = (ref) => { const d = E.doc(ref); return d ? `${E.TITLE[ref.t]} ${d.no}` : '—'; };

  function tx(fn) {
    const snap = JSON.stringify(E.S);
    try { const r = fn(); E.changed(); return r; }
    catch (e) { E.S = JSON.parse(snap); throw e; }
  }
  E.tx = tx;
  const log = (action, ref, text) => E.S.log.push({ id: next('log'), at: E.now(), user: E.S.user, action, ref: ref || null, text: text || '' });
  E.log = log;
  const fail = (errs) => { if (errs.length) throw new AccErr(errs[0].msg, errs); };

  /* ---------------- Справочники ---------------- */
  E.product = (id) => E.S.products.find((p) => p.id === id);
  E.tracksInventory = (p) => E.inventoryEnabled !== false && !!p && !p.externalSizeId;
  E.cp = (id) => E.S.cps.find((c) => c.id === id);
  E.cpName = (id) => (id ? (E.cp(id) || {}).name || '—' : 'Розничный покупатель');
  E.productLabel = (p) => (p ? `${p.name}${p.variantName ? ` — ${p.variantName}` : ''}` : '—');
  E.pName = (id) => E.productLabel(E.product(id));

  E.productGroups = (products = E.S.products) => {
    const groups = new Map();
    products.forEach((p) => {
      const key = p.externalProductId != null ? `otabek:${p.externalProductId}` : `local:${p.id}`;
      if (!groups.has(key)) groups.set(key, { key, name: p.name, category: p.category, photo: p.photo, products: [] });
      groups.get(key).products.push(p);
    });
    return [...groups.values()].map((g) => ({
      ...g,
      products: g.products.sort((a, b) => String(a.variantName || '').localeCompare(String(b.variantName || ''), 'ru', { numeric: true })),
    })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  };

  // Группировка строк для чека и накладной: документ и его расчёт не изменяются.
  E.documentProductGroups = (doc, calc = E.calcLines(doc)) => {
    const groups = new Map();
    (doc.lines || []).forEach((line, index) => {
      const product = (doc.status !== 'draft' && line.productSnapshot) || E.product(line.pid) || {
        id: line.pid,
        name: line.product_name || line.name || 'Товар',
        variantName: line.variant_name || line.variantName || '',
        unit: line.unit || 'шт',
        photo: '', category: '',
      };
      const key = product.externalProductId != null ? `otabek:${product.externalProductId}` : `local:${line.pid}`;
      if (!groups.has(key)) groups.set(key, {
        key, name: product.name, photo: product.photo || '', category: product.category || '',
        products: [], items: [], total: 0, discount: 0, gross: 0, qty: 0, units: [],
      });
      const group = groups.get(key);
      const calculated = calc.lines[index];
      const item = {
        line, index, product,
        amount: r2(calculated.amount), discount: r2(calculated.disc), gross: r2(calculated.gross),
      };
      if (!group.products.some((p) => p.id === product.id)) group.products.push(product);
      if (!group.units.includes(product.unit)) group.units.push(product.unit);
      if (!group.photo && product.photo) group.photo = product.photo;
      group.items.push(item);
      group.total = r2(group.total + item.amount);
      group.discount = r2(group.discount + item.discount);
      group.gross = r2(group.gross + item.gross);
      group.qty = r3(group.qty + (U.isNum(line.qty) ? line.qty : 0));
    });
    return [...groups.values()];
  };

  E.categories = () => [...new Set(E.S.products.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));

  E.productUsed = (pid) => E.S.moves.some((m) => m.pid === pid) ||
    E.S.lots.some((l) => l.pid === pid && l.qtyInitial > 0) ||
    ['receipts', 'sales', 'orders'].some((c) => E.S[c].some((d) => d.lines.some((l) => l.pid === pid))) ||
    E.S.debts.some((d) => d.pid === pid);

  E.validateProduct = (p, id) => {
    const errs = [];
    if (!String(p.name || '').trim()) errs.push({ field: 'name', msg: 'Укажите наименование товара' });
    if (!E.UNITS.includes(p.unit)) errs.push({ field: 'unit', msg: 'Единица: шт, кг или м' });
    if (!U.isNum(p.retailPrice) || p.retailPrice < 0) errs.push({ field: 'retailPrice', msg: 'Розничная цена — число ≥ 0' });
    if (!U.isNum(p.wholesalePrice) || p.wholesalePrice < 0) errs.push({ field: 'wholesalePrice', msg: 'Оптовая цена — число ≥ 0' });
    if (!U.isNum(p.purchasePrice) || p.purchasePrice < 0) errs.push({ field: 'purchasePrice', msg: 'Закупочная цена — число ≥ 0' });
    if (id) {
      const old = E.product(id);
      if (!old) errs.push({ msg: 'Товар не найден — обновите данные' });
      else if (old.unit !== p.unit && E.productUsed(id)) errs.push({ field: 'unit', msg: 'По товару уже есть движения или документы — единицу измерения менять нельзя' });
    }
    return errs;
  };
  E.saveProduct = (data, id) => {
    const p = {
      name: String(data.name || '').trim(),
      category: String(data.category || '').trim(),
      unit: data.unit,
      purchasePrice: r2(data.purchasePrice),
      retailPrice: r2(data.retailPrice),
      wholesalePrice: r2(data.wholesalePrice || 0),
      photo: String(data.photo || '').trim(),
      variantName: String(data.variantName || '').trim(),
      active: data.active !== false,
      externalProductId: data.externalProductId || null,
      externalSizeId: data.externalSizeId || null,
      externalCreatedAt: data.externalCreatedAt || '',
    };
    fail(E.validateProduct(p, id));
    return tx(() => {
      if (id) {
        const old = E.product(id);
        const priceChanged = old.retailPrice !== p.retailPrice || old.wholesalePrice !== p.wholesalePrice;
        Object.assign(old, p);
        log('Изменение товара', null, `${old.code} ${old.name}${priceChanged ? `: розничная цена ${U.money(p.retailPrice)} (проведённые продажи не изменяются)` : ''}`);
        return old;
      }
      const n = next('product');
      const np = { id: newId('product', n, 'p'), code: E.genNo ? '' : U.pad(n, 6), ...p, importCode: data.importCode || '' };
      E.S.products.push(np);
      log('Новый товар', null, `${np.code} ${np.name}`);
      return np;
    });
  };

  /* Начальный остаток одного товара (без поставщика и долга): партия FIFO с указанной себестоимостью. */
  E.addOpeningStock = (pid, qty, unitCost) => {
    const p = E.product(pid);
    if (!p) throw new AccErr('Товар не найден');
    if (!U.validQty(qty, p.unit)) throw new AccErr(`Остаток — ${U.qtyRule(p.unit)}, больше нуля`);
    if (!U.isNum(unitCost) || unitCost < 0) throw new AccErr('Себестоимость единицы — число ≥ 0');
    return tx(() => {
      const imp = { ...newDocHead('imp'), fileName: 'Начальный остаток', hash: '', status: 'posted', postedAt: E.now(), counts: { products: 0, cps: 0, lots: 1, debts: 0 } };
      E.S.imports.push(imp);
      const lot = addLot({ pid, qty, cost: r3(qty) * unitCost, purchasePrice: unitCost, ref: E.ref(imp), li: 1, kind: 'Начальный остаток' });
      log('Начальный остаток', E.ref(imp), `${p.name}: ${U.qtyU(lot.qtyInitial, p.unit)} по ${U.money(unitCost)}`);
      return lot;
    });
  };

  E.saveCp = (data, id) => {
    const c = { name: String(data.name || '').trim(), phone: String(data.phone || '').trim(), note: String(data.note || '').trim() };
    if (!c.name) throw new AccErr('Укажите имя или название', [{ field: 'name', msg: 'Укажите имя или название' }]);
    return tx(() => {
      if (id) { Object.assign(E.cp(id), c); log('Изменение контрагента', null, c.name); return E.cp(id); }
      const n = next('cp');
      const nc = { id: newId('cp', n, 'c'), code: E.genNo ? '' : U.pad(n, 5), ...c, importCode: data.importCode || '' };
      E.S.cps.push(nc);
      log('Новый контрагент', null, nc.name);
      return nc;
    });
  };

  /* ---------------- Остатки и резервы ---------------- */
  const liveLots = (pid) => E.S.lots.filter((l) => l.pid === pid && !l.cancelled);
  E.lotsOf = (pid) => E.S.lots.filter((l) => l.pid === pid);
  E.stock = (pid) => r3(sum(liveLots(pid), (l) => l.qtyLeft));
  E.stockCost = (pid) => r2(sum(liveLots(pid), (l) => l.costLeft));
  E.reserveOrders = (pid, exceptOrderId) => {
    const res = [];
    E.S.orders.forEach((o) => {
      if (o.id === exceptOrderId || !E.ORDER_ACTIVE.includes(o.status)) return;
      const q = r3(sum(o.lines.filter((l) => l.pid === pid), (l) => l.qty || 0));
      if (q > 0) res.push({ order: o, qty: q });
    });
    return res;
  };
  E.reserved = (pid, exceptOrderId) => r3(sum(E.reserveOrders(pid, exceptOrderId), (x) => x.qty));
  E.available = (pid, exceptOrderId) => r3(E.stock(pid) - E.reserved(pid, exceptOrderId));

  const addMove = (pid, lotId, qty, cost, ref, kind) =>
    E.S.moves.push({ id: next('move'), at: E.now(), pid, lotId, qty: r3(qty), cost: r2(cost), ref, kind, user: E.S.user });

  /* Новая партия FIFO и движение прихода. cost — полная себестоимость партии (закупка + допрасходы). */
  function addLot({ pid, qty, cost, purchasePrice, purchaseCost = cost, extraCost = 0, ref, li, cp = null, source = 'initial', order = 1, kind }) {
    const n = next('lot'); const q = r3(qty); const c = r2(cost);
    const lot = { id: newId('lot', n, 'lot'), seq: n, pid, ref, li, cp, source, at: E.now(), qtyInitial: q, qtyLeft: q, purchasePrice: r2(purchasePrice), purchaseCost: r2(purchaseCost), extraCost: r2(extraCost), cost: c, costLeft: c, unitCost: q > 0 ? c / q : 0, cancelled: false, order };
    E.S.lots.push(lot);
    addMove(pid, lot.id, q, c, ref, kind);
    return lot;
  }

  function writeOffFIFO(pid, qty, ref, kind, preferLotId) {
    let left = r3(qty);
    const res = [];
    let lots = liveLots(pid).filter((l) => l.qtyLeft > 0.0005).sort((a, b) => a.seq - b.seq);
    if (preferLotId) lots = [...lots.filter((l) => l.id === preferLotId), ...lots.filter((l) => l.id !== preferLotId)];
    for (const lot of lots) {
      if (left <= 0.0005) break;
      const take = r3(Math.min(lot.qtyLeft, left));
      const cost = eq(take, lot.qtyLeft) ? lot.costLeft : r2(take * lot.unitCost);
      lot.qtyLeft = r3(lot.qtyLeft - take);
      lot.costLeft = r2(lot.costLeft - cost);
      left = r3(left - take);
      res.push({ lotId: lot.id, qty: take, cost });
      addMove(pid, lot.id, -take, -cost, ref, kind);
    }
    if (left > 0.0005) throw new AccErr(`Недостаточно товара «${E.pName(pid)}» на складе: не хватает ${U.qty(left)}`);
    return res;
  }
  E.lot = (id) => E.S.lots.find((l) => l.id === id);

  /* ---------------- Долги ---------------- */
  E.allocsOf = (debtId) => E.S.allocs.filter((a) => a.debtId === debtId && !a.cancelled);
  E.debtPart = (d, kind) => r2(sum(E.allocsOf(d.id).filter((a) => a.kind === kind), (a) => a.amount));
  E.debtGoodsQty = (d) => r3(sum(E.allocsOf(d.id).filter((a) => a.kind === 'goods'), (a) => a.qty || 0));
  E.debtRem = (d) => r2(d.amount - sum(E.allocsOf(d.id), (a) => a.amount));
  E.debtsOf = (cp) => E.S.debts.filter((d) => d.cp === cp && !d.cancelled);
  E.openDebts = (cp, dir) => E.debtsOf(cp).filter((d) => d.dir === dir && gt0(E.debtRem(d))).sort((a, b) => a.seq - b.seq);
  E.balance = (cp) => {
    const recv = r2(sum(E.openDebts(cp, 'recv'), E.debtRem));
    const pay = r2(sum(E.openDebts(cp, 'pay'), E.debtRem));
    return { recv, pay, net: r2(recv - pay) };
  };
  E.debt = (id) => E.S.debts.find((d) => d.id === id);
  E.debtOfLine = (ref, li) => E.S.debts.find((d) => !d.cancelled && d.ref.t === ref.t && d.ref.id === ref.id && (d.li === li || d.li === null));

  function addDebt(o) {
    const n = next('debt');
    const d = { id: 'd' + n, seq: n, at: E.now(), cancelled: false, li: null, pid: null, qty: null, price: null, note: '', ...o };
    d.amount = r2(d.amount);
    E.S.debts.push(d);
    return d;
  }
  function addAlloc(d, kind, amount, ref, qty) {
    const a = { id: next('alloc'), debtId: d.id, kind, amount: r2(amount), qty: qty == null ? null : r3(qty), ref, at: E.now(), cancelled: false };
    E.S.allocs.push(a);
    return a;
  }
  E.newDebtNote = ({ cp, dir, amount, comment = '' }) => {
    if (!E.prototypeMode) throw new AccErr('Запись долга доступна в тестовом режиме');
    if (!E.cp(cp)) throw new AccErr('Выберите человека');
    if (!['recv', 'pay'].includes(dir) || !U.isNum(amount) || amount <= 0) throw new AccErr('Укажите направление и положительную сумму долга');
    return tx(() => {
      const d = { ...newDocHead('debt'), cp, dir, amount: r2(amount), comment, status: 'posted', postedAt: E.now() };
      E.S.debtNotes.push(d);
      addDebt({ cp, dir, amount: d.amount, note: comment || E.TITLE.debt, ref: E.ref(d) });
      log('Запись долга', E.ref(d), `${E.cpName(cp)}: ${U.money(d.amount)}`);
      return d;
    });
  };
  E.applyOffset = (cp) => {
    if (!E.prototypeMode) throw new AccErr('Ручной взаимозачёт доступен в тестовом режиме');
    return tx(() => autoOffset(cp, null, true));
  };
  function newPayment(cp, dir, amount, src, comment) {
    const p = { ...newDocHead('pay'), cp: cp || null, dir, amount: r2(amount), src: src || null, comment: comment || '', status: 'posted', postedAt: E.now() };
    E.S.payments.push(p);
    log(dir === 'in' ? 'Получена оплата' : 'Выдана оплата', E.ref(p), `${E.cpName(cp)}: ${U.som(amount)}`);
    return p;
  }
  // оплата при проведении документа распределяется пропорционально строкам долга (предлагаемое правило)
  function payProportional(debts, amount, payDoc) {
    if (!gt0(amount) || !debts.length) return;
    const parts = U.alloc(amount, debts.map((d) => d.amount));
    debts.forEach((d, i) => { if (gt0(parts[i])) addAlloc(d, 'pay', parts[i], E.ref(payDoc)); });
  }

  /* Автоматический взаимозачёт: закрываются сначала самые старые долги с обеих сторон. */
  function autoOffset(cp, trigger, explicit = false) {
    // В UI-прототипе встречные денежные долги видны раздельно до явного зачёта.
    if (E.prototypeMode && !explicit) return null;
    if (!cp) return null;
    const R = E.openDebts(cp, 'recv'), P = E.openDebts(cp, 'pay');
    const amt = r2(Math.min(sum(R, E.debtRem), sum(P, E.debtRem)));
    if (!gt0(amt)) return null;
    const off = { ...newDocHead('off'), cp, amount: amt, trigger: trigger || null, status: 'posted', postedAt: E.now() };
    const side = (list) => {
      let left = amt;
      for (const d of list) {
        if (!gt0(left)) break;
        const x = r2(Math.min(E.debtRem(d), left));
        addAlloc(d, 'offset', x, E.ref(off));
        left = r2(left - x);
      }
    };
    side(R); side(P);
    E.S.offsets.push(off);
    log('Взаимозачёт', E.ref(off), `${E.cpName(cp)}: ${U.som(amt)}`);
    return off;
  }
  E.offsetPreview = (cp, dir, amount) => {
    if (!cp || !gt0(amount)) return null;
    const opp = r2(sum(E.openDebts(cp, dir === 'recv' ? 'pay' : 'recv'), E.debtRem));
    const closes = r2(Math.min(opp, amount));
    return { amount: r2(amount), closes, rest: r2(amount - closes), dir };
  };

  /* ---------------- Строки продажи / заказа ---------------- */
  E.calcLines = (doc) => {
    const out = doc.lines.map((l) => {
      const e = [];
      const q = U.isNum(l.qty) ? l.qty : 0, p = U.isNum(l.price) ? l.price : 0;
      const gross = r2(q * p);
      const v = l.dVal == null || l.dVal === '' ? 0 : l.dVal;
      let lineDisc = 0;
      if (!U.isNum(v) || v < 0) e.push({ field: 'disc', msg: 'Скидка — неотрицательное число' });
      else if (l.dType === '%' && v > 100) e.push({ field: 'disc', msg: 'Скидка не может быть больше 100 %' });
      else lineDisc = l.dType === '%' ? r2((gross * v) / 100) : r2(v);
      if (lineDisc > gross + 0.0001) { e.push({ field: 'disc', msg: 'Скидка больше суммы строки — сумма стала бы отрицательной' }); lineDisc = gross; }
      return { gross, lineDisc, after: r2(gross - lineDisc), share: 0, errs: e };
    });
    const afterTotal = r2(sum(out, (o) => o.after));
    const dv = doc.dVal == null || doc.dVal === '' ? 0 : doc.dVal;
    let docDisc = 0; const docErrs = [];
    if (!U.isNum(dv) || dv < 0) docErrs.push({ field: 'docDisc', msg: 'Скидка на документ — неотрицательное число' });
    else if (doc.dType === '%' && dv > 100) docErrs.push({ field: 'docDisc', msg: 'Скидка не может быть больше 100 %' });
    else docDisc = doc.dType === '%' ? r2((afterTotal * dv) / 100) : r2(dv);
    if (docDisc > afterTotal + 0.0001) { docErrs.push({ field: 'docDisc', msg: 'Скидка на документ больше суммы документа' }); docDisc = afterTotal; }
    const shares = gt0(docDisc) ? U.alloc(docDisc, out.map((o) => o.after)) || out.map(() => 0) : out.map(() => 0);
    out.forEach((o, i) => { o.share = shares[i]; o.disc = r2(o.lineDisc + o.share); o.amount = r2(o.gross - o.disc); });
    return { lines: out, gross: r2(sum(out, (o) => o.gross)), disc: r2(sum(out, (o) => o.disc)), docDisc, total: r2(sum(out, (o) => o.amount)), docErrs };
  };

  // Нехватка по товарам документа: суммируем строки одного товара
  E.shortages = (doc, exceptOrderId) => {
    const need = {};
    doc.lines.forEach((l) => { if (l.pid && U.isNum(l.qty) && l.qty > 0) need[l.pid] = r3((need[l.pid] || 0) + l.qty); });
    const res = {};
    Object.keys(need).forEach((pid) => {
      if (!E.tracksInventory(E.product(pid))) return;
      const avail = E.available(pid, exceptOrderId);
      if (need[pid] > avail + 0.0005) {
        res[pid] = { pid, need: need[pid], avail: Math.max(0, avail), stock: E.stock(pid), reserved: E.reserved(pid, exceptOrderId), orders: E.reserveOrders(pid, exceptOrderId), missing: r3(need[pid] - Math.max(0, avail)) };
      }
    });
    return res;
  };
  E.shortageText = (s) => {
    const u = E.product(s.pid).unit;
    let t = `Доступно ${U.qtyU(s.avail, u)}. Требуется ${U.qtyU(s.need, u)}. Не хватает ${U.qtyU(s.missing, u)}.`;
    if (gt0(s.reserved)) t += ` На складе ${U.qtyU(s.stock, u)}, из них в резерве ${U.qtyU(s.reserved, u)}: ` + s.orders.map((x) => `${x.order.no} (${E.cpName(x.order.cp)}) — ${U.qty(x.qty)}`).join(', ') + '.';
    return t;
  };

  // нехватку показываем на последней строке этого товара
  const shortageErrs = (doc, exceptOrderId, prefix) => Object.values(E.shortages(doc, exceptOrderId)).map((x) => ({
    line: doc.lines.map((l, i) => (l.pid === x.pid ? i : -1)).filter((i) => i >= 0).pop(),
    field: 'qty', short: x, msg: `«${E.pName(x.pid)}»: ${prefix}${E.shortageText(x)}`,
  }));

  function validateLines(doc, errs, opts = {}) {
    if (!doc.lines.length) errs.push({ msg: 'Добавьте хотя бы один товар' });
    const calc = E.calcLines(doc);
    doc.lines.forEach((l, i) => {
      const p = E.product(l.pid);
      if (!p) { errs.push({ line: i, field: 'pid', msg: `Строка ${i + 1}: выберите товар` }); return; }
      if (!p.active && opts.checkActive) errs.push({ line: i, field: 'pid', msg: `Строка ${i + 1}: товар «${p.name}» неактивен` });
      if (!U.validQty(l.qty, p.unit)) errs.push({ line: i, field: 'qty', msg: `Строка ${i + 1}: количество — ${U.qtyRule(p.unit)}, больше нуля` });
      if (!U.isNum(l.price) || l.price < 0) errs.push({ line: i, field: 'price', msg: `Строка ${i + 1}: цена — число ≥ 0` });
      calc.lines[i].errs.forEach((e) => errs.push({ line: i, field: e.field, msg: `Строка ${i + 1}: ${e.msg}` }));
    });
    calc.docErrs.forEach((e) => errs.push(e));
    return calc;
  }

  /* ---------------- Поступление ---------------- */
  E.newReceipt = (o = {}) => tx(() => {
    const r = { ...newDocHead('receipt'), cp: o.cp || null, source: o.source || 'supplier', comment: o.comment || '', lines: o.lines || [], extras: o.extras || [], paid: 0, returnTo: o.returnTo || null };
    E.S.receipts.push(r);
    return r;
  });
  E.receiptCalc = (r) => {
    const lines = r.lines.map((l) => ({ amount: r2((U.isNum(l.qty) ? l.qty : 0) * (U.isNum(l.price) ? l.price : 0)) }));
    const goods = r2(sum(lines, (x) => x.amount));
    const extras = r2(sum(r.extras, (x) => (U.isNum(x.amount) ? x.amount : 0)));
    const parts = gt0(extras) ? U.alloc(extras, lines.map((x) => x.amount)) : lines.map(() => 0);
    lines.forEach((x, i) => {
      x.extra = parts ? parts[i] : 0;
      x.cost = r2(x.amount + x.extra);
      const q = r.lines[i].qty;
      x.unitCost = U.isNum(q) && q > 0 ? x.cost / q : 0;
    });
    const paid = U.isNum(r.paid) ? r.paid : 0;
    return { lines, goods, extras, cost: r2(goods + extras), paid, debt: r2(goods - paid), canSplit: !!parts };
  };
  E.validateReceipt = (r) => {
    const errs = [];
    if (!r.cp) errs.push({ field: 'cp', msg: 'Выберите контрагента — поставщика или соседа' });
    if (!r.lines.length) errs.push({ msg: 'Добавьте хотя бы один товар' });
    r.lines.forEach((l, i) => {
      const p = E.product(l.pid);
      if (!p) { errs.push({ line: i, field: 'pid', msg: `Строка ${i + 1}: выберите товар` }); return; }
      if (!U.validQty(l.qty, p.unit)) errs.push({ line: i, field: 'qty', msg: `Строка ${i + 1}: количество — ${U.qtyRule(p.unit)}, больше нуля` });
      if (!U.isNum(l.price) || l.price < 0) errs.push({ line: i, field: 'price', msg: `Строка ${i + 1}: цена — число ≥ 0` });
      ['wholesale', 'retail'].forEach((k) => { if (l[k] != null && l[k] !== '' && (!U.isNum(l[k]) || l[k] < 0)) errs.push({ line: i, field: k, msg: `Строка ${i + 1}: ${k === 'retail' ? 'розничная' : 'оптовая'} цена — число ≥ 0` }); });
    });
    r.extras.forEach((x, i) => {
      if (!String(x.name || '').trim()) errs.push({ extra: i, field: 'name', msg: `Допрасход ${i + 1}: укажите название` });
      if (!U.isNum(x.amount) || x.amount <= 0) errs.push({ extra: i, field: 'amount', msg: `Допрасход ${i + 1}: сумма должна быть больше нуля` });
    });
    const c = E.receiptCalc(r);
    if (gt0(c.extras) && !gt0(c.goods)) errs.push({ field: 'extras', msg: 'Общая закупочная стоимость равна нулю — пропорционально распределить дополнительные расходы невозможно' });
    if (!U.isNum(r.paid) || r.paid < 0) errs.push({ field: 'paid', msg: 'Оплачено — число ≥ 0' });
    else if (r.paid > c.goods + 0.0001) errs.push({ field: 'paid', msg: `Оплачено больше суммы закупки (${U.money(c.goods)}). Допрасходы не входят в расчёт с поставщиком` });
    return errs;
  };
  E.postReceipt = (id) => {
    const r = E.doc({ t: 'receipt', id });
    if (!r || r.status !== 'draft') throw new AccErr('Документ уже проведён или отменён — повторное проведение не выполняется');
    fail(E.validateReceipt(r));
    return tx(() => {
      const c = E.receiptCalc(r);
      r.lines.forEach((l, i) => {
        const x = c.lines[i];
        const lot = addLot({ pid: l.pid, qty: l.qty, cost: x.cost, purchasePrice: l.price, purchaseCost: x.amount, extraCost: x.extra, ref: E.ref(r), li: i, cp: r.cp, source: r.source, kind: 'Поступление' });
        l.lotId = lot.id; l.amount = x.amount; l.extra = x.extra; l.cost = x.cost;
      });
      r.goods = c.goods; r.extrasTotal = c.extras; r.paid = r2(r.paid);
      r.lines.forEach((l) => {
        const p = E.product(l.pid);
        p.purchasePrice = r2(l.price);
        if (U.isNum(l.wholesale)) p.wholesalePrice = r2(l.wholesale);
        if (U.isNum(l.retail)) p.retailPrice = r2(l.retail);
        if (U.isNum(l.wholesale) || U.isNum(l.retail)) log('Новые цены товара', E.ref(r), `${p.name}: закуп ${U.money(p.purchasePrice)}, опт ${U.money(p.wholesalePrice)}, розница ${U.money(p.retailPrice)}`);
      });
      let pay = null;
      if (gt0(r.paid)) pay = newPayment(r.cp, 'out', r.paid, E.ref(r), 'Оплата при поступлении');
      if (gt0(c.debt)) {
        const debts = r.lines.map((l, i) => (gt0(l.amount) ? addDebt({ cp: r.cp, dir: 'pay', ref: E.ref(r), li: i, pid: l.pid, qty: l.qty, price: l.price, amount: l.amount }) : null)).filter(Boolean);
        if (pay) payProportional(debts, r.paid, pay);
      }
      r.status = 'posted'; r.postedAt = E.now(); r.postedBy = E.S.user;
      log('Проведение', E.ref(r), `${E.cpName(r.cp)}: закупка ${U.som(c.goods)}, допрасходы ${U.som(c.extras)}`);
      const off = autoOffset(r.cp, E.ref(r));
      return { doc: r, offset: off };
    });
  };
  E.cancelReceipt = (id) => {
    const r = E.doc({ t: 'receipt', id });
    if (r.status !== 'posted') throw new AccErr('Отменить можно только проведённый документ');
    const errs = [];
    r.lines.forEach((l) => {
      const lot = E.lot(l.lotId);
      const foreign = E.S.moves.filter((m) => m.lotId === lot.id && !(m.ref.t === 'receipt' && m.ref.id === r.id) && (E.doc(m.ref) || {}).status !== 'cancelled');
      if (foreign.length) {
        const docs = [...new Set(foreign.map((m) => E.refNo(m.ref)))].join(', ');
        errs.push({ msg: `Товар «${E.pName(l.pid)}» из этой партии уже участвовал в операциях (${docs}). Отмена поступления невозможна — оформите возврат поставщику или корректирующий документ.` });
      }
    });
    const need = {};
    r.lines.forEach((l) => (need[l.pid] = r3((need[l.pid] || 0) + l.qty)));
    Object.keys(need).forEach((pid) => { if (E.available(pid) < need[pid] - 0.0005) errs.push({ msg: `«${E.pName(pid)}»: после отмены доступный остаток стал бы отрицательным (товар зарезервирован заказами)` }); });
    E.S.debts.filter((d) => !d.cancelled && d.ref.t === 'receipt' && d.ref.id === r.id).forEach((d) => {
      E.allocsOf(d.id).forEach((a) => {
        const own = a.kind === 'pay' && a.ref.t === 'pay' && ((E.doc(a.ref) || {}).src || {}).id === r.id;
        if (!own) errs.push({ msg: `По долгу этого поступления уже есть операции (${E.refTitle(a.ref)}). Отмена невозможна — сначала отмените их или оформите корректировку.` });
      });
    });
    fail(errs);
    return tx(() => {
      r.lines.forEach((l) => {
        const lot = E.lot(l.lotId);
        addMove(l.pid, lot.id, -lot.qtyLeft, -lot.costLeft, E.ref(r), 'Отмена поступления');
        lot.qtyLeft = 0; lot.costLeft = 0; lot.cancelled = true;
      });
      cancelDocMoney(r);
      r.status = 'cancelled'; r.cancelledAt = E.now(); r.cancelledBy = E.S.user;
      log('Отмена проведения', E.ref(r), 'Партии аннулированы, долг и оплата сторнированы');
    });
  };
  function cancelDocMoney(doc) {
    E.S.debts.filter((d) => !d.cancelled && d.ref.t === doc.t && d.ref.id === doc.id).forEach((d) => {
      d.cancelled = true; E.allocsOf(d.id).forEach((a) => (a.cancelled = true));
    });
    E.S.payments.filter((p) => p.src && p.src.t === doc.t && p.src.id === doc.id && p.status === 'posted').forEach((p) => (p.status = 'cancelled'));
  }

  /* ---------------- Продажа ---------------- */
  E.newSale = (o = {}) => tx(() => {
    const s = { ...newDocHead('sale'), cp: o.cp || null, orderId: o.orderId || null, transfer: !!o.transfer, priceType: o.priceType || 'retail', lines: o.lines || [], dType: o.dType || 'сум', dVal: o.dVal || 0, paid: 0, payMethods: {}, comment: o.comment || '' };
    E.S.sales.push(s);
    return s;
  });
  E.PRICE_OPTS = [{ v: 'retail', t: 'Розница' }, { v: 'wholesale', t: 'Оптом' }];
  E.productPrice = (p, priceType) => priceType === 'wholesale' ? p.wholesalePrice : p.retailPrice;
  E.lineFromProduct = (p, price, priceType) => ({ pid: p.id, qty: 1, price: price != null ? price : E.productPrice(p, priceType), dType: 'сум', dVal: 0 });
  E.neighborErrors = (line, unit) => {
    const n = line.neighbor;
    if (!n || !E.prototypeMode) return [];
    const errs = [];
    if (!E.cp(n.cp)) errs.push({field:'neighbor',msg:'Выберите соседа'});
    if (!U.validQty(n.qty, unit) || n.qty <= 0 || n.qty > line.qty) errs.push({field:'neighbor',msg:'Количество у соседа должно быть больше нуля и не больше количества в продаже'});
    if (!U.isNum(n.price) || n.price <= 0) errs.push({field:'neighbor',msg:'Укажите цену за единицу для соседа'});
    return errs;
  };
  // Одним действием задаёт итоговые количества размеров; 0 убирает размер из документа.
  E.setVariantQuantities = (doc, products, quantities, pricing = {}) => {
    if (!doc || doc.status !== 'draft' || !['sale', 'order'].includes(doc.t)) throw new AccErr('Размеры можно менять только в черновике продажи или заказа');
    if (doc.t === 'sale' && doc.orderId) throw new AccErr('Состав продажи по заказу менять нельзя');
    const choices = [...new Map(products.map((p) => [p.id, p])).values()];
    const ids = new Set(choices.map((p) => p.id));
    const replacements = new Map();
    const errs = [];
    choices.forEach((p, i) => {
      const qty = Object.prototype.hasOwnProperty.call(quantities, p.id) ? quantities[p.id] : 0;
      const existing = doc.lines.find((l) => l.pid === p.id);
      if (!U.isNum(qty) || qty < 0 || (qty > 0 && !U.validQty(qty, p.unit))) {
        errs.push({ pid: p.id, line: i, field: 'qty', msg: `${E.productLabel(p)}: количество — ${U.qtyRule(p.unit)} или 0` });
        return;
      }
      if (!E.UNITS.includes(p.unit)) {
        errs.push({ pid: p.id, line: i, field: 'qty', msg: `${E.productLabel(p)}: неизвестная единица измерения` });
        return;
      }
      if (qty === 0) return;
      if (!existing && !p.active) errs.push({ pid: p.id, line: i, field: 'qty', msg: `${E.productLabel(p)}: товар неактивен` });
      const terms = pricing[p.id] || {};
      const nextLine = { ...(existing || E.lineFromProduct(p, undefined, doc.priceType || 'retail')), ...Object.fromEntries(['price', 'dType', 'dVal', ...(E.prototypeMode ? ['neighbor'] : [])].filter((k) => Object.prototype.hasOwnProperty.call(terms, k)).map((k) => [k, k === 'neighbor' && terms[k] ? U.clone(terms[k]) : terms[k]])), qty: r3(qty) };
      E.neighborErrors(nextLine,p.unit).forEach((e) => errs.push({...e,pid:p.id,line:i}));
      if (!U.isNum(nextLine.price) || nextLine.price < 0) errs.push({ pid: p.id, line: i, field: 'price', msg: `${E.productLabel(p)}: цена — число ≥ 0` });
      const calc = E.calcLines({ lines: [nextLine], dType: '%', dVal: 0 });
      calc.lines[0].errs.forEach((e) => errs.push({ ...e, pid: p.id, line: i, msg: `${E.productLabel(p)}: ${e.msg}` }));
      replacements.set(p.id, nextLine);
    });
    fail(errs);
    const proposed = [];
    const placed = new Set();
    doc.lines.forEach((line) => {
      if (!ids.has(line.pid)) { proposed.push(line); return; }
      if (!placed.has(line.pid) && replacements.has(line.pid)) proposed.push(replacements.get(line.pid));
      placed.add(line.pid);
    });
    choices.forEach((p) => {
      if (!placed.has(p.id) && replacements.has(p.id)) proposed.push(replacements.get(p.id));
    });
    return tx(() => {
      doc.lines = proposed;
      return doc.lines.filter((line) => ids.has(line.pid));
    });
  };
  E.PAY_LABELS = { cash: 'Наличные', mbank: 'МБанк' }; // способы оплаты — те же, что принимает сервер
  E.validateSale = (s) => {
    const errs = [];
    const calc = validateLines(s, errs, { checkActive: !s.orderId });
    s.lines.forEach((l,i) => E.neighborErrors(l,E.product(l.pid)?.unit).forEach((e) => errs.push({...e,line:i})));
    if (s.transfer && !s.cp) errs.push({ field: 'cp', msg: 'Для передачи товара в долг выберите контрагента' });
    if (!U.isNum(s.paid) || s.paid < 0) errs.push({ field: 'paid', msg: 'Сумма оплаты — число ≥ 0' });
    else if (s.paid > calc.total + 0.0001) errs.push({ field: 'paid', msg: `Переплата не принимается: оплата ${U.money(s.paid)} больше суммы продажи ${U.money(calc.total)}. Расчёт сдачи и авансы в первой версии не поддерживаются.` });
    else if (s.paid < calc.total - 0.0001 && !s.cp) errs.push({ field: 'cp', msg: 'Продажа в долг без контрагента запрещена: выберите контрагента или примите полную оплату' });
    if (s.orderId) {
      const o = E.doc({ t: 'order', id: s.orderId });
      if (!o || !E.ORDER_ACTIVE.includes(o.status)) errs.push({ msg: 'Заказ, из которого создана продажа, не находится в статусе «На сборке» или «Собран»' });
    }
    errs.push(...shortageErrs(s, s.orderId, ''));
    return { errs, calc };
  };
  E.postSale = (id) => {
    const s = E.doc({ t: 'sale', id });
    if (!s || s.status !== 'draft') throw new AccErr('Продажа уже проведена или отменена — повторное проведение не выполняется');
    const { errs } = E.validateSale(s); // повторная проверка остатков в момент проведения
    fail(errs);
    return tx(() => {
      const calc = E.calcLines(s);
      s.lines.forEach((l, i) => {
        const c = calc.lines[i];
        if (E.prototypeMode) l.productSnapshot = U.clone(E.product(l.pid));
        l.gross = c.gross; l.disc = c.disc; l.amount = c.amount;
        l.wo = E.tracksInventory(E.product(l.pid)) ? writeOffFIFO(l.pid, l.qty, E.ref(s), s.transfer ? 'Передача в долг' : 'Продажа') : [];
        l.cogs = r2(sum(l.wo, (w) => w.cost));
        if (E.prototypeMode && l.neighbor) {
          const n = l.neighbor, amount = r2(n.qty * n.price);
          const note = { ...newDocHead('debt'), cp:n.cp, dir:'pay', amount, status:'posted', postedAt:E.now(), sourceSaleId:s.id, sourceLine:i, neighbor:U.clone(n), productSnapshot:U.clone(l.productSnapshot), comment:`Взяли у соседа: ${E.productLabel(E.product(l.pid))}, ${U.qtyU(n.qty,E.product(l.pid).unit)} × ${U.money(n.price)} сом. Чек ${s.no}` };
          E.S.debtNotes.push(note);
          addDebt({cp:n.cp,dir:'pay',amount,ref:E.ref(note),note:note.comment});
          l.neighborDebtId = note.id;
        }
      });
      s.gross = calc.gross; s.disc = calc.disc; s.total = calc.total; s.cogs = r2(sum(s.lines, (l) => l.cogs)); s.paid = r2(s.paid);
      if (s.orderId) { const o = E.doc({ t: 'order', id: s.orderId }); o.status = 'done'; o.saleId = s.id; o.doneAt = E.now(); log('Заказ выполнен', E.ref(o), `Резерв использован продажей ${s.no}`); }
      let pay = null;
      if (gt0(s.paid)) pay = newPayment(s.cp, 'in', s.paid, E.ref(s), 'Оплата при продаже');
      const debt = r2(s.total - s.paid);
      if (gt0(debt)) {
        // В прототипе долг денежный, по чеку целиком, без складских/товарных остатков.
        const debts = E.prototypeMode
          ? [addDebt({ cp: s.cp, dir: 'recv', ref: E.ref(s), amount: s.total })]
          : s.lines.map((l, i) => (gt0(l.amount) ? addDebt({ cp: s.cp, dir: 'recv', ref: E.ref(s), li: i, pid: l.pid, qty: l.qty, price: l.amount / l.qty, amount: l.amount }) : null)).filter(Boolean);
        if (pay) payProportional(debts, s.paid, pay);
      }
      s.status = 'posted'; s.postedAt = E.now(); s.postedBy = E.S.user;
      log('Проведение', E.ref(s), `${E.cpName(s.cp)}: ${U.som(s.total)}, оплачено ${U.som(s.paid)}, себестоимость FIFO ${U.som(s.cogs)}`);
      const off = autoOffset(s.cp, E.ref(s));
      return { doc: s, offset: off, debt };
    });
  };
  E.cancelSale = (id) => {
    const s = E.doc({ t: 'sale', id });
    if (s.status !== 'posted') throw new AccErr('Отменить можно только проведённую продажу');
    const errs = [];
    const rets = E.S.returns.filter((x) => x.saleId === s.id && x.status === 'posted');
    const neighborNotes = (E.S.debtNotes || []).filter((n) => n.sourceSaleId === id && n.status === 'posted');
    neighborNotes.forEach((n) => {
      if (E.S.debts.some((d) => !d.cancelled && d.ref.t === 'debt' && d.ref.id === n.id && E.allocsOf(d.id).length)) errs.push({msg:`Долг соседу «${E.cpName(n.cp)}» уже погашали. Сначала отмените связанные оплаты или взаимозачёт.`});
    });
    if (rets.length) errs.push({ msg: `По продаже оформлены возвраты (${rets.map((x) => x.no).join(', ')}). Отмена невозможна.` });
    E.S.debts.filter((d) => !d.cancelled && d.ref.t === 'sale' && d.ref.id === s.id).forEach((d) => {
      E.allocsOf(d.id).forEach((a) => {
        const own = a.kind === 'pay' && a.ref.t === 'pay' && ((E.doc(a.ref) || {}).src || {}).id === s.id;
        if (!own) errs.push({ msg: `По долгу продажи уже есть операции (${E.refTitle(a.ref)}). Отмена невозможна без корректирующего документа.` });
      });
    });
    fail(errs);
    return tx(() => {
      s.lines.forEach((l) => {
        [...l.wo].reverse().forEach((w) => {
          const lot = E.lot(w.lotId);
          lot.qtyLeft = r3(lot.qtyLeft + w.qty); lot.costLeft = r2(lot.costLeft + w.cost);
          addMove(l.pid, lot.id, w.qty, w.cost, E.ref(s), 'Отмена продажи');
        });
      });
      cancelDocMoney(s);
      neighborNotes.forEach((n) => { cancelDocMoney(n); n.status='cancelled'; n.cancelledAt=E.now(); n.cancelReason=`Отмена чека ${s.no}`; });
      if (s.orderId) { const o = E.doc({ t: 'order', id: s.orderId }); o.status = 'assembled'; o.saleId = null; }
      s.status = 'cancelled'; s.cancelledAt = E.now(); s.cancelledBy = E.S.user;
      log('Отмена проведения', E.ref(s), 'Товар возвращён в исходные партии, долг и оплата сторнированы');
    });
  };
  E.deleteDraft = (ref) => {
    const d = E.doc(ref);
    if (!d || d.status !== 'draft') throw new AccErr('Удалить можно только черновик');
    return tx(() => {
      E.S[COLL[ref.t]] = E.S[COLL[ref.t]].filter((x) => x.id !== ref.id);
      if (ref.t === 'sale' && d.orderId) { const o = E.doc({ t: 'order', id: d.orderId }); if (o && o.saleId === d.id) o.saleId = null; }
      if (d.lines && d.lines.length) log('Удалён черновик', null, `${E.TITLE[ref.t]} ${d.no}`);
    });
  };
  E.copyDoc = (ref, options = {}) => {
    const d = E.doc(ref);
    const lines = d.lines.map((l) => (ref.t === 'receipt' ? { pid: l.pid, qty: l.qty, price: l.price } : { pid: l.pid, qty: l.qty, price: l.price, dType: l.dType, dVal: l.dVal, ...(E.prototypeMode && options.neighbor && l.neighbor ? {neighbor:U.clone(l.neighbor)} : {}) }));
    if (ref.t === 'receipt') return E.newReceipt({ cp: d.cp, source: d.source, comment: d.comment, lines, extras: U.clone(d.extras) });
    if (ref.t === 'sale') return E.newSale({ cp: d.cp, transfer: d.transfer, priceType: d.priceType, lines, dType: d.dType, dVal: d.dVal, comment: d.comment });
    return E.newOrder({ cp: d.cp, priceType: d.priceType, lines, dType: d.dType, dVal: d.dVal, comment: d.comment });
  };

  /* ---------------- Заказы ---------------- */
  E.newOrder = (o = {}) => tx(() => {
    const d = { ...newDocHead('order'), cp: o.cp || null, priceType: o.priceType || 'retail', comment: o.comment || '', lines: o.lines || [], dType: o.dType || 'сум', dVal: o.dVal || 0, saleId: null };
    E.S.orders.push(d);
    return d;
  });
  E.validateOrder = (o, reserve) => {
    const errs = [];
    const calc = validateLines(o, errs, { checkActive: true });
    o.lines.forEach((l,i) => E.neighborErrors(l,E.product(l.pid)?.unit).forEach((e) => errs.push({...e,line:i})));
    if (reserve) errs.push(...shortageErrs(o, o.id, 'резерв сверх остатка невозможен. '));
    return { errs, calc };
  };
  E.setOrderStatus = (id, to) => {
    const o = E.doc({ t: 'order', id });
    const from = o.status;
    const allowed = { draft: ['assembling', 'cancelled'], assembling: ['assembled', 'draft', 'cancelled'], assembled: ['assembling', 'draft', 'cancelled'] };
    if (!(allowed[from] || []).includes(to)) throw new AccErr(`Переход «${E.STATUS[from]}» → «${E.STATUS[to]}» недопустим`);
    if (from === 'draft' && to === 'assembling') fail(E.validateOrder(o, true).errs);
    return tx(() => {
      if (to === 'cancelled' || to === 'draft') {
        const sd = o.saleId && E.doc({ t: 'sale', id: o.saleId });
        if (sd && sd.status === 'draft') { E.S.sales = E.S.sales.filter((x) => x.id !== sd.id); }
        o.saleId = null;
      }
      o.status = to;
      if (E.prototypeMode && to === 'assembling') o.lines.forEach((l) => { l.productSnapshot = U.clone(E.product(l.pid)); });
      if (to !== 'assembling') o.shipped = false;
      const txt = { assembling: 'Товар зарезервирован, заказ передан на сборку', assembled: 'Заказ собран, резерв сохраняется', draft: 'Возвращён в черновик, резерв освобождён', cancelled: 'Заказ отменён, резерв освобождён' }[to];
      log('Статус заказа', E.ref(o), txt);
    });
  };
  E.setShipped = (id, shipped) => {
    const o = E.doc({ t: 'order', id });
    if (!E.ORDER_ACTIVE.includes(o.status)) throw new AccErr('Отправить можно только заказ, который собирается');
    return tx(() => { o.shipped = !!shipped; log('Статус заказа', E.ref(o), shipped ? 'Заказ отправлен' : 'Возвращён на сборку'); });
  };
  E.saveOrderEdit = (id, w) => {
    const o = E.doc({ t: 'order', id });
    const probe = { ...o, lines: w.lines, dType: w.dType, dVal: w.dVal };
    fail(E.validateOrder(probe, E.ORDER_ACTIVE.includes(o.status)).errs);
    return tx(() => {
      Object.assign(o, { cp: w.cp, comment: w.comment, lines: U.clone(w.lines), dType: w.dType, dVal: w.dVal });
      log('Изменение заказа', E.ref(o), 'Резерв пересчитан');
    });
  };
  E.saleFromOrder = (id) => {
    const o = E.doc({ t: 'order', id });
    if (!E.ORDER_ACTIVE.includes(o.status)) throw new AccErr('Продажу можно оформить из заказа в статусе «На сборке» или «Собран»');
    if (o.saleId) { const s = E.doc({ t: 'sale', id: o.saleId }); if (s && s.status === 'draft') return s; }
    return tx(() => {
      const s = { ...newDocHead('sale'), cp: o.cp, orderId: o.id, priceType: o.priceType || 'retail', transfer: false, lines: U.clone(o.lines).map((l) => ({ pid: l.pid, qty: l.qty, price: l.price, dType: l.dType, dVal: l.dVal, ...(E.prototypeMode && l.neighbor ? {neighbor:l.neighbor} : {}) })), dType: o.dType, dVal: o.dVal, paid: 0, comment: `По заказу ${o.no}` };
      E.S.sales.push(s);
      o.saleId = s.id;
      return s;
    });
  };
  E.saleToOrder = (saleId) => {
    const s = E.doc({ t: 'sale', id: saleId });
    return tx(() => {
      const o = { ...newDocHead('order'), cp: s.cp, priceType: s.priceType || 'retail', comment: s.comment, lines: U.clone(s.lines), dType: s.dType, dVal: s.dVal, saleId: null };
      E.S.orders.push(o);
      E.S.sales = E.S.sales.filter((x) => x.id !== s.id);
      log('Заказ из продажи', E.ref(o), `Строки перенесены из черновика ${s.no}`);
      return o;
    });
  };

  /* ---------------- Возврат покупателя ---------------- */
  E.returnedOf = (saleId, li, exceptRetId) => {
    let qty = 0, amount = 0, cogs = 0;
    E.S.returns.filter((r) => r.saleId === saleId && r.status === 'posted' && r.id !== exceptRetId).forEach((r) => r.lines.forEach((l) => { if (l.li === li) { qty += l.qty; amount += l.amount; cogs += l.cogs || 0; } }));
    return { qty: r3(qty), amount: r2(amount), cogs: r2(cogs) };
  };
  E.newReturn = (saleId) => {
    const s = E.doc({ t: 'sale', id: saleId });
    if (!s || s.status !== 'posted') throw new AccErr('Возврат оформляется только по проведённой продаже');
    return tx(() => {
      const r = { ...newDocHead('ret'), saleId, cp: s.cp, lines: s.lines.map((l, li) => ({ li, qty: 0 })), refundNow: 0, comment: '' };
      E.S.returns.push(r);
      return r;
    });
  };
  E.returnCalc = (r) => {
    const s = E.doc({ t: 'sale', id: r.saleId });
    const used = {};
    const lines = r.lines.map((l) => {
      const sl = s.lines[l.li];
      const done = E.returnedOf(s.id, l.li, r.id);
      const can = r3(sl.qty - done.qty);
      const q = U.isNum(l.qty) ? l.qty : 0;
      const unit = sl.amount / sl.qty;
      const amount = !gt0(q) ? 0 : eq(done.qty + q, sl.qty) ? r2(sl.amount - done.amount) : r2(q * unit);
      const monetary = E.prototypeMode && E.S.debts.find((d) => !d.cancelled && !d.pid && d.ref.t === 'sale' && d.ref.id === s.id);
      const d = monetary || E.debtOfLine({ t: 'sale', id: s.id }, l.li);
      const rem = d ? r2(E.debtRem(d) - (used[d.id] || 0)) : 0;
      const toDebt = r2(Math.min(amount, rem));
      if (d) used[d.id] = r2((used[d.id] || 0) + toDebt);
      return { sl, done, can, q, unit, amount, debt: d, toDebt, toRefund: r2(amount - toDebt) };
    });
    const amount = r2(sum(lines, (x) => x.amount));
    const toDebt = r2(sum(lines, (x) => x.toDebt));
    const refund = r2(sum(lines, (x) => x.toRefund));
    return { sale: s, lines, amount, toDebt, refund };
  };
  E.validateReturn = (r) => {
    const errs = [];
    const c = E.returnCalc(r);
    r.lines.forEach((l, i) => {
      const x = c.lines[i]; const u = (E.prototypeMode && x.sl.productSnapshot?.unit) || E.product(x.sl.pid).unit;
      if (l.qty == null || l.qty === 0) return;
      if (!U.validQty(l.qty, u)) errs.push({ line: i, field: 'qty', msg: `Строка ${i + 1}: количество — ${U.qtyRule(u)}` });
      else if (l.qty > x.can + 0.0005) errs.push({ line: i, field: 'qty', msg: `Строка ${i + 1}: нельзя вернуть больше, чем продано с учётом прежних возвратов (можно ${U.qtyU(x.can, u)})` });
    });
    if (!c.lines.some((x) => gt0(x.q))) errs.push({ msg: 'Укажите количество хотя бы по одной строке' });
    const now = U.isNum(r.refundNow) ? r.refundNow : NaN;
    if (!U.isNum(now) || now < 0) errs.push({ field: 'refundNow', msg: 'Сумма выдачи — число ≥ 0' });
    else if (now > c.refund + 0.0001) errs.push({ field: 'refundNow', msg: `Нельзя выдать больше суммы к возврату (${U.money(c.refund)})` });
    else if (!r.cp && !eq(now, c.refund)) errs.push({ field: 'refundNow', msg: 'Продажа была без контрагента: выдайте покупателю всю сумму возврата сразу' });
    return { errs, calc: c };
  };
  function _postReturn(r) {
    const { calc: c } = E.validateReturn(r);
    const s = c.sale;
    const refundDebts = [];
    r.lines.forEach((l, i) => {
      const x = c.lines[i];
      if (!gt0(x.q)) { l.qty = 0; l.amount = 0; l.cogs = 0; l.restored = []; return; }
      const sl = x.sl;
      if (!E.tracksInventory(E.product(sl.pid))) {
        l.qty = x.q; l.pid = sl.pid; l.price = x.unit; l.amount = x.amount; l.restored = []; l.cogs = 0;
        l.toDebt = x.toDebt; l.toRefund = x.toRefund;
        if (gt0(x.toDebt)) addAlloc(x.debt, 'goods', x.toDebt, E.ref(r), r3((x.q * x.toDebt) / x.amount));
        if (gt0(x.toRefund) && r.cp) refundDebts.push(addDebt({ cp: r.cp, dir: 'pay', ref: E.ref(r), li: i, pid: sl.pid, qty: r3(x.toRefund / x.unit), price: x.unit, amount: x.toRefund, note: 'Вернуть деньги за возвращённый товар' }));
        return;
      }
      // восстановление партий: исходные списания в обратном порядке
      let left = r3(x.q); const restored = [];
      for (let k = sl.wo.length - 1; k >= 0 && left > 0.0005; k--) {
        const w = sl.wo[k];
        const avail = r3(w.qty - (w.ret || 0));
        if (avail <= 0.0005) continue;
        const take = r3(Math.min(avail, left));
        const cost = eq(take, avail) ? r2(w.cost - (w.retCost || 0)) : r2((take * w.cost) / w.qty);
        const lot = E.lot(w.lotId);
        lot.qtyLeft = r3(lot.qtyLeft + take); lot.costLeft = r2(lot.costLeft + cost);
        w.ret = r3((w.ret || 0) + take); w.retCost = r2((w.retCost || 0) + cost);
        addMove(sl.pid, lot.id, take, cost, E.ref(r), 'Возврат покупателя');
        restored.push({ lotId: lot.id, qty: take, cost });
        left = r3(left - take);
      }
      if (left > 0.0005) {
        // данные сервера не хранят исходные списания: возвращаем в первую партию по её себестоимости единицы
        const lot = E.lotsOf(sl.pid).find((z) => !z.cancelled);
        if (lot) {
          const cost = r2(left * lot.unitCost);
          lot.qtyLeft = r3(lot.qtyLeft + left); lot.costLeft = r2(lot.costLeft + cost);
          addMove(sl.pid, lot.id, left, cost, E.ref(r), 'Возврат покупателя');
          restored.push({ lotId: lot.id, qty: left, cost });
        }
      }
      l.qty = x.q; l.pid = sl.pid; l.price = x.unit; l.amount = x.amount; l.restored = restored; l.cogs = r2(sum(restored, (z) => z.cost));
      l.toDebt = x.toDebt; l.toRefund = x.toRefund;
      if (gt0(x.toDebt)) addAlloc(x.debt, 'goods', x.toDebt, E.ref(r), r3((x.q * x.toDebt) / x.amount));
      if (gt0(x.toRefund) && r.cp) refundDebts.push(addDebt({ cp: r.cp, dir: 'pay', ref: E.ref(r), li: i, pid: sl.pid, qty: r3(x.toRefund / x.unit), price: x.unit, amount: x.toRefund, note: 'Вернуть деньги за возвращённый товар' }));
    });
    r.amount = c.amount; r.toDebt = c.toDebt; r.refund = c.refund; r.refundNow = r2(r.refundNow); r.cogs = r2(sum(r.lines, (l) => l.cogs || 0));
    if (gt0(r.refundNow)) {
      const p = newPayment(r.cp, 'out', r.refundNow, E.ref(r), 'Выдача денег за возврат');
      let left = r.refundNow;
      refundDebts.forEach((d) => { const x = r2(Math.min(left, d.amount)); if (gt0(x)) { addAlloc(d, 'pay', x, E.ref(p)); left = r2(left - x); } });
    }
    r.status = 'posted'; r.postedAt = E.now(); r.postedBy = E.S.user;
    log('Проведение', E.ref(r), `По продаже ${s.no}: возврат ${U.som(c.amount)}, уменьшен долг ${U.som(c.toDebt)}, к выдаче ${U.som(c.refund)}`);
    return autoOffset(r.cp, E.ref(r));
  }
  E.postReturn = (id) => {
    const r = E.doc({ t: 'ret', id });
    if (!r || r.status !== 'draft') throw new AccErr('Возврат уже проведён — повторное проведение не выполняется');
    fail(E.validateReturn(r).errs);
    return tx(() => ({ doc: r, offset: _postReturn(r) }));
  };

  /* ---------------- Возврат поставщику (погашение нашего долга товаром) ---------------- */
  E.sretReturned = (debtId, exceptId) => {
    let qty = 0, amount = 0;
    E.S.sreturns.filter((x) => x.status === 'posted' && x.id !== exceptId).forEach((x) => x.lines.forEach((l) => { if (l.debtId === debtId) { qty += l.qty; amount += l.amount; } }));
    return { qty: r3(qty), amount: r2(amount) };
  };
  E.canReturnGoods = (d) => {
    if (!d.pid || !d.qty) return { ok: false, why: 'Денежный долг без товарной расшифровки — вернуть можно только деньгами' };
    if (d.dir === 'recv') {
      if (d.ref.t !== 'sale') return { ok: false, why: 'Начальный долг из импорта: себестоимость возвращаемого товара неизвестна — в первой версии погашается деньгами' };
      const done = E.returnedOf(d.ref.id, d.li);
      return { ok: true, max: r3(d.qty - done.qty) };
    }
    if (!['receipt', 'imp'].includes(d.ref.t)) return { ok: false, why: 'Возврат товаром недоступен для этой строки' };
    const done = E.sretReturned(d.id);
    return { ok: true, max: r3(Math.min(d.qty - done.qty, Math.max(0, E.available(d.pid)))), byDebt: r3(d.qty - done.qty) };
  };
  function _postSret(sr) {
    const recvDebts = [];
    sr.lines.forEach((l, i) => {
      const d = E.debt(l.debtId);
      const done = E.sretReturned(d.id, sr.id);
      const amount = eq(done.qty + l.qty, d.qty) ? r2(d.amount - done.amount) : r2(l.qty * d.price);
      if (l.qty > E.available(d.pid) + 0.0005) throw new AccErr(`«${E.pName(d.pid)}»: на складе доступно только ${U.qty(E.available(d.pid))} — вернуть больше нельзя`);
      const pref = d.ref.t === 'receipt' ? E.doc(d.ref).lines[d.li].lotId : null;
      l.wo = writeOffFIFO(d.pid, l.qty, E.ref(sr), 'Возврат поставщику', pref);
      l.pid = d.pid; l.price = d.price; l.amount = amount; l.cost = r2(sum(l.wo, (w) => w.cost));
      const rem = E.debtRem(d);
      const toDebt = r2(Math.min(rem, amount));
      if (gt0(toDebt)) addAlloc(d, 'goods', toDebt, E.ref(sr), r3((l.qty * toDebt) / amount));
      const excess = r2(amount - toDebt);
      if (gt0(excess)) recvDebts.push(addDebt({ cp: sr.cp, dir: 'recv', ref: E.ref(sr), li: i, pid: d.pid, qty: r3(excess / d.price), price: d.price, amount: excess, note: 'Вернуть нам деньги за возвращённый товар' }));
    });
    sr.amount = r2(sum(sr.lines, (l) => l.amount));
    sr.status = 'posted'; sr.postedAt = E.now(); sr.postedBy = E.S.user;
    log('Проведение', E.ref(sr), `${E.cpName(sr.cp)}: возвращено товаром на ${U.som(sr.amount)}`);
  }

  /* ---------------- Погашение долга: товар + деньги ---------------- */
  // rows: [{debtId, goods, money}]; dir: 'recv' — нам должны, 'pay' — мы должны
  E.settlementCalc = (cp, dir, rows) => {
    return rows.map((row) => {
      const d = E.debt(row.debtId);
      const rem = E.debtRem(d);
      const g = U.isNum(row.goods) ? row.goods : 0;
      const m = U.isNum(row.money) ? row.money : 0;
      let gAmount = 0;
      if (gt0(g) && d.pid && E.canReturnGoods(d).ok) {
        if (d.dir === 'recv') {
          const done = E.returnedOf(d.ref.id, d.li);
          const sl = E.doc(d.ref).lines[d.li];
          gAmount = eq(done.qty + g, sl.qty) ? r2(sl.amount - done.amount) : r2((g * sl.amount) / sl.qty);
        } else {
          const done = E.sretReturned(d.id);
          gAmount = eq(done.qty + g, d.qty) ? r2(d.amount - done.amount) : r2(g * d.price);
        }
      }
      const gToDebt = r2(Math.min(gAmount, rem));
      const excess = r2(gAmount - gToDebt);
      const after = r2(rem - gToDebt - m);
      return { d, rem, g, m, gAmount, gToDebt, excess, after, row };
    });
  };
  E.validateSettlement = (cp, dir, rows, moneyTotal) => {
    const errs = [];
    const calc = E.settlementCalc(cp, dir, rows);
    calc.forEach((x, i) => {
      const u = x.d.pid ? E.product(x.d.pid).unit : '';
      if (x.row.goods != null && x.row.goods !== 0 && x.row.goods !== '') {
        const can = E.canReturnGoods(x.d);
        if (!can.ok) errs.push({ line: i, field: 'goods', msg: can.why });
        else if (!U.validQty(x.row.goods, u)) errs.push({ line: i, field: 'goods', msg: `Количество — ${U.qtyRule(u)}` });
        else if (x.g > can.max + 0.0005) errs.push({ line: i, field: 'goods', msg: dir === 'pay' && can.byDebt > can.max ? `Можно вернуть не более ${U.qtyU(can.max, u)}: остальное продано или зарезервировано` : `Можно вернуть не более ${U.qtyU(can.max, u)}` });
      }
      if (x.row.money != null && x.row.money !== '' && (!U.isNum(x.row.money) || x.row.money < 0)) errs.push({ line: i, field: 'money', msg: 'Сумма — число ≥ 0' });
      else if (x.after < -0.0001) errs.push({ line: i, field: 'money', msg: `Нельзя погасить по строке больше её остатка (${U.money(x.rem - x.gToDebt)})` });
    });
    const mt = U.isNum(moneyTotal) ? moneyTotal : 0;
    if (!U.isNum(moneyTotal) && moneyTotal !== '' && moneyTotal != null) errs.push({ field: 'moneyTotal', msg: 'Сумма оплаты — число' });
    const alloc = r2(sum(calc, (x) => x.m));
    if (!eq(alloc, mt)) errs.push({ field: 'moneyTotal', msg: `Распределено по строкам ${U.money(alloc)}, а сумма оплаты ${U.money(mt)} — суммы должны совпадать` });
    if (!calc.some((x) => gt0(x.g) || gt0(x.m))) errs.push({ msg: 'Укажите возврат товара или сумму оплаты хотя бы по одной строке' });
    return { errs, calc };
  };
  E.postSettlement = (cp, dir, rows, moneyTotal, comment, opts = {}) => {
    const { errs, calc } = E.validateSettlement(cp, dir, rows, moneyTotal);
    fail(errs);
    return tx(() => {
      const created = [];
      const goodsRows = calc.filter((x) => gt0(x.g));
      if (dir === 'recv') {
        const bySale = {};
        goodsRows.forEach((x) => (bySale[x.d.ref.id] = bySale[x.d.ref.id] || []).push(x));
        Object.keys(bySale).forEach((saleId) => {
          const s = E.doc({ t: 'sale', id: saleId });
          const r = { ...newDocHead('ret'), saleId, cp, lines: s.lines.map((l, li) => ({ li, qty: 0 })), refundNow: 0, comment: 'Погашение долга товаром' };
          bySale[saleId].forEach((x) => (r.lines[x.d.li].qty = x.g));
          E.S.returns.push(r);
          _postReturn(r);
          created.push(E.ref(r));
        });
      } else if (goodsRows.length) {
        const sr = { ...newDocHead('sret'), cp, lines: goodsRows.map((x) => ({ debtId: x.d.id, qty: x.g })), comment: comment || 'Погашение нашего долга товаром' };
        E.S.sreturns.push(sr);
        _postSret(sr);
        created.push(E.ref(sr));
      }
      const mRows = calc.filter((x) => gt0(x.m));
      if (mRows.length) {
        const p = newPayment(cp, dir === 'recv' ? 'in' : 'out', r2(sum(mRows, (x) => x.m)), null, comment || 'Погашение долга');
        if (opts.method) p.method = opts.method;
        mRows.forEach((x) => addAlloc(x.d, 'pay', x.m, E.ref(p)));
        created.push(E.ref(p));
      }
      const off = autoOffset(cp, created[0]);
      if (off) created.push(E.ref(off));
      return created;
    });
  };

  /* ---------------- Отчёты ---------------- */
  E.inPeriod = (iso, from, to) => { const d = U.isoDay(iso); return (!from || d >= from) && (!to || d <= to); };
  E.salesReport = ({ from, to, pid, transfers = true }) => {
    const rows = {};
    const row = (id) => (rows[id] = rows[id] || { pid: id, qty: 0, gross: 0, disc: 0, net: 0, cogs: 0, retQty: 0, retAmount: 0, retCogs: 0 });
    E.S.sales.filter((s) => s.status === 'posted' && (transfers || !s.transfer) && E.inPeriod(s.postedAt, from, to)).forEach((s) => s.lines.forEach((l) => {
      if (pid && l.pid !== pid) return;
      const r = row(l.pid); r.qty += l.qty; r.gross += l.gross; r.disc += l.disc; r.net += l.amount; r.cogs += l.cogs;
    }));
    E.S.returns.filter((x) => x.status === 'posted' && E.inPeriod(x.postedAt, from, to)).forEach((x) => {
      const s = E.doc({ t: 'sale', id: x.saleId });
      if (!s || (!transfers && s.transfer)) return;
      x.lines.forEach((l) => { if (!gt0(l.qty) || (pid && l.pid !== pid)) return; const r = row(l.pid); r.retQty += l.qty; r.retAmount += l.amount; r.retCogs += l.cogs; });
    });
    return Object.values(rows).map((r) => {
      const revenue = r2(r.net - r.retAmount), cogs = r2(r.cogs - r.retCogs);
      return { ...r, qty: r3(r.qty), gross: r2(r.gross), disc: r2(r.disc), net: r2(r.net), retQty: r3(r.retQty), retAmount: r2(r.retAmount), revenue, cogsNet: cogs, profit: r2(revenue - cogs) };
    });
  };

  /* ---------------- Импорт начальных данных ---------------- */
  E.IMPORT_SHEETS = {
    'Товары': ['Код для импорта', 'Наименование', 'Категория', 'Единица', 'Закупочная цена', 'Оптовая цена', 'Розничная цена'],
    'Контрагенты': ['Код для импорта', 'Имя или название', 'Телефон'],
    'Остатки': ['Код товара', 'Количество', 'Себестоимость единицы', 'Порядок партии'],
    'Долги': ['Код контрагента', 'Направление', 'Код товара', 'Количество', 'Цена', 'Непогашенная сумма', 'Комментарий'],
  };
  const s = (v) => (v == null ? '' : String(v).trim());
  E.validateImport = (data) => {
    const errs = [], warn = [];
    const E_ = (sheet, row, field, msg) => errs.push({ sheet, row, field, msg });
    const pCodes = {}, cCodes = {};
    (data['Товары'] || []).forEach((r) => {
      const code = s(r['Код для импорта']);
      if (!code) E_('Товары', r._row, 'Код для импорта', 'Обязательное поле');
      else if (pCodes[code]) E_('Товары', r._row, 'Код для импорта', `Дубль кода «${code}» (уже в строке ${pCodes[code]._row})`);
      else if (E.S.products.some((p) => p.importCode === code)) E_('Товары', r._row, 'Код для импорта', `Товар с кодом «${code}» уже загружен ранее`);
      else pCodes[code] = r;
      if (!s(r['Наименование'])) E_('Товары', r._row, 'Наименование', 'Обязательное поле');
      else if (E.S.products.some((p) => U.norm(p.name) === U.norm(r['Наименование']))) warn.push({ sheet: 'Товары', row: r._row, field: 'Наименование', msg: 'Товар с таким названием уже есть в программе — будет создан ещё один' });
      if (!E.UNITS.includes(s(r['Единица']))) E_('Товары', r._row, 'Единица', `Недопустимая единица «${s(r['Единица'])}». Разрешено: шт, кг, м`);
      ['Закупочная цена', 'Оптовая цена', 'Розничная цена'].forEach((f) => { const n = U.num(r[f]); if (s(r[f]) === '' && (f === 'Закупочная цена' || f === 'Оптовая цена')) return; if (!U.isNum(n) || n < 0) E_('Товары', r._row, f, 'Должно быть числом ≥ 0'); });
    });
    (data['Контрагенты'] || []).forEach((r) => {
      const code = s(r['Код для импорта']);
      if (!code) E_('Контрагенты', r._row, 'Код для импорта', 'Обязательное поле');
      else if (cCodes[code] || E.S.cps.some((c) => c.importCode === code)) E_('Контрагенты', r._row, 'Код для импорта', `Дубль кода «${code}»`);
      else cCodes[code] = r;
      if (!s(r['Имя или название'])) E_('Контрагенты', r._row, 'Имя или название', 'Обязательное поле');
    });
    const unitOf = (code) => { if (pCodes[code]) return s(pCodes[code]['Единица']); const p = E.S.products.find((x) => x.importCode === code || x.code === code); return p ? p.unit : null; };
    const lotKeys = {};
    (data['Остатки'] || []).forEach((r) => {
      const code = s(r['Код товара']); const u = unitOf(code);
      if (!code) E_('Остатки', r._row, 'Код товара', 'Обязательное поле');
      else if (!u) E_('Остатки', r._row, 'Код товара', `Товар «${code}» не найден ни на листе «Товары», ни в программе`);
      const q = U.num(r['Количество']);
      if (!U.isNum(q) || q <= 0) E_('Остатки', r._row, 'Количество', 'Должно быть числом больше нуля');
      else if (u && E.UNITS.includes(u) && !U.validQty(q, u)) E_('Остатки', r._row, 'Количество', `Для единицы «${u}» — ${U.qtyRule(u)}`);
      const c = U.num(r['Себестоимость единицы']);
      if (!U.isNum(c) || c < 0) E_('Остатки', r._row, 'Себестоимость единицы', 'Должно быть числом ≥ 0');
      const ord = s(r['Порядок партии']) === '' ? 1 : U.num(r['Порядок партии']);
      if (!Number.isInteger(ord) || ord < 1) E_('Остатки', r._row, 'Порядок партии', 'Целое число от 1');
      const k = code + '#' + ord;
      if (lotKeys[k]) E_('Остатки', r._row, 'Порядок партии', `Партия ${ord} товара «${code}» уже указана в строке ${lotKeys[k]}`); else lotKeys[k] = r._row;
    });
    (data['Долги'] || []).forEach((r) => {
      const cc = s(r['Код контрагента']);
      if (!cc) E_('Долги', r._row, 'Код контрагента', 'Обязательное поле');
      else if (!cCodes[cc] && !E.S.cps.some((c) => c.importCode === cc || c.code === cc)) E_('Долги', r._row, 'Код контрагента', `Контрагент «${cc}» не найден`);
      const dir = s(r['Направление']);
      if (!['Нам должны', 'Мы должны'].includes(dir)) E_('Долги', r._row, 'Направление', 'Укажите «Нам должны» или «Мы должны»');
      const pc = s(r['Код товара']); const amt = U.num(r['Непогашенная сумма']);
      if (!U.isNum(amt) || amt <= 0) E_('Долги', r._row, 'Непогашенная сумма', 'Должно быть числом больше нуля');
      if (pc) {
        const u = unitOf(pc);
        if (!u) E_('Долги', r._row, 'Код товара', `Товар «${pc}» не найден`);
        const q = U.num(r['Количество']), pr = U.num(r['Цена']);
        if (!U.isNum(q) || q <= 0) E_('Долги', r._row, 'Количество', 'Для товарного долга укажите количество');
        else if (u && E.UNITS.includes(u) && !U.validQty(q, u)) E_('Долги', r._row, 'Количество', `Для единицы «${u}» — ${U.qtyRule(u)}`);
        if (!U.isNum(pr) || pr <= 0) E_('Долги', r._row, 'Цена', 'Для товарного долга укажите цену');
        if (U.isNum(q) && U.isNum(pr) && U.isNum(amt) && amt > r2(q * pr) + 0.001) E_('Долги', r._row, 'Непогашенная сумма', `Больше стоимости товара ${U.qty(q)} × ${U.money(pr)} = ${U.money(q * pr)}`);
      } else if (s(r['Количество']) || s(r['Цена'])) {
        E_('Долги', r._row, 'Код товара', 'Количество и цена указаны без товара. Денежный долг загружается без количества');
      }
    });
    return { errs, warn };
  };
  E.importHash = (data) => U.hash(JSON.stringify(Object.keys(E.IMPORT_SHEETS).map((k) => (data[k] || []).map((r) => E.IMPORT_SHEETS[k].map((f) => s(r[f]))))));
  E.applyImport = (data, fileName) => {
    const hash = E.importHash(data);
    const dup = E.S.imports.find((i) => i.hash === hash && i.status === 'posted');
    if (dup) throw new AccErr(`Этот файл уже загружен документом ${dup.no} от ${U.fmtDT(dup.at)}. Повторная загрузка не выполняется — второй комплект остатков и долгов не создан.`);
    const v = E.validateImport(data);
    if (v.errs.length) throw new AccErr(`В файле ${v.errs.length} ${U.plural(v.errs.length, 'ошибка', 'ошибки', 'ошибок')}. Импорт не применён.`, v.errs);
    return tx(() => {
      const imp = { ...newDocHead('imp'), fileName, hash, status: 'posted', postedAt: E.now(), counts: {} };
      E.S.imports.push(imp);
      const pMap = {}, cMap = {};
      (data['Товары'] || []).forEach((r) => {
        const n = next('product');
        const p = { id: 'p' + n, code: U.pad(n, 6), importCode: s(r['Код для импорта']), name: s(r['Наименование']), category: s(r['Категория']), unit: s(r['Единица']), purchasePrice: r2(U.num(r['Закупочная цена']) || 0), wholesalePrice: r2(U.num(r['Оптовая цена']) || 0), retailPrice: r2(U.num(r['Розничная цена'])), photo: s(r['Фото'] || ''), active: true };
        E.S.products.push(p); pMap[p.importCode] = p;
      });
      (data['Контрагенты'] || []).forEach((r) => {
        const n = next('cp');
        const c = { id: 'c' + n, code: U.pad(n, 5), importCode: s(r['Код для импорта']), name: s(r['Имя или название']), phone: s(r['Телефон']), note: '' };
        E.S.cps.push(c); cMap[c.importCode] = c;
      });
      const P = (code) => pMap[code] || E.S.products.find((x) => x.importCode === code || x.code === code);
      const C = (code) => cMap[code] || E.S.cps.find((x) => x.importCode === code || x.code === code);
      const st = [...(data['Остатки'] || [])].sort((a, b) => (U.num(a['Порядок партии']) || 1) - (U.num(b['Порядок партии']) || 1));
      st.forEach((r) => {
        const p = P(s(r['Код товара'])); const q = r3(U.num(r['Количество'])); const uc = U.num(r['Себестоимость единицы']);
        addLot({ pid: p.id, qty: q, cost: q * uc, purchasePrice: uc, ref: E.ref(imp), li: r._row, order: U.num(r['Порядок партии']) || 1, kind: 'Начальный остаток' });
      });
      const touched = new Set();
      (data['Долги'] || []).forEach((r) => {
        const c = C(s(r['Код контрагента'])); const pc = s(r['Код товара']); const amt = r2(U.num(r['Непогашенная сумма']));
        const dir = s(r['Направление']) === 'Нам должны' ? 'recv' : 'pay';
        if (pc) {
          const p = P(pc); const q = r3(U.num(r['Количество'])); const pr = U.num(r['Цена']); const full = r2(q * pr);
          const d = addDebt({ cp: c.id, dir, ref: E.ref(imp), li: r._row, pid: p.id, qty: q, price: pr, amount: full, note: s(r['Комментарий']) || 'Начальный долг' });
          if (gt0(full - amt)) addAlloc(d, 'pre', r2(full - amt), E.ref(imp));
        } else {
          addDebt({ cp: c.id, dir, ref: E.ref(imp), li: r._row, amount: amt, note: s(r['Комментарий']) || 'Начальный денежный долг' });
        }
        touched.add(c.id);
      });
      imp.counts = { products: (data['Товары'] || []).length, cps: (data['Контрагенты'] || []).length, lots: st.length, debts: (data['Долги'] || []).length };
      log('Импорт', E.ref(imp), `${fileName}: товаров ${imp.counts.products}, контрагентов ${imp.counts.cps}, партий ${imp.counts.lots}, долгов ${imp.counts.debts}`);
      const offs = [...touched].map((cid) => autoOffset(cid, E.ref(imp))).filter(Boolean);
      return { imp, offs };
    });
  };
})();
