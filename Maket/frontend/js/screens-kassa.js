/* Касса: простой интерфейс продавца.
 * Главная делится на «Действия» (продажа, приход, заказ) и «Просмотр» (история, люди и долги).
 * Всё привязано к человеку (контрагенту), по каждому человеку ведётся история. */
(function () {
  const { html, useState, useEffect, useRef } = window.htmPreact;
  const S = (window.Screens = window.Screens || {});
  const I = (n, s) => html`<${UI.Icon} name=${n} size=${s} />`;
  const upd = () => E.changed();
  const gt0 = U.gt0, r2 = U.r2;

  const PM = E.PAY_LABELS;
  const KIND = {
    sale: { route: 'kassaSale', title: 'Продажа', who: 'Покупатель', needPerson: false, buy: false, stockCheck: false, icon: 'shopping-cart' },
    receipt: { route: 'kassaReceipt', title: 'Приход товара', who: 'Поставщик / сосед', needPerson: true, buy: true, stockCheck: false, icon: 'package-plus' },
    ret: { title: 'Возврат покупателя', who: 'Покупатель', icon: 'arrow-left' },
    order: { route: 'kassaOrder', title: 'Заказ', who: 'Заказчик', needPerson: true, buy: false, stockCheck: false, icon: 'clipboard-list' },
  };
  const payText = (m) => Object.keys(PM).filter((k) => gt0(m && m[k])).map((k) => `${PM[k]} ${U.money(m[k])}`).join(' · ');
  const cleanMethods = (m) => { const o = {}; Object.keys(PM).forEach((k) => { if (U.isNum(m[k]) && gt0(m[k])) o[k] = r2(m[k]); }); return o; };
  const sorted = (a) => a.slice().sort((x, y) => ((y.postedAt || y.at) > (x.postedAt || x.at) ? 1 : -1));
  const docDate = (d) => d.postedAt || d.at;

  /* ---------- общие кусочки ---------- */
  const Top = ({ title, back, onBack, children }) => html`
    <div class="kassa-topbar">
      <button class="btn kbtn" onClick=${onBack || (() => UI.go('kassaHome'))}>← ${back || 'Касса'}</button>
      <h2>${title}</h2>
      <span class="sp"></span>
      ${children}
    </div>`;

  const BalanceChips = ({ cp }) => {
    if (!cp) return null;
    const b = E.balance(cp);
    if (!gt0(b.recv) && !gt0(b.pay)) return null;
    return html`${gt0(b.recv) ? html`<span class="chip debt">должен нам ${U.money(b.recv)}</span>` : null}${gt0(b.pay) ? html`<span class="chip owe">мы должны ${U.money(b.pay)}</span>` : null}`;
  };

  /* Выбор человека: поиск, баланс, быстрое создание. */
  function pickPerson({ title = 'Выберите человека', allowNone, noneText = 'Розничный покупатель (без записи)', onPick }) {
    const Body = () => {
      const [q, setQ] = useState('');
      const list = E.S.cps.filter((c) => U.match(q, c.name, c.phone, c.code)).slice(0, 60);
      const pick = (c) => { UI.close(mid); onPick(c ? c.id : null); };
      return html`<div class="pp-pick">
        <div class="pp-pick-top">
          <input class="in" autofocus placeholder="Поиск: имя или телефон" value=${q} onInput=${(e) => setQ(e.target.value)}
            onKeyDown=${(e) => { if (e.key === 'Enter' && list.length) { e.preventDefault(); pick(list[0]); } }} />
          <button class="btn pri" onClick=${() => UI.cpQuick(q, (c) => pick(c))}>${I('plus')} Новый человек</button>
        </div>
        <div class="pp-pick-list">
          ${allowNone ? html`<div class="pp-pick-row none" onClick=${() => pick(null)}><span class="nm">${noneText}</span></div>` : null}
          ${list.map((c) => html`<div class="pp-pick-row" key=${c.id} onClick=${() => pick(c)}>
            <span class="nm">${c.name}</span><span class="muted">${c.phone}</span><span class="bal"><${BalanceChips} cp=${c.id} /></span></div>`)}
          ${!list.length ? html`<div class="grid-empty">Никого не нашли — нажмите «Новый человек»</div>` : null}
        </div>
      </div>`;
    };
    const mid = UI.modal({ title, body: () => html`<${Body} />` });
    return mid;
  }

  const PersonBar = ({ d, k, onChange }) => {
    const c = d.cp ? E.cp(d.cp) : null;
    return html`<div class="kassa-person ${!c && k.needPerson ? 'need' : ''}">
      <span class="kp-label">${k.who}:</span>
      ${c ? html`<a class="kp-name" onClick=${() => UI.go('kassaPerson', { id: c.id })}>${c.name}</a><span class="muted">${c.phone}</span><${BalanceChips} cp=${c.id} />`
        : html`<span class="kp-name none">${k.needPerson ? 'не выбран' : 'Розничный покупатель'}</span>`}
      <span class="sp"></span>
      ${d.orderId ? null : html`<button class="btn" onClick=${onChange}>${I('users')} ${c ? 'Сменить' : 'Выбрать человека'}</button>`}
      ${c && !k.needPerson && !d.orderId ? html`<button class="btn" title="Продажа без записи на человека" onClick=${() => { d.cp = null; upd(); }}>×</button>` : null}
    </div>`;
  };

  /* ---------- главная ---------- */
  const Tile = ({ icon, title, onClick, badge }) => html`
    <button type="button" class="kassa-tile" onClick=${onClick}>
      ${I(icon, 34)}<span class="kt-title">${title}</span>
      ${badge ? html`<span class="kt-badge">${badge}</span>` : null}
    </button>`;

  function startDoc(kind, cp) {
    const o = cp ? { cp } : {};
    const d = kind === 'sale' ? E.newSale(o) : kind === 'receipt' ? E.newReceipt(o) : E.newOrder(o);
    UI.go(KIND[kind].route, { id: d.id });
  }

  S.kassaHome = () => {
    const open = E.S.orders.filter((o) => E.ORDER_ACTIVE.includes(o.status)).length;
    const drafts = E.S.orders.filter((o) => o.status === 'draft' && o.lines.length).length;
    const unfinishedSale = [...E.S.sales].reverse().find((s) => s.status === 'draft' && s.lines.length && s.author === E.S.user);
    return html`
      <div class="kassa-home">
        <div class="kassa-logo">ХозУчёт</div>
        <div class="kh-section">
          <div class="kassa-grid">
            <${Tile} icon="shopping-cart" title="Продажа" onClick=${() => startDoc('sale')} />
            <${Tile} icon="package-plus" title="Новый товар" onClick=${() => window.open('https://otabek.glasscenter.kg/add', '_blank', 'noopener')} />
            <${Tile} icon="clipboard-list" title="Заказ" onClick=${() => startDoc('order')} />
            <${Tile} icon="eye" title="Просмотр" badge=${open + drafts || ''} onClick=${() => UI.go('kassaView', { tab: 'sales' })} />
          </div>
        </div>
        ${unfinishedSale ? html`<div class="kassa-resume">
          ${I('clipboard-list', 24)}
          <div><b>Незавершённый чек</b><span>${unfinishedSale.no} · ${U.money(E.calcLines(unfinishedSale).total)} сом</span></div>
          <button type="button" class="btn pri" onClick=${() => UI.go('kassaSale', { id: unfinishedSale.id })}>Продолжить</button>
        </div>` : null}
      </div>`;
  };

  /* ---------- документ: продажа / приход / заказ ---------- */
  const docScreen = (kind) => ({ id }) => {
    const t = kind;
    const d = E.doc({ t, id });
    if (!d) return html`<div class="kassa-page"><div class="kassa-content"><div class="grid-empty">Документ не найден</div></div></div>`;
    if (d.status !== 'draft') { setTimeout(() => UI.go('kassaDocView', { t, id }), 0); return null; }
    return html`<${KassaDoc} kind=${kind} d=${d} key=${id} />`;
  };
  S.kassaSale = docScreen('sale');
  S.kassaReceipt = docScreen('receipt');
  S.kassaOrder = docScreen('order');

  /* Диалог товара: количество, цена (при приходе), скидка. */
  function ProductDialog({ p, d, kind, mid }) {
    const k = KIND[kind];
    const ex = d.lines.find((l) => l.pid === p.id);
    const defPrice = k.buy ? p.purchasePrice : E.productPrice(p, d.priceType || 'retail');
    const avail = k.stockCheck ? E.available(p.id, kind === 'sale' ? d.orderId : d.id) : Infinity;
    const [qty, setQty] = useState(ex ? ex.qty : 1);
    const [price, setPrice] = useState(ex ? ex.price : defPrice);
    const [wholesale, setWholesale] = useState(ex && U.isNum(ex.wholesale) ? ex.wholesale : p.wholesalePrice);
    const [retail, setRetail] = useState(ex && U.isNum(ex.retail) ? ex.retail : p.retailPrice);
    const [dVal, setDVal] = useState(ex ? E.calcLines({lines:[ex],dVal:0}).lines[0].lineDisc : 0);
    const discType = 'сум';
    const [showDisc, setShowDisc] = useState(!!(ex && ex.dVal > 0));
    const qtyStep = p.unit === 'шт' ? 1 : 0.1;
    const changeQty = (direction) => {
      const current = U.isNum(qty) ? qty : 0;
      setQty(U.r3(Math.max(qtyStep, current + direction * qtyStep)));
    };
    const probe = E.calcLines({ lines: [{ qty, price, dVal: showDisc ? dVal : 0, dType: discType }], dType: '%', dVal: 0 });
    const amount = probe.lines[0].amount;
    let err = '';
    if (!U.validQty(qty, p.unit)) err = `Количество — ${U.qtyRule(p.unit)}, больше нуля`;
    else if (!U.isNum(price) || price < 0) err = 'Цена — число, не меньше нуля';
    else if (k.buy && (!U.isNum(wholesale) || wholesale < 0 || !U.isNum(retail) || retail < 0)) err = 'Оптовая и розничная цены — числа, не меньше нуля';
    else if (qty > avail + 0.0005) err = `На складе только ${U.qtyU(avail, p.unit)}`;
    else if (probe.lines[0].errs.length) err = probe.lines[0].errs[0].msg;
    const ok = () => {
      if (err) { UI.toast(err, 'err'); return; }
      const line = { pid: p.id, qty: U.r3(qty), price: r2(price) };
      if (!k.buy) { line.dType = discType; line.dVal = showDisc ? dVal || 0 : 0; } else { line.wholesale = r2(wholesale); line.retail = r2(retail); }
      const i = d.lines.findIndex((l) => l.pid === p.id);
      if (i >= 0) d.lines[i] = line; else d.lines.push(line);
      upd(); UI.close(mid);
    };
    return html`<div class="pp" onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } }}>
      <div class="pp-body">
        <div class="pp-left">
          <table class="pp-table">
            ${k.stockCheck ? html`<tr><td class="pp-label">Доступно</td><td class="pp-val"><span class=${avail <= 0 ? 'neg' : ''}>${U.qtyU(avail, p.unit)}</span></td></tr>` : null}
            <tr><td class="pp-label">Количество, ${p.unit}</td><td class="pp-val"><div class="pp-qty-stepper">
              <button type="button" class="pp-step" aria-label="Уменьшить количество" onClick=${() => changeQty(-1)}>−</button>
              <${UI.Num} cls="in pp-qty" autofocus value=${qty} onChange=${setQty} />
              <button type="button" class="pp-step" aria-label="Увеличить количество" onClick=${() => changeQty(1)}>+</button>
            </div></td></tr>
            <tr><td class="pp-label">${k.buy ? 'Закупочная цена' : 'Цена'}</td><td class="pp-val"><${UI.Num} cls="in pp-qty" value=${price} onChange=${setPrice} /></td></tr>
            ${k.buy ? html`<tr><td class="pp-label">Оптовая цена</td><td class="pp-val"><${UI.Num} cls="in pp-qty" value=${wholesale} onChange=${setWholesale} /></td></tr>
            <tr><td class="pp-label">Розничная цена</td><td class="pp-val"><${UI.Num} cls="in pp-qty" value=${retail} onChange=${setRetail} /></td></tr>` : null}
            ${!k.buy ? html`<tr><td class="pp-label">Скидка</td><td class="pp-val">
              <select class="in pp-discount-select" value=${showDisc ? 'yes' : 'no'} onChange=${(e) => { setShowDisc(e.target.value === 'yes'); if (e.target.value !== 'yes') setDVal(0); }}><option value="no" selected=${!showDisc}>Без скидки</option><option value="yes" selected=${showDisc}>Со скидкой</option></select>
            </td></tr>
            ${showDisc ? html`<tr class="pp-discount-row"><td class="pp-label">Размер скидки</td><td class="pp-val"><div class="pp-discount-value"><${UI.Num} cls="in pp-qty" aria-label="Размер скидки" value=${dVal} onChange=${setDVal} /><span>сом</span></div></td></tr>` : null}` : null}
          </table>
        </div>
        <div class="pp-photo">${UI.productPhoto(p, 240)}</div>
      </div>
      ${err ? html`<div class="note err">${err}</div>` : null}
      <div class="pp-total">${U.money(amount)} сом</div>
      <div class="pp-btns">
        <button class="btn pri pp-ok" onClick=${ok}>${ex ? 'Сохранить' : 'Добавить'}</button>
        ${ex ? html`<button class="btn danger" onClick=${() => { d.lines.splice(d.lines.findIndex((l) => l.pid === p.id), 1); upd(); UI.close(mid); }}>Убрать</button>` : null}
        <button class="btn" onClick=${() => UI.close(mid)}>Закрыть</button>
      </div>
    </div>`;
  }

  /* Все размеры и их количества редактируются за один проход. */
  function VariantDialog({ group, d, mid, focusPid }) {
    const box = useRef();
    const photoProduct = group.products.find((p) => p.photo) || group.products[0];
    const existing = new Map(group.products.map((p) => [p.id, d.lines.find((l) => l.pid === p.id)]));
    const hasExisting = [...existing.values()].some(Boolean);
    const [quantities, setQuantities] = useState(() => Object.fromEntries(group.products.map((p) => [p.id,
      existing.get(p.id)?.qty || (group.products.length === 1 && !hasExisting ? 1 : 0),
    ])));
    const [pricing, setPricing] = useState(() => Object.fromEntries(group.products.map((p) => {
      const line = existing.get(p.id) || E.lineFromProduct(p, undefined, d.priceType || 'retail');
      return [p.id, { price: line.price, dType: 'сум', dVal: E.calcLines({lines:[line],dVal:0}).lines[0].lineDisc, neighbor:line.neighbor ? U.clone(line.neighbor) : null }];
    })));
    const [query, setQuery] = useState('');
    const [error, setError] = useState('');
    const visible = group.products.filter((p) => U.match(query, p.variantName, p.code));
    const setQty = (pid, value) => { setQuantities((prev) => ({ ...prev, [pid]: value })); setError(''); };
    const step = (p, direction) => {
      const value = U.isNum(quantities[p.id]) ? quantities[p.id] : 0;
      setQty(p.id, U.r3(Math.max(0, value + direction * (p.unit === 'шт' ? 1 : 0.1))));
    };
    const rowLine = (p) => ({ ...(existing.get(p.id) || E.lineFromProduct(p, undefined, d.priceType || 'retail')), ...pricing[p.id], qty: quantities[p.id] });
    const selected = group.products.filter((p) => U.isNum(quantities[p.id]) && quantities[p.id] > 0);
    const invalid = group.products.find((p) => !U.isNum(quantities[p.id]) || quantities[p.id] < 0 || (quantities[p.id] > 0 && !U.validQty(quantities[p.id], p.unit)));
    const total = E.calcLines({ lines: selected.map(rowLine), dType: '%', dVal: 0 }).total;
    const changed = group.products.some((p) => {
      const line = existing.get(p.id) || E.lineFromProduct(p, undefined, d.priceType || 'retail');
      return quantities[p.id] !== (existing.get(p.id)?.qty || 0) || (quantities[p.id] > 0 && (['price', 'dType', 'dVal'].some((k) => pricing[p.id][k] !== (line[k] || (k === 'dType' ? 'сум' : 0))) || JSON.stringify(pricing[p.id].neighbor) !== JSON.stringify(line.neighbor || null)));
    });
    const save = () => {
      if (invalid) { setError(`«${invalid.variantName || invalid.name}»: ${U.qtyRule(invalid.unit)} или 0, чтобы убрать размер.`); return; }
      try { E.setVariantQuantities(d, group.products, quantities, pricing); UI.close(mid); }
      catch (e) { setError(e.message); }
    };
    const keyDown = (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (changed) save(); return; }
      if (!e.target.matches('[data-variant-qty]')) return;
      if (!['Enter', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      const fields = [...box.current.querySelectorAll('[data-variant-qty]')];
      const next = fields[fields.indexOf(e.target) + (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? -1 : 1)];
      if (next) { next.focus(); next.select(); }
      else if (e.key === 'Enter') box.current.querySelector('[data-variant-save]').focus();
    };
    useEffect(() => {
      const field = focusPid && box.current.querySelector(`[data-pid="${focusPid}"]`);
      if (field) { field.focus(); field.select(); field.scrollIntoView({ block: 'nearest' }); }
    }, []);
    return html`<div class="variant-picker" ref=${box} onKeyDown=${keyDown}>
      <div class="variant-summary">
        <button type="button" class="variant-photo product-photo-open" aria-label=${`Открыть фото: ${group.name}`} disabled=${!photoProduct.photo} onClick=${() => UI.openProductPhoto(photoProduct)}>${UI.productPhoto(photoProduct, 480)}</button>
      </div>
      <div class="variant-tools">
        <span class="variant-count">${group.products.length} ${U.plural(group.products.length, 'размер', 'размера', 'размеров')}</span>
        ${group.products.length > 8 ? html`<input class="in variant-search" type="search" aria-label="Найти размер" placeholder="Найти размер…" value=${query} onInput=${(e) => setQuery(e.target.value)} />` : null}
        <span class="variant-tools-sp"></span>
        <button type="button" class="btn sm" onClick=${() => { setQuantities((prev) => ({ ...prev, ...Object.fromEntries(visible.map((p) => [p.id, U.r3((U.isNum(prev[p.id]) ? prev[p.id] : 0) + 1)])) })); setError(''); }}>+1 ${query ? 'найденным' : 'всем'}</button>
        <button type="button" class="btn sm" onClick=${() => { setQuantities(Object.fromEntries(group.products.map((p) => [p.id, 0]))); setError(''); }}>Очистить</button>
      </div>
      <div class="variant-table-wrap">
        <table class="variant-table">
          <thead><tr><th>Размер</th><th class="r">Цена, сом</th><th class="c">Количество</th><th class="r">Сумма, сом</th></tr></thead>
          <tbody>${visible.map((p) => {
            const line = rowLine(p);
            const valid = U.isNum(line.qty) && (line.qty === 0 || U.validQty(line.qty, p.unit));
            const amount = valid && line.qty > 0 ? E.calcLines({ lines: [line], dType: '%', dVal: 0 }).total : 0;
            const editTerms = (borrow = false) => UI.priceTerms(p,borrow && !line.neighbor ? {...line,neighbor:{cp:null,qty:Math.max(1,line.qty || 0),price:0}} : line,(terms) => {
              setPricing((prev) => ({...prev,[p.id]:terms}));
              if (terms.neighbor && !quantities[p.id]) setQty(p.id,terms.neighbor.qty);
            });
            return html`<tr key=${p.id} class="${line.qty > 0 ? 'selected' : ''} ${!valid ? 'invalid' : ''}">
              <td><label class="variant-name" for=${`variant-qty-${p.id}`}>${p.variantName || p.name}</label>
              </td>
              <td class="variant-price">${E.prototypeMode && UI.priceTerms ? html`<button type="button" class="variant-price-edit" aria-label=${`Цена и скидка: ${E.productLabel(p)}`} onClick=${() => editTerms()}>${U.money(line.price)}</button>` : U.money(line.price)}${line.dVal > 0 ? html`<small>−${U.money(E.calcLines({lines:[line],dVal:0}).lines[0].lineDisc)} сом</small>` : null}${E.prototypeMode ? html`<button type="button" class="variant-neighbor-edit ${line.neighbor ? 'selected' : ''}" aria-label=${`У соседа: ${E.productLabel(p)}`} onClick=${() => editTerms(true)}>${line.neighbor ? `${E.cpName(line.neighbor.cp)} · ${U.qtyU(line.neighbor.qty,p.unit)}` : 'У соседа'}</button>` : null}</td>
              <td><div class="variant-stepper">
                <button type="button" tabindex="-1" aria-label=${`Уменьшить ${p.variantName || p.name}`} disabled=${!(line.qty > 0)} onClick=${() => step(p, -1)}>−</button>
                <${UI.Num} id=${`variant-qty-${p.id}`} cls="in variant-qty" data-variant-qty="1" data-pid=${p.id} aria-label=${`Количество ${p.variantName || p.name}`} aria-invalid=${!valid ? 'true' : 'false'} bad=${!valid} value=${line.qty} onChange=${(v) => setQty(p.id, v)} />
                <button type="button" tabindex="-1" aria-label=${`Увеличить ${p.variantName || p.name}`} onClick=${() => step(p, 1)}>+</button>
              </div></td>
              <td class="variant-amount">${line.qty > 0 && valid ? U.money(amount) : '—'}</td>
            </tr>`;
          })}</tbody>
        </table>
        ${!visible.length ? html`<div class="grid-empty">Размер не найден</div>` : null}
      </div>
      ${error ? html`<div class="variant-error" role="alert">${error}</div>` : null}
      <div class="variant-footer">
        <div class="variant-totals"><span>Итого</span><strong>${U.money(total)} <small>сом</small></strong></div>
        <div class="variant-footer-actions"><button class="btn" onClick=${() => UI.close(mid)}>Отмена</button><button class="btn pri" data-variant-save="1" disabled=${!changed || !!invalid} onClick=${save}>${hasExisting ? 'Обновить' : 'Добавить'}</button></div>
      </div>
    </div>`;
  }

  function KassaDoc({ kind, d }) {
    const k = KIND[kind];
    const [q, setQ] = useState('');
    const [cat, setCat] = useState('');
    const [limit, setLimit] = useState(80);
    useEffect(() => setLimit(80), [q, cat]);
    const calc = E.calcLines(d);
    const cartGroups = E.documentProductGroups(d, calc);
    const cats = E.categories();
    const allGroups = E.productGroups(E.S.products.filter((p) => p.active));
    const filteredGroups = allGroups.filter((g) => (!cat || g.category === cat) && g.products.some((p) => U.match(q, p.name, p.variantName, p.category, p.code)));
    const groups = filteredGroups.slice(0, limit);
    const needWho = k.needPerson && !d.cp;
    const locked = kind === 'sale' && !!d.orderId; // продажа по заказу: состав и цены — как в заказе

    const choose = () => (E.prototypeMode && UI.pickCustomer ? UI.pickCustomer : pickPerson)({ title: k.who, allowNone: !k.needPerson, onPick: (id) => { d.cp = id; upd(); } });
    useEffect(() => { if (needWho) choose(); }, []);

    const openProduct = (p) => {
      if (needWho) { choose(); return; }
      if (locked) { UI.toast('Это продажа по заказу: состав менять нельзя. Нужен другой состав — верните заказ в «Новые» и измените его.', 'err'); return; }
      UI.modal({ title: E.productLabel(p), size: 'product', body: (mid) => html`<${ProductDialog} p=${p} d=${d} kind=${kind} mid=${mid} />` });
    };
    const openGroup = (group, focusPid) => {
      if (k.buy) { openProduct(group.products[0]); return; }
      if (needWho) { choose(); return; }
      if (locked) { UI.toast('Это продажа по заказу: состав менять нельзя.', 'err'); return; }
      UI.modal({ title: group.name, size: 'variants', body: (mid) => html`<${VariantDialog} group=${group} d=${d} mid=${mid} focusPid=${focusPid} />` });
    };
    const editCartGroup = (cartGroup, focusPid) => {
      const catalogueGroup = allGroups.find((g) => g.key === cartGroup.key);
      const products = [...new Map([...(catalogueGroup?.products || []), ...cartGroup.products].map((p) => [p.id, p])).values()];
      openGroup({ ...cartGroup, products }, focusPid);
    };
    const setPriceType = (pt) => { d.priceType = pt; d.lines.forEach((l) => { const p = E.product(l.pid); if (p) l.price = E.productPrice(p, pt); }); upd(); };

    const leave = async () => {
      if (E.prototypeMode) { if (!d.lines.length) E.deleteDraft(E.ref(d)); else E.changed(); UI.go('kassaHome'); return; }
      if (kind === 'order') { if (!d.lines.length && !d.cp) E.deleteDraft(E.ref(d)); UI.go('kassaHome'); return; }
      if (!d.lines.length || await UI.confirm(`Отменить ${kind === 'sale' ? 'текущую продажу' : 'приход'}? Введённые товары пропадут.`, { ok: 'Да, отменить', danger: true })) {
        E.deleteDraft(E.ref(d));
        UI.go('kassaHome');
      }
    };

    const finish = () => {
      if (needWho) { choose(); return; }
      if (!d.lines.length) { UI.toast('Добавьте хотя бы один товар', 'err'); return; }
      if (kind === 'order') { orderSaveDialog(d); return; }
      UI.modal({ title: kind === 'sale' ? 'Оплата' : 'Оплата поставщику', size: 'payment', body: (mid) => html`<${PayDialog} d=${d} kind=${kind} mid=${mid} />` });
    };

    return html`
      <div class="kassa-page">
        <${Top} title=${html`${I(k.icon, 18)} ${k.title} ${d.no}`} back=${kind === 'order' && !E.prototypeMode ? 'Касса (черновик сохранится)' : 'Касса'} onBack=${leave}>
          ${E.prototypeMode && kind === 'sale' && !locked ? html`<button class="btn" disabled=${!d.lines.length} onClick=${() => { E.changed(); UI.go('kassaHome'); UI.toast('Чек отложен', 'ok'); }}>Отложить</button><button class="btn" disabled=${!d.lines.length} onClick=${() => { const order = E.saleToOrder(d.id); UI.go('kassaOrder', { id: order.id }); }}>В заказ</button>` : null}
          ${E.prototypeMode && !locked && d.lines.length ? html`<button class="btn danger" onClick=${async () => { if (await UI.confirm(`Удалить ${kind === 'order' ? 'черновик заказа' : 'этот черновик'}?`, {ok:'Удалить',danger:true})) { E.deleteDraft(E.ref(d)); UI.go('kassaHome'); } }}>Удалить</button>` : null}
          ${!k.buy && !locked ? html`<${UI.Seg} value=${d.priceType || 'retail'} onChange=${setPriceType} opts=${E.PRICE_OPTS} />` : null}
        <//>
        <${PersonBar} d=${d} k=${k} onChange=${choose} />
        ${locked ? html`<div class="note" style="margin:0">${E.prototypeMode ? `Заказ ${E.refNo({ t: 'order', id: d.orderId })}` : `Продажа по заказу ${E.refNo({ t: 'order', id: d.orderId })}: товары и цены — как в заказе. Осталось принять оплату.`}</div>` : null}
        <div class="kassa-split">
          <div class="kassa-products-col">
            <div class="kassa-search">
              <input value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Поиск товара…" autofocus
                onKeyDown=${(e) => { if (e.key === 'Enter' && groups.length === 1) { e.preventDefault(); openGroup(groups[0]); } }} />
            </div>
            ${cats.length ? html`<div class="cat-chips"><button class="chipbtn ${!cat ? 'on' : ''}" onClick=${() => setCat('')}>Все</button>${cats.map((c) => html`<button class="chipbtn ${cat === c ? 'on' : ''}" key=${c} onClick=${() => setCat(c)}>${c}</button>`)}</div>` : null}
            <div class="kassa-product-list">
              ${groups.map((group) => {
                const prices = group.products.map((p) => k.buy ? p.purchasePrice : E.productPrice(p, d.priceType || 'retail'));
                const minPrice = Math.min(...prices), maxPrice = Math.max(...prices);
                const groupIds = new Set(group.products.map((p) => p.id));
                const inCart = d.lines.some((l) => groupIds.has(l.pid));
                return html`<div key=${group.key} class="kassa-row ${inCart ? 'active' : ''}" role="button" tabindex="0" aria-label=${`Выбрать размеры: ${group.name}`} onClick=${() => openGroup(group)} onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openGroup(group); } }}>
                  <div class="kassa-row-photo">${UI.productPhoto(group.products.find((p) => p.photo) || group.products[0], 240)}</div>
                  <div class="kassa-row-name">${group.name}</div>
                  <div class="kassa-row-info">
                    <span class="kassa-row-price">${minPrice === maxPrice ? U.money(minPrice) : `${U.money(minPrice)}–${U.money(maxPrice)}`} <small>сом</small></span>
                    <span class="kassa-row-sizes">${group.products.length} ${U.plural(group.products.length, 'размер', 'размера', 'размеров')}</span>
                  </div>
                </div>`;
              })}
              ${!groups.length ? html`<div class="grid-empty">Товары не найдены</div>` : null}
              ${filteredGroups.length > groups.length ? html`<button type="button" class="btn kassa-load-more" onClick=${() => setLimit((value) => value + 80)}>Показать ещё</button>` : null}
            </div>
          </div>
          <div class="kassa-cart-col">
            <div class="kassa-cart-title">${I(k.icon, 18)} ${kind === 'sale' ? 'Чек' : kind === 'receipt' ? 'Принимаем' : 'Заказ'} <span class="muted">${cartGroups.length} ${U.plural(cartGroups.length, 'товар', 'товара', 'товаров')}</span></div>
            <div class="kassa-cart-lines">
              ${d.lines.length ? html`<div class="cart-receipt-columns"><span>Товар / размер</span><span>Кол-во</span><span>Сумма</span></div>` : null}
              ${cartGroups.map((g) => {
                return html`<section class="cart-product" key=${g.key} aria-label=${`Товар в чеке: ${g.name}`}>
                  <div class="cart-product-head">
                    <button type="button" class="cart-product-open" onClick=${() => editCartGroup(g)} aria-label=${`Изменить размеры: ${g.name}`}>
                      <b>${g.name}</b>
                    </button>
                    ${locked ? null : html`<button class="xbtn cart-product-remove" title="Убрать товар со всеми размерами" aria-label=${`Убрать товар ${g.name}`} onClick=${() => { const ids = new Set(g.items.map((item) => item.line.pid)); d.lines = d.lines.filter((l) => !ids.has(l.pid)); upd(); }}>×</button>`}
                  </div>
                  <div class="cart-product-sizes">${g.items.map((item) => {
                    const l = item.line, p = item.product;
                    return html`<div class="cart-size" key=${item.index}>
                      <button type="button" class="cart-size-open" onClick=${() => editCartGroup(g, p.id)} aria-label=${`Изменить ${g.name}, размер ${p.variantName || 'основной'}`}>
                        <span class="cart-size-name">${p.variantName || 'Основной'}</span><span class="cart-size-qty">${U.qtyU(l.qty, p.unit)}</span><span class="cart-size-amount">${U.money(item.amount)}</span>
                      </button>
                    </div>`;
                  })}</div>
                </section>`;
              })}
              ${!d.lines.length ? html`<div class="kassa-cart-empty">${needWho ? 'Сначала выберите человека' : 'Выберите товар из списка'}</div>` : null}
            </div>
            ${d.lines.length ? html`
              ${gt0(calc.disc) ? html`<div class="cart-discount-total"><span>Скидка</span><b>−${U.money(calc.disc)} сом</b></div>` : null}
              <div class="kassa-cart-total"><span>Итого:</span><span>${U.money(calc.total)} сом</span></div>
              <button class="kassa-finish" onClick=${finish}>${I('check', 20)} ${kind === 'sale' ? 'Принять оплату' : kind === 'receipt' ? 'Далее' : 'Сохранить заказ'}</button>
            ` : null}
          </div>
        </div>
      </div>`;
  }

  /* ---------- оплата: наличные / банк / в долг ---------- */
  function PayDialog({ d, kind, mid }) {
    const sale = kind === 'sale';
    const calc = E.calcLines(d);
    const total = calc.total;
    const [m, setM] = useState(sale ? { cash: total, mbank: 0 } : { cash: 0, mbank: 0 }); // приход по умолчанию в долг
    const num = (v) => (U.isNum(v) ? v : 0);
    const paid = r2(num(m.cash) + num(m.mbank));
    const debt = r2(total - paid);
    const invalid = Object.values(m).some((v) => !U.isNum(v) || v < 0);
    const over = paid > total + 0.0001;
    const needCp = gt0(debt) && !d.cp;
    const setOne = (k, v) => setM((prev) => ({ ...prev, [k]: v }));
    const quick = (k) => setM({ cash: 0, mbank: 0, ...(k ? { [k]: total } : {}) });
    const only = (k) => paid > 0 && U.eq(num(m[k]), total) && Object.keys(PM).every((x) => x === k || !gt0(num(m[x])));
    const allDebt = !gt0(paid);
    const c = d.cp ? E.cp(d.cp) : null;
    const bal = d.cp ? E.balance(d.cp) : null;
    const chooseCp = () => (E.prototypeMode ? UI.pickCustomer : pickPerson)({ title: sale ? 'Покупатель' : 'Поставщик', onPick: (id) => { d.cp = id; upd(); } });

    const ok = () => {
      if (invalid || over || needCp) return;
      d.paid = paid; d.payMethods = cleanMethods(m);
      if (sale) d.transfer = allDebt && !!d.cp;
      UI.close(mid);
      const res = UI.run(() => (sale ? E.postSale(d.id) : E.postReceipt(d.id)));
      if (res === undefined) return;
      UI.go('kassaDocView', { t: kind, id: d.id });
      doneDialog(kind, d);
    };
    return html`<div class="pay-modal checkout" onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'BUTTON') { e.preventDefault(); ok(); } }}>
      <div class="checkout-total"><span>${sale ? 'К оплате' : 'Сумма закупки'}</span><strong>${U.money(total)} <small>сом</small></strong></div>
      <div class="checkout-methods" role="group" aria-label="Способ оплаты">
        <button type="button" class=${only('cash') ? 'selected' : ''} aria-pressed=${only('cash')} onClick=${() => quick('cash')}>Наличные</button>
        <button type="button" class=${only('mbank') ? 'selected' : ''} aria-pressed=${only('mbank')} onClick=${() => quick('mbank')}>МБанк</button>
        <button type="button" class=${allDebt ? 'selected' : ''} aria-pressed=${allDebt} onClick=${() => quick(null)}>В долг</button>
      </div>
      <div class="checkout-inputs">
        ${Object.keys(PM).map((k, i) => html`<div class="checkout-field"><label for=${`checkout-${mid}-${k}`}>${PM[k]}</label><div class="checkout-input-wrap"><${UI.Num} id=${`checkout-${mid}-${k}`} aria-label=${PM[k]} cls="in checkout-input" autofocus=${i === 0} bad=${!U.isNum(m[k]) || m[k] < 0} aria-invalid=${!U.isNum(m[k]) || m[k] < 0} value=${m[k]} onChange=${(v) => setOne(k, v)} /><span>сом</span></div></div>`)}
      </div>
      ${invalid || over ? html`<div class="checkout-error" role="alert">${invalid ? 'Введите сумму не меньше нуля.' : 'Оплата больше суммы чека.'}</div>` : null}
      ${!invalid && gt0(debt) ? html`<div class="checkout-summary">
        ${gt0(paid) ? html`<div><span>${sale ? 'Оплачено сейчас' : 'Заплатили сейчас'}</span><b>${U.money(paid)} сом</b></div>` : null}
        <div class="checkout-debt"><span>В долг</span><b>${U.money(debt)} сом</b></div>
      </div>` : null}
      ${!invalid && gt0(debt) ? html`<div class="checkout-person ${needCp ? 'need' : ''}">
        <div><span>${sale ? 'Покупатель' : 'Поставщик'}</span><strong>${c ? c.name : 'Не выбран'}</strong>
          ${c && bal ? html`<small>${sale ? 'Долг после продажи' : 'Наш долг после оплаты'}: ${U.money(r2((sale ? bal.recv : bal.pay) + debt))} сом</small>` : null}
        </div>
        <button type="button" class="btn" onClick=${chooseCp}>${c ? 'Сменить' : 'Выбрать'}</button>
      </div>` : null}
      <div class="checkout-footer">
        <button type="button" class="btn" onClick=${() => UI.close(mid)}>Назад</button>
        <button type="button" class="btn pri" disabled=${invalid || over || needCp} onClick=${ok}>Завершить</button>
      </div>
    </div>`;
  }

  function doneDialog(kind, d) {
    if (E.prototypeMode && UI.showSaleDone) return UI.showSaleDone(kind, d);
    const debt = r2((d.total != null ? d.total : d.goods) - d.paid);
    const Body = () => html`<div class="done">
      <div class="done-ico">${I('check', 40)}</div>
      <div class="done-t">${kind === 'sale' ? 'Продажа' : 'Приход'} ${d.no} ${kind === 'sale' ? 'проведена' : 'проведён'}</div>
      <div class="done-s">${E.cpName(d.cp)}</div>
      <div class="done-sum">${U.money(kind === 'sale' ? d.total : d.goods)} сом</div>
      ${gt0(d.paid) ? html`<div class="muted">${kind === 'sale' ? 'Оплачено' : 'Заплатили'}: ${payText(d.payMethods) || U.money(d.paid)}</div>` : null}
      ${gt0(debt) ? html`<div class="warn-t b">${kind === 'sale' ? 'В долг' : 'Мы должны'}: ${U.money(debt)}</div>` : null}
      <div class="done-btns">
        <button class="btn pri big" autofocus onClick=${() => printDoc(d, kind, 'client')}>${I('printer')} Печать накладной</button>
        <button class="btn big" onClick=${() => { UI.close(mid); startDoc(kind); }}>Новая ${kind === 'sale' ? 'продажа' : 'приёмка'}</button>
        <button class="btn big" onClick=${() => { UI.close(mid); UI.go('kassaHome'); }}>На главную</button>
      </div>
    </div>`;
    const mid = UI.modal({ title: 'Готово', body: () => html`<${Body} />` });
  }

  /* ---------- заказ: сохранить + накладные ---------- */
  function orderSaveDialog(d) {
    if (E.prototypeMode && UI.saveOrderDialog) return UI.saveOrderDialog(d);
    const Body = () => {
      const [comment, setComment] = useState(d.comment || '');
      const [reserve, setReserve] = useState(false);
      const calc = E.calcLines(d);
      const save = (print) => {
        d.comment = comment; upd(); E.orderSaved(d.id);
        if (reserve) { if (UI.run(() => { E.setOrderStatus(d.id, 'assembling'); return true; }) === undefined) return; }
        UI.close(mid);
        UI.toast(`Заказ ${d.no} сохранён${reserve ? ', товар зарезервирован' : ' — в колонке «Новые»'}`, 'ok');
        UI.go('kassaDocView', { t: 'order', id: d.id });
        if (print) printChoice(d);
      };
      return html`<div class="pay-modal">
        <div class="pay-row big"><span>${E.cpName(d.cp)}</span><span class="v">${U.money(calc.total)} сом</span></div>
        <div class="pay-row"><span>Позиций</span><span class="v">${d.lines.length}</span></div>
        <label class="pay-hint" style="display:block;margin-top:8px">Комментарий (срок, доставка, пожелания)</label>
        <textarea class="in" rows="3" value=${comment} onInput=${(e) => setComment(e.target.value)}></textarea>
        <label class="chk" style="margin-top:8px"><input type="checkbox" checked=${reserve} onChange=${(e) => setReserve(e.target.checked)} /> Сразу передать заказ на сборку</label>
        <div class="pay-footer">
          <span class="sp"></span>
          <button class="btn pri big" onClick=${() => save(true)}>${I('printer')} Сохранить и печатать</button>
          <button class="btn big" onClick=${() => save(false)}>Сохранить</button>
          <button class="btn" onClick=${() => UI.close(mid)}>Назад</button>
        </div>
      </div>`;
    };
    const mid = UI.modal({ title: `Сохранить заказ ${d.no}`, body: () => html`<${Body} />` });
  }

  /* ---------- печать: накладная клиенту / лист работнику ---------- */
  const TITLES = {
    sale: { client: 'Накладная' },
    receipt: { client: 'Приходная накладная' },
    order: { client: 'Накладная на заказ', worker: 'Лист сборки заказа' },
  };
  const invoiceStatus = (d, kind) => kind === 'order'
    ? (d.status === 'cancelled' ? 'Отменён' : d.status === 'done' ? 'Доставлен' : d.shipped ? 'Отправлен' : { draft: 'Новый', assembling: 'На сборке', assembled: 'Собран' }[d.status] || E.STATUS[d.status])
    : E.STATUS[d.status] || d.status;
  const invoiceQuantity = (group) => {
    const units = new Map();
    group.items.forEach(({ line, product }) => units.set(product.unit, U.r3((units.get(product.unit) || 0) + line.qty)));
    return [...units].map(([unit, qty]) => `${U.qty(qty)} ${unit}`).join(' · ');
  };
  function Invoice({ d, kind, variant }) {
    const calc = E.calcLines(d);
    const groups = E.documentProductGroups(d, calc);
    const worker = variant === 'worker';
    const anyDisc = gt0(calc.disc);
    const c = d.cp ? E.cp(d.cp) : null;
    const total = calc.total;
    const sourceSale = kind === 'order' && d.saleId ? E.doc({ t: 'sale', id: d.saleId }) : null;
    const paymentSource = sourceSale || d;
    const paid = r2(paymentSource.paid || 0);
    const debt = r2(Math.max(0, total - paid));
    const columns = worker ? 4 : anyDisc ? 6 : 5;
    const lineCount = d.lines.length;
    return html`<div class="sheet invoice-sheet ${worker ? 'invoice-worker' : 'invoice-client'}">
      <div class="invoice-heading"><div><span class="invoice-brand">ХозУчёт</span><h1>${TITLES[kind][variant]}</h1></div><div class="invoice-doc-no"><b>№ ${d.no}</b><span>${invoiceStatus(d, kind)}</span></div></div>
      <div class="invoice-meta">
        <div><span>${kind === 'order' ? 'Дата заказа' : 'Дата документа'}</span><b>${U.fmtDT(docDate(d))}</b></div>
        <div class="invoice-person"><span>${kind === 'receipt' ? 'Поставщик' : kind === 'order' ? 'Заказчик' : 'Покупатель'}</span><b>${c ? c.name : 'Розничный покупатель'}</b>${c?.phone ? html`<small>${c.phone}</small>` : null}</div>
        <div><span>${worker ? 'Передал на сборку' : 'Продавец'}</span><b>${d.postedBy || d.author || '—'}</b></div>
      </div>
      ${d.comment ? html`<div class="invoice-comment"><b>${worker ? 'Задание / доставка' : 'Комментарий'}</b><span>${d.comment}</span></div>` : null}
      ${worker ? html`<p class="invoice-purpose">Соберите указанные размеры и отметьте каждую готовую строку.</p>` : null}
      <table class="invoice-table">
        <thead><tr><th class="invoice-size-col">Размер / вариант</th><th class="n invoice-qty-col">Кол-во</th><th class="invoice-unit-col">Ед.</th>
          ${worker ? html`<th class="invoice-check-col">Собрано</th>` : html`<th class="n invoice-money-col">Цена, сом</th>${anyDisc ? html`<th class="n invoice-money-col">Скидка, сом</th>` : null}<th class="n invoice-money-col">Сумма, сом</th>`}</tr></thead>
        ${groups.map((group, groupIndex) => html`<tbody class="invoice-product" key=${group.key}>
          <tr class="invoice-product-heading"><td colspan=${columns}><div><b><span class="invoice-product-number">${groupIndex + 1}.</span> ${group.name}</b><span>${group.products.length} ${U.plural(group.products.length, 'размер', 'размера', 'размеров')}</span></div></td></tr>
          ${group.items.map(({ line, product, amount, discount }, index) => html`<tr class="invoice-size-row ${index === 0 ? 'invoice-first-size' : ''}" key=${`${group.key}-${index}`}>
            <td class="invoice-size-name">${product.variantName || 'Без размера'}</td><td class="n invoice-quantity">${U.qty(line.qty)}</td><td class="invoice-unit">${product.unit}</td>
            ${worker ? html`<td class="invoice-check-cell"><span class="invoice-check" aria-label="Отметка о сборке"></span></td>` : html`<td class="n">${U.money(line.price)}</td>${anyDisc ? html`<td class="n">${gt0(discount) ? U.money(discount) : '—'}</td>` : null}<td class="n">${U.money(amount)}</td>`}
          </tr>`)}
          <tr class="invoice-product-total"><td colspan=${worker ? columns : columns - 1}>Итого по товару <span>${invoiceQuantity(group)}</span></td>${worker ? null : html`<td class="n"><b>${U.money(group.total)}</b></td>`}</tr>
        </tbody>`)}
      </table>
      <div class="invoice-bottom">
        <div class="invoice-counts">${groups.length} ${U.plural(groups.length, 'товар', 'товара', 'товаров')} · ${lineCount} ${U.plural(lineCount, 'строка размера', 'строки размеров', 'строк размеров')}${worker ? html`<p>Сборщик ____________________</p><p>Проверил ____________________</p>` : null}</div>
        ${worker ? null : html`<div class="invoice-totals">
          ${anyDisc ? html`<div><span>Сумма без скидки</span><b>${U.money(calc.gross)}</b></div><div><span>Скидка</span><b>−${U.money(calc.disc)}</b></div>` : null}
          <div class="invoice-grand-total"><span>Итого</span><b>${U.money(total)} сом</b></div>
          ${d.status !== 'cancelled' ? html`
            <div><span>${kind === 'receipt' ? 'Заплатили' : 'Оплачено'}</span><b>${U.money(paid)} сом</b></div>
            ${payText(paymentSource.payMethods) ? html`<p class="invoice-pay-methods">${payText(paymentSource.payMethods)}</p>` : null}
            ${kind === 'order' && !gt0(paid) ? html`<p class="invoice-payment-state">Заказ не оплачен</p>` : null}
            <div class="invoice-due"><span>${kind === 'order' ? 'К оплате при получении' : kind === 'receipt' ? 'Мы должны' : 'К оплате'}</span><b>${U.money(debt)} сом</b></div>` : null}
        </div>`}
      </div>
      <div class="sign invoice-sign">${worker
        ? html`<div>Собрал (подпись)</div><div>Проверил (подпись)</div><div>Дата, время сборки</div>`
        : kind === 'receipt' ? html`<div>Принял (подпись)</div><div>Сдал (${c ? c.name : 'подпись'})</div>`
        : html`<div>Отпустил (подпись)</div><div>Получил (${c ? c.name : 'подпись'})</div>`}</div>
    </div>`;
  }
  function printDoc(d, kind, variant) {
    const mid = UI.modal({
      title: `${TITLES[kind][variant]} — ${d.no}`, size: 'wide',
      body: () => html`<div class="preview-bg"><${Invoice} d=${d} kind=${kind} variant=${variant} /></div>`,
      foot: () => html`<button class="btn pri big" autofocus onClick=${() => UI.print(html`<${Invoice} d=${d} kind=${kind} variant=${variant} />`)}>${I('printer')} Печать</button><button class="btn" onClick=${() => UI.close(mid)}>Закрыть</button>`,
    });
  }
  UI.printDoc = printDoc;
  // для заказа: выбрать, какую накладную печатать
  function printChoice(d) {
    const mid = UI.modal({
      title: 'Какую накладную печатать?',
      body: () => html`<div class="done-btns">
        <button class="btn pri big" autofocus onClick=${() => { UI.close(mid); printDoc(d, 'order', 'client'); }}>${I('printer')} Для клиента (с ценами)</button>
        <button class="btn big" onClick=${() => { UI.close(mid); printDoc(d, 'order', 'worker'); }}>${I('printer')} Для работника (лист сборки)</button>
      </div>`,
    });
  }

  /* ---------- Этапы заказа (канбан): Новые → Собираем → Отправлено → Доставлено ---------- */
  const STAGES = [{ k: 'new', t: 'Новые' }, { k: 'assembling', t: 'Собираем' }, { k: 'shipped', t: 'Отправлено' }, { k: 'delivered', t: 'Доставлено' }];
  const stageOf = (o) => (o.status === 'done' ? 'delivered' : E.ORDER_ACTIVE.includes(o.status) ? (o.shipped ? 'shipped' : 'assembling') : 'new');
  const stageName = (o) => STAGES.find((x) => x.k === stageOf(o)).t;
  function moveOrder(o, to) {
    const from = stageOf(o);
    if (from === to) return;
    if (from === 'delivered') { UI.toast('Заказ уже доставлен и оплачен — продажа проведена', 'err'); return; }
    const set = (st) => UI.run(() => { E.setOrderStatus(o.id, st); return true; }) !== undefined;
    if (to === 'new') { if (o.status !== 'draft' && !set('draft')) return; }
    else {
      if (o.status === 'draft' && !set('assembling')) return; // резерв товара при начале сборки
      if (to === 'delivered') { const sl = UI.run(() => E.saleFromOrder(o.id)); if (sl) { UI.toast('Примите оплату — после неё заказ станет «Доставлено»'); UI.go('kassaSale', { id: sl.id }); } return; }
      if (!!o.shipped !== (to === 'shipped')) { if (UI.run(() => { E.setShipped(o.id, to === 'shipped'); return true; }) === undefined) return; }
    }
    E.changed();
  }
  function Kanban({ orders }) {
    const [over, setOver] = useState(null);
    const idx = (o) => STAGES.findIndex((x) => x.k === stageOf(o));
    const step = (e, o, dir) => { e.stopPropagation(); const n = STAGES[idx(o) + dir]; if (n) moveOrder(o, n.k); };
    return html`<div class="kanban">${STAGES.map((col) => {
      const items = sorted(orders.filter((o) => stageOf(o) === col.k));
      const sum = items.reduce((a, o) => a + E.calcLines(o).total, 0);
      return html`<div class="kb-col ${over === col.k ? 'over' : ''}" key=${col.k}
        onDragOver=${(e) => { e.preventDefault(); if (over !== col.k) setOver(col.k); }} onDragLeave=${(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null); }}
        onDrop=${(e) => { e.preventDefault(); setOver(null); const o = E.doc({ t: 'order', id: e.dataTransfer.getData('text/plain') }); if (o) moveOrder(o, col.k); }}>
        <div class="kb-head ${col.k}"><b>${col.t}</b><span class="chip">${items.length}</span><span class="kb-sum">${U.money(sum)}</span></div>
        <div class="kb-body">
          ${items.slice(0, 30).map((o) => { const productGroups = E.documentProductGroups(o); return html`<div class="kb-card" key=${o.id} draggable="true"
            onDragStart=${(e) => { e.dataTransfer.setData('text/plain', o.id); e.dataTransfer.effectAllowed = 'move'; }}
            onClick=${() => UI.go('kassaDocView', { t: 'order', id: o.id })}>
            <div class="kb-who">${E.cpName(o.cp)}</div>
            <div class="kb-row"><span class="kb-number">${o.no}</span><span class="muted">${U.fmtDate(o.at)}</span></div>
            <div class="kb-products">${productGroups.slice(0, 2).map((g) => html`<span>${g.name}<small>${g.items.length} ${U.plural(g.items.length, 'размер', 'размера', 'размеров')}</small></span>`)}${productGroups.length > 2 ? html`<small>Ещё ${productGroups.length - 2} ${U.plural(productGroups.length - 2, 'товар', 'товара', 'товаров')}</small>` : null}</div>
            <div class="kb-row"><span class="muted">${productGroups.length} ${U.plural(productGroups.length, 'товар', 'товара', 'товаров')} · ${o.lines.length} ${U.plural(o.lines.length, 'размер', 'размера', 'размеров')}</span><b>${U.money(E.calcLines(o).total)} сом</b></div>
            ${o.comment ? html`<div class="kb-note">${o.comment}</div>` : null}
            ${col.k !== 'delivered' ? html`<div class="kb-move"><button class="btn sm" disabled=${idx(o) === 0} onClick=${(e) => step(e, o, -1)}>◀</button><button class="btn sm" onClick=${(e) => step(e, o, 1)}>▶</button></div>` : null}
          </div>`; })}
          ${!items.length ? html`<div class="kb-empty">Пусто</div>` : null}
        </div>
      </div>`;
    })}</div>`;
  }

  /* ---------- Просмотр: списки ---------- */
  S.kassaView = ({ tab: tab0 = 'sales' }) => {
    const [tab, setTab] = useState(tab0);
    const [q, setQ] = useState('');
    const [debtOnly, setDebtOnly] = useState(false);
    const nameOf = (d) => E.cpName(d.cp);
    const hit = (d) => U.match(q, d.no, d.cp ? E.cpName(d.cp) : 'розничный', d.author);
    const open = (t) => (d) => UI.go('kassaDocView', { t, id: d.id });
    const documentName = (d) => html`<div class="history-document"><b>${nameOf(d)}</b><small>${d.no}${d.status === 'cancelled' ? html` <${UI.Badge} st="cancelled" />` : null}${d.pending ? html` <span class="badge wait">ждёт отправки</span>` : null}</small></div>`;
    const payment = (d) => {
      const methods = Object.keys(PM).filter((k) => gt0(d.payMethods && d.payMethods[k])).map((k) => PM[k]);
      return gt0(d.paid) ? html`<div class="history-payment"><b>${U.money(d.paid)}</b>${methods.length ? html`<small>${methods.join(' + ')}</small>` : null}</div>` : html`<span class="muted">—</span>`;
    };

    let table = null;
    if (tab === 'sales') {
      const rows = sorted(E.S.sales.filter((s) => s.status !== 'draft')).filter(hit).slice(0, 300);
      table = html`<${Rows} rows=${rows} maxH="calc(100vh - 300px)" numCols=${[2, 3, 4]} onOpen=${open('sale')} head=${['Покупатель', 'Дата', 'Сумма, сом', 'Оплачено, сом', 'В долг, сом', 'Продавец']} cells=${(s) => [
        documentName(s), U.fmtDT(s.postedAt || s.at), html`<b>${U.money(s.total || 0)}</b>`,
        payment(s), gt0((s.total || 0) - (s.paid || 0)) ? html`<span class="warn-t b">${U.money(s.total - s.paid)}</span>` : html`<span class="muted">—</span>`, s.author]} empty=${q.trim() ? 'Ничего не найдено' : 'Продаж пока нет'} />`;
    } else if (tab === 'receipts') {
      const rows = sorted(E.S.receipts.filter((r) => r.status !== 'draft')).filter(hit).slice(0, 300);
      table = html`<${Rows} rows=${rows} maxH="calc(100vh - 300px)" numCols=${[2, 3, 4]} onOpen=${open('receipt')} head=${['Поставщик', 'Дата', 'Сумма, сом', 'Оплачено, сом', 'Мы должны, сом', 'Принял']} cells=${(r) => [
        documentName(r), U.fmtDT(r.postedAt || r.at), html`<b>${U.money(r.goods || 0)}</b>`,
        payment(r), gt0((r.goods || 0) - (r.paid || 0)) ? html`<span class="err-t b">${U.money(r.goods - r.paid)}</span>` : html`<span class="muted">—</span>`, r.author]} empty=${q.trim() ? 'Ничего не найдено' : 'Приходов пока нет'} />`;
    } else if (tab === 'orders') {
      const rows = E.S.orders.filter((o) => o.status !== 'cancelled' && (o.status !== 'draft' || o.lines.length)).filter(hit);
      table = html`<${Kanban} orders=${rows} />`;
    } else {
      const rows = E.S.cps.filter((c) => U.match(q, c.name, c.phone, c.code)).map((c) => ({ ...c, ...E.balance(c.id) })).filter((c) => !debtOnly || gt0(c.recv) || gt0(c.pay))
        .sort((a, b) => (b.recv + b.pay) - (a.recv + a.pay) || (a.name > b.name ? 1 : -1));
      table = html`<${Rows} rows=${rows} maxH="calc(100vh - 300px)" numCols=${[2, 3]} onOpen=${(c) => UI.go('kassaPerson', { id: c.id })} head=${['Имя', 'Телефон', 'Должен нам, сом', 'Мы должны, сом']} cells=${(c) => [
          html`<b>${c.name}</b>`, c.phone, gt0(c.recv) ? html`<span class="ok-t b">${U.money(c.recv)}</span>` : '—', gt0(c.pay) ? html`<span class="err-t b">${U.money(c.pay)}</span>` : '—']} empty="Никого не нашли" />`;
    }
    const TABS = [{ k: 'sales', t: 'Продажи', icon: 'shopping-cart' }, { k: 'receipts', t: 'Приходы', icon: 'package-plus' }, { k: 'orders', t: 'Заказы', icon: 'clipboard-list' }, { k: 'people', t: 'Люди и долги', icon: 'users' }];
    const changeTab = (key) => { setTab(key); setQ(''); };
    const tabKey = (e, index) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
      changeTab(TABS[next].k);
      e.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next].focus();
    };
    return html`<div class="kassa-page kassa-history">
      <${Top} title="Просмотр">
        ${tab === 'people' ? html`<button class="btn pri" onClick=${() => UI.cpQuick('', (c) => UI.go('kassaPerson', { id: c.id }))}>${I('plus')} Добавить</button>` : null}
      <//>
      <div class="kassa-content">
        <div class="history-tabs" role="tablist" aria-label="Разделы просмотра">${TABS.map((t, i) => html`<button type="button" key=${t.k} id=${`history-tab-${t.k}`} role="tab" aria-selected=${tab === t.k} aria-controls="history-panel" tabindex=${tab === t.k ? 0 : -1} class=${tab === t.k ? 'on' : ''} onClick=${() => changeTab(t.k)} onKeyDown=${(e) => tabKey(e, i)}>${I(t.icon, 20)}${t.t}</button>`)}</div>
        <div class="history-toolbar">
          <div class="history-search">${I('search', 20)}<input type="search" aria-label="Поиск" value=${q} placeholder=${tab === 'people' ? 'Имя или телефон' : tab === 'receipts' ? 'Номер или поставщик' : 'Номер или покупатель'} onInput=${(e) => setQ(e.target.value)} /></div>
          ${tab === 'people' ? html`<label class="history-debt-filter"><input type="checkbox" checked=${debtOnly} onChange=${(e) => setDebtOnly(e.target.checked)} /> Только с долгами</label>` : null}
        </div>
        <div id="history-panel" role="tabpanel" aria-labelledby=${`history-tab-${tab}`}>${table}</div>
      </div>
    </div>`;
  };
  const Rows = ({ rows, head, cells, onOpen, empty, numCols = [], maxH = 'calc(100vh - 220px)' }) => html`<div class="grid-wrap" style=${`max-height:${maxH}`}>
    <table class="grid"><thead><tr>${head.map((h, i) => html`<th class=${numCols.includes(i) ? 'num' : ''}>${h}</th>`)}</tr></thead>
    <tbody>${rows.map((r) => html`<tr key=${r.id} class="clk" tabindex="0" onClick=${() => onOpen(r)} onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(r); } }}>${cells(r).map((c, i) => html`<td class=${numCols.includes(i) ? 'num' : ''}>${c}</td>`)}</tr>`)}</tbody></table>
    ${!rows.length ? html`<div class="grid-empty">${empty}</div>` : null}</div>`;

  /* ---------- Возвраты ---------- */
  function returnSale(sale) {
    const r = UI.run(() => E.newReturn(sale.id));
    if (!r) return;
    const discard = () => { try { E.deleteDraft(E.ref(r)); } catch (e) { /* уже удалён */ } };
    UI.modal({ title: `Возврат по продаже ${sale.no}`, size: 'mid', sticky: true, onClose: discard, body: (mid) => html`<${ReturnDialog} r=${r} sale=${sale} mid=${mid} discard=${discard} />` });
  }

  function ReturnDialog({ r, sale, mid, discard }) {
    const [, tick] = useState(0);
    const [touched, setTouched] = useState(false);
    const [method, setMethod] = useState('cash');
    const [comment, setComment] = useState('');
    const redraw = () => tick((x) => x + 1);
    const c = E.returnCalc(r);
    const refundNow = touched ? r.refundNow : c.refund;
    const left = r2(c.refund - (U.isNum(refundNow) ? refundNow : 0));
    const person = sale.cp ? E.cp(sale.cp) : null;
    const anyQty = r.lines.some((l) => gt0(l.qty));
    const ok = () => {
      r.refundNow = U.isNum(refundNow) ? refundNow : 0;
      r.payMethods = gt0(r.refundNow) ? { [method]: r.refundNow } : {};
      r.comment = comment;
      if (UI.run(() => { E.postReturn(r.id); return true; }) === undefined) return;
      UI.close(mid);
      UI.toast(`Возврат оформлен: ${U.money(c.amount)} сом`, 'ok');
      UI.go('kassaDocView', { t: 'ret', id: r.id });
    };
    return html`<div class="pay-modal" style="min-width:0">
      <div class="grid-wrap"><table class="grid">
        <thead><tr><th>Товар</th><th class="r">Продано</th><th class="r">Уже возвращено</th><th class="r" style="width:110px">Вернуть</th><th class="r">Сумма</th></tr></thead>
        <tbody>${r.lines.map((l, i) => { const x = c.lines[i]; const p = E.product(x.sl.pid) || {};
          return html`<tr key=${i}><td>${E.productLabel(p)}</td><td class="num">${U.qtyU(x.sl.qty, p.unit)}</td><td class="num">${gt0(x.done.qty) ? U.qty(x.done.qty) : '—'}</td>
            <td class="ed">${x.can > 0 ? html`<${UI.Num} value=${l.qty} onChange=${(v) => { l.qty = v; redraw(); }} bad=${U.isNum(l.qty) && l.qty > x.can + 0.0005} />` : html`<span class="muted">нечего</span>`}</td>
            <td class="num">${gt0(x.q) ? U.money(x.amount) : ''}</td></tr>`; })}</tbody>
      </table></div>
      <div class="pay-row big" style="margin-top:8px"><span>Сумма возврата</span><span class="v">${U.money(c.amount)} сом</span></div>
      ${gt0(c.toDebt) ? html`<div class="pay-row"><span>Уменьшит долг покупателя</span><span class="v">${U.money(c.toDebt)}</span></div>` : null}
      ${gt0(c.refund) ? html`<div class="pay-row"><span>Вернуть деньгами</span><span class="v">${U.money(c.refund)}</span></div>
        <div class="pay-method" style="margin:6px 0"><label>Выдаём сейчас</label><${UI.Num} cls="in num pay-input" value=${refundNow} onChange=${(v) => { setTouched(true); r.refundNow = v; redraw(); }} /></div>
        <div class="pay-quick">${Object.keys(PM).map((k) => html`<button class="btn pq ${method === k ? 'on' : ''}" onClick=${() => setMethod(k)}>${PM[k]}</button>`)}</div>
        ${gt0(left) ? (person ? html`<div class="note warn">Остальное ${U.money(left)} сом останется нашим долгом: ${person.name}.</div>` : html`<div class="note err">Продажа была без записи на человека: выдайте покупателю всю сумму сразу.</div>`) : null}` : null}
      <input class="in" style="margin-top:8px" placeholder="Причина возврата (необязательно)" value=${comment} onInput=${(e) => setComment(e.target.value)} />
      <div class="pay-footer"><span class="sp"></span>
        <button class="btn pri big" disabled=${!anyQty} onClick=${ok}>Оформить возврат</button>
        <button class="btn" onClick=${() => { discard(); UI.close(mid); }}>Отмена</button></div>
    </div>`;
  }

  // возврат товара поставщику: только при связи, расчёт делает сервер
  function returnToSupplier(receipt) {
    const q = {};
    const Body = ({ mid }) => {
      const [, tick] = useState(0);
      const [busy, setBusy] = useState(false);
      const lines = receipt.lines.map((l, li) => ({ li, qty: q[li] || 0 })).filter((l) => gt0(l.qty));
      const tooMuch = receipt.lines.some((l, li) => U.isNum(q[li]) && q[li] > l.qty + 0.0005);
      const go = async () => {
        setBusy(true);
        try { await Server.supplierReturn(receipt.id, lines, ''); UI.close(mid); UI.toast('Возврат поставщику проведён', 'ok'); }
        catch (e) { UI.toast(e.message, 'err'); setBusy(false); }
      };
      return html`<div class="pay-modal" style="min-width:0">
        <div class="grid-wrap"><table class="grid"><thead><tr><th>Товар</th><th class="r">Принято</th><th class="r" style="width:110px">Вернуть</th></tr></thead>
          <tbody>${receipt.lines.map((l, i) => { const p = E.product(l.pid) || {}; return html`<tr key=${i}><td>${E.productLabel(p)}</td><td class="num">${U.qtyU(l.qty, p.unit)}</td><td class="ed"><${UI.Num} value=${q[i] || 0} onChange=${(v) => { q[i] = v; tick((x) => x + 1); }} bad=${U.isNum(q[i]) && q[i] > l.qty + 0.0005} /></td></tr>`; })}</tbody></table></div>
        <div class="pay-hint">Товар уйдёт со склада. Стоимость уменьшит наш долг поставщику; если долга нет — поставщик останется должен деньги.</div>
        <div class="pay-footer"><span class="sp"></span><button class="btn pri big" disabled=${!lines.length || tooMuch || busy} onClick=${go}>${busy ? 'Проводим…' : 'Вернуть поставщику'}</button><button class="btn" onClick=${() => UI.close(mid)}>Отмена</button></div>
      </div>`;
    };
    UI.modal({ title: `Возврат поставщику по ${receipt.no}`, size: 'mid', body: (mid) => html`<${Body} mid=${mid} />` });
  }

  /* ---------- Просмотр документа ---------- */
  S.kassaDocView = ({ t, id }) => {
    const d = E.doc({ t, id });
    const tab = { sale: 'sales', receipt: 'receipts', order: 'orders', ret: 'sales' }[t];
    if (!d) return html`<div class="kassa-page"><${Top} title="Документ не найден" back="Просмотр" onBack=${() => UI.go('kassaView', { tab })} /></div>`;
    const k = KIND[t];
    const calc = t === 'ret' ? { lines: d.lines.map((l) => ({ amount: l.amount, disc: 0 })), total: d.amount } : E.calcLines(d);
    const sourceSale = t === 'ret' ? E.doc({ t: 'sale', id: d.saleId }) : null;
    const returns = t === 'sale' ? E.S.returns.filter((x) => x.saleId === d.id && x.status === 'posted') : [];
    const debt = t === 'order' || t === 'ret' ? 0 : r2((t === 'sale' ? d.total : d.goods) - (d.paid || 0));
    const sale = d.saleId ? E.doc({ t: 'sale', id: d.saleId }) : null;
    const stage = t === 'order' ? stageOf(d) : null;
    const orderActions = t === 'order' ? html`
      ${d.status === 'draft' ? html`<button class="btn pri" onClick=${() => UI.go('kassaOrder', { id })}>${I('edit')} Продолжить</button>
        <button class="btn" onClick=${() => moveOrder(d, 'assembling')}>Начать сборку</button>
        <button class="btn danger" onClick=${async () => { if (await UI.confirm('Удалить черновик заказа?', { ok: 'Удалить', danger: true })) { E.deleteDraft(E.ref(d)); UI.go('kassaView', { tab }); } }}>Удалить</button>` : null}
      ${stage === 'assembling' ? html`<button class="btn pri" onClick=${() => moveOrder(d, 'shipped')}>Отправлено</button>` : null}
      ${stage === 'shipped' ? html`<button class="btn" onClick=${() => moveOrder(d, 'assembling')}>Вернуть на сборку</button>` : null}
      ${E.ORDER_ACTIVE.includes(d.status) ? html`<button class="btn pri" onClick=${() => moveOrder(d, 'delivered')}>${I('shopping-cart')} Доставлено — принять оплату</button>
        <button class="btn danger" onClick=${async () => { if (await UI.confirm('Отменить заказ? Резерв товара будет снят.', { ok: 'Отменить заказ', danger: true })) UI.run(() => { E.setOrderStatus(id, 'cancelled'); return true; }, 'Заказ отменён'); }}>Отменить заказ</button>` : null}` : null;
    const canReturn = t === 'sale' && d.status === 'posted' && !d.pending;
    const returnActions = html`${canReturn ? html`<button class="btn" onClick=${() => returnSale(d)}>${I('arrow-left')} Оформить возврат</button>` : null}
      ${t === 'receipt' && d.status === 'posted' && !d.pending && window.Server && Server.on ? html`<button class="btn" onClick=${() => returnToSupplier(d)}>${I('arrow-left')} Вернуть поставщику</button>` : null}`;
    const printable = t === 'order' || (d.status === 'posted' && t !== 'ret');
    return html`<div class="kassa-page">
      <${Top} title=${html`${I(k.icon, 18)} ${k.title} ${d.no} ${t === 'order' && d.status !== 'cancelled' ? html`<span class="badge assembling">${stageName(d)}</span>` : html`<${UI.Badge} st=${d.status} />`} ${d.pending ? html`<span class="badge wait">ждёт отправки</span>` : ''}`} back="Просмотр" onBack=${() => UI.go('kassaView', { tab })}>
        ${printable ? html`<button class="btn" onClick=${() => printDoc(d, t, 'client')}>${I('printer')} ${t === 'order' ? 'Накладная клиенту' : 'Накладная'}</button>` : null}
        ${t === 'order' ? html`<button class="btn" onClick=${() => printDoc(d, t, 'worker')}>${I('printer')} Лист работнику</button>` : null}
      <//>
      <div class="kassa-content">
        <div class="docv-head">
          <div class="docv-who">
            <span class="muted">${k.who}</span>
            ${d.cp ? html`<a class="kp-name" onClick=${() => UI.go('kassaPerson', { id: d.cp })}>${E.cpName(d.cp)}</a><${BalanceChips} cp=${d.cp} />` : html`<span class="kp-name none">Розничный покупатель</span>`}
          </div>
          <div class="muted">${U.fmtDT(docDate(d))} · ${d.postedBy || d.author}${d.comment ? ' · ' + d.comment : ''}</div>
        </div>
        ${sale && t === 'order' ? html`<div class="note ok">Оформлена продажа <a onClick=${() => UI.go('kassaDocView', { t: 'sale', id: sale.id })}>${sale.no}</a></div>` : null}
        ${d.orderId ? html`<div class="note">Продажа по заказу <a onClick=${() => UI.go('kassaDocView', { t: 'order', id: d.orderId })}>${E.refNo({ t: 'order', id: d.orderId })}</a></div>` : null}
        ${d.status === 'cancelled' ? html`<div class="note err">Документ отменён</div>` : null}
        <div class="grid-wrap"><table class="grid">
          <thead><tr><th>№</th><th>${t === 'ret' ? 'Товар' : 'Товар / размер'}</th><th class="r">Кол-во</th><th class="r">Цена</th><th class="r">Скидка</th><th class="r">Сумма</th></tr></thead>
          <tbody>${t === 'ret' ? d.lines.map((l, i) => { if (!gt0(l.qty)) return null; const p = E.product(l.pid) || {}; const x = calc.lines[i]; return html`<tr key=${i}><td class="num muted">${i + 1}</td><td>${E.productLabel(p)}</td><td class="num">${U.qtyU(l.qty, p.unit)}</td><td class="num">${U.money(l.price)}</td><td class="num">${gt0(x.disc) ? U.money(x.disc) : ''}</td><td class="num b">${U.money(x.amount)}</td></tr>`; }) : E.documentProductGroups(d, calc).map((g, gi) => html`
            <tr class="doc-group-heading"><td>${gi + 1}</td><td colspan="4"><b>${g.name}</b><small>${g.items.length} ${U.plural(g.items.length, 'размер', 'размера', 'размеров')}${g.units.length === 1 ? ` · ${U.qty(g.qty)} ${g.units[0]}` : ''}</small></td><td class="num b">${U.money(g.total)}</td></tr>
            ${g.items.map((item) => html`<tr class="doc-size-row"><td></td><td>${item.product.variantName || 'Основной'}</td><td class="num b">${U.qtyU(item.line.qty, item.product.unit)}</td><td class="num">${U.money(item.line.price)}</td><td class="num">${gt0(item.discount) ? U.money(item.discount) : '—'}</td><td class="num">${U.money(item.amount)}</td></tr>`)}
          `)}</tbody>
        </table></div>
        <div class="docv-total">
          <div class="row big"><span>Итого</span><span>${U.money(calc.total)} сом</span></div>
          ${t === 'ret' ? html`<div class="row"><span>Выдано деньгами</span><span>${U.money(d.refundNow || 0)}${payText(d.payMethods) ? ` — ${payText(d.payMethods)}` : ''}</span></div>
            ${sourceSale ? html`<div class="row muted"><span>По продаже</span><a onClick=${() => UI.go('kassaDocView', { t: 'sale', id: sourceSale.id })}>${sourceSale.no}</a></div>` : null}` : null}
          ${t !== 'order' && t !== 'ret' && d.status === 'posted' ? html`
            <div class="row"><span>${t === 'sale' ? 'Оплачено' : 'Заплатили'}</span><span>${U.money(d.paid || 0)}${payText(d.payMethods) ? ` — ${payText(d.payMethods)}` : ''}</span></div>
            ${gt0(debt) ? html`<div class="row ${t === 'sale' ? 'warn-t' : 'err-t'} b"><span>${t === 'sale' ? 'В долг (должен нам)' : 'Мы должны'}</span><span>${U.money(debt)}</span></div>` : null}` : null}
        </div>
        ${returns.length ? html`<div class="note">Возвраты по этой продаже: ${returns.map((x, i) => html`${i ? ', ' : ''}<a onClick=${() => UI.go('kassaDocView', { t: 'ret', id: x.id })}>${x.no} (${U.money(x.amount)})</a>`)}</div>` : null}
        <div class="docv-actions">${orderActions}${returnActions}</div>
      </div>
    </div>`;
  };

  /* ---------- Человек: баланс, действия, история ---------- */
  S.kassaPerson = ({ id }) => {
    const c = E.cp(id);
    const [tab, setTab] = useState('hist');
    if (!c) return html`<div class="kassa-page"><${Top} title="Человек не найден" /></div>`;
    const b = E.balance(id);
    const is = (x) => x.cp === id;
    const hist = [];
    const push = (d, label, amount, kind, note) => hist.push({ key: d.t + d.id, at: docDate(d), ref: E.ref(d), no: d.no, label, amount, status: d.status, shipped: d.shipped, kind, note });
    E.S.sales.filter(is).filter((s) => s.status !== 'draft').forEach((s) => push(s, s.transfer ? 'Товар в долг' : 'Продажа', -s.total, 'sale', `${payText(s.payMethods) || (s.paid ? 'оплачено ' + U.money(s.paid) : 'без оплаты')}${gt0(s.total - s.paid) ? ' · в долг ' + U.money(s.total - s.paid) : ''}`));
    E.S.receipts.filter(is).filter((r) => r.status !== 'draft').forEach((r) => push(r, 'Приход от него', r.goods, 'receipt', `${payText(r.payMethods) || (r.paid ? 'заплатили ' + U.money(r.paid) : 'без оплаты')}${gt0(r.goods - r.paid) ? ' · мы должны ' + U.money(r.goods - r.paid) : ''}`));
    E.S.orders.filter(is).filter((o) => o.status !== 'draft' || o.lines.length).forEach((o) => push(o, 'Заказ', E.calcLines(o).total, 'order', o.comment || ''));
    E.S.returns.filter(is).filter((r) => r.status === 'posted').forEach((r) => push(r, 'Возврат от покупателя', r.amount, 'ret', payText(r.payMethods) ? `выдано ${payText(r.payMethods)}` : ''));
    E.S.sreturns.filter(is).filter((r) => r.status === 'posted').forEach((r) => push(r, 'Возврат поставщику', r.amount, 'sret', ''));
    E.S.payments.filter(is).filter((p) => p.status === 'posted' && !p.src).forEach((p) => push(p, p.dir === 'in' ? 'Принята оплата долга' : 'Выдана оплата долга', p.dir === 'in' ? p.amount : -p.amount, 'pay', p.method ? PM[p.method] : p.comment));
    E.S.offsets.filter(is).forEach((o) => push(o, 'Взаимозачёт', null, 'off', U.money(o.amount)));
    hist.sort((a, z) => (z.at > a.at ? 1 : -1));
    const open = (h) => (['sale', 'receipt', 'order', 'ret'].includes(h.kind) ? UI.go('kassaDocView', { t: h.kind, id: h.ref.id }) : UI.openRef(h.ref));
    const debts = E.debtsOf(id).filter((x) => gt0(E.debtRem(x))).sort((a, z) => a.seq - z.seq);
    return html`<div class="kassa-page">
      <${Top} title=${html`${I('users', 18)} ${c.name}`} back="Назад" onBack=${() => UI.go('kassaView', { tab: 'people' })}><span class="muted">${c.phone}</span><//>
      <div class="kassa-content">
        <div class="kpis">
          <div class="kpi recv"><div class="t">Должен нам</div><div class="v">${U.money(b.recv)}</div></div>
          <div class="kpi pay"><div class="t">Мы должны</div><div class="v">${U.money(b.pay)}</div></div>
        </div>
        <div class="person-actions">
          <button class="btn pri big" disabled=${!gt0(b.recv)} onClick=${() => debtPayDialog(id, 'recv')}>${I('wallet')} Принять оплату долга</button>
          <button class="btn pri big" disabled=${!gt0(b.pay)} onClick=${() => debtPayDialog(id, 'pay')}>${I('hand-coins')} Выдать деньги (наш долг)</button>
          <span class="sp"></span>
          <button class="btn big" onClick=${() => startDoc('sale', id)}>${I('shopping-cart')} Продажа</button>
          <button class="btn big" onClick=${() => startDoc('receipt', id)}>${I('package-plus')} Приход</button>
          <button class="btn big" onClick=${() => startDoc('order', id)}>${I('clipboard-list')} Заказ</button>
        </div>
        <${UI.Tabs} tabs=${[{ k: 'hist', t: 'История', n: hist.length }, { k: 'debts', t: 'Что не погашено', n: debts.length }]} cur=${tab} onChange=${setTab} />
        ${tab === 'hist' ? html`<${Rows} rows=${hist.map((h) => ({ ...h, id: h.key }))} onOpen=${open} head=${['Что было', 'Дата', 'Сумма', 'Подробности']} cells=${(h) => [
          html`<b>${h.label}</b> ${h.status === 'cancelled' ? html`<${UI.Badge} st="cancelled" />` : h.kind === 'order' ? html`<span class="badge assembling">${stageName(h)}</span>` : ''}`, U.fmtDT(h.at),
          h.amount == null ? '' : html`<b class=${h.kind === 'pay' && h.amount > 0 ? 'ok-t' : ''}>${U.money(Math.abs(h.amount))}</b>`, html`<span class="muted">${h.note || ''}</span>`]} empty="Операций с этим человеком пока не было" />`
        : html`<${UI.DebtTable} rows=${debts} maxH="50vh" />`}
      </div>
    </div>`;
  };

  /* Простая выплата/приём долга: сумма + способ, распределение со старых долгов. */
  function debtPayDialog(cp, dir) {
    const Body = () => {
      const debts = E.openDebts(cp, dir);
      const total = r2(debts.reduce((a, x) => a + E.debtRem(x), 0));
      const [amount, setAmount] = useState(total);
      const [method, setMethod] = useState('cash');
      const [comment, setComment] = useState('');
      const bad = !U.isNum(amount) || amount <= 0 || amount > total + 0.0001;
      const ok = () => {
        if (bad) return;
        let left = r2(amount);
        const rows = debts.map((x) => { const m = r2(Math.min(E.debtRem(x), left)); left = r2(left - m); return { debtId: x.id, goods: 0, money: m }; });
        const created = UI.run(() => E.postSettlement(cp, dir, rows, r2(amount), `${PM[method]}${comment ? ': ' + comment : ''}`, { method }), dir === 'recv' ? 'Оплата принята' : 'Оплата выдана');
        if (!created) return;
        upd(); UI.close(mid);
      };
      return html`<div class="pay-modal" onKeyDown=${(e) => { if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); ok(); } }}>
        <div class="pay-row big"><span>${dir === 'recv' ? 'Всего должен' : 'Мы должны'}</span><span class="v">${U.money(total)} сом</span></div>
        <div class="pay-method" style="margin:8px 0"><label>${dir === 'recv' ? 'Принимаем сейчас' : 'Выдаём сейчас'}</label><${UI.Num} cls="in num pay-input" autofocus value=${amount} onChange=${setAmount} /></div>
        <div class="pay-quick">${Object.keys(PM).map((k) => html`<button class="btn pq ${method === k ? 'on' : ''}" onClick=${() => setMethod(k)}>${PM[k]}</button>`)}</div>
        <input class="in" style="margin-top:8px" placeholder="Комментарий (необязательно)" value=${comment} onInput=${(e) => setComment(e.target.value)} />
        ${bad ? html`<div class="note err">Сумма должна быть больше нуля и не больше долга</div>` : html`<div class="pay-hint">Закрываются сначала самые старые долги. Останется: ${U.money(r2(total - amount))}</div>`}
        <div class="pay-footer">${window.Server && Server.on ? null : html`<a onClick=${() => { UI.close(mid); UI.settlement(cp, dir); }}>Подробно / вернуть товаром…</a>`}<span class="sp"></span>
          <button class="btn pri big" disabled=${bad} onClick=${ok}>${dir === 'recv' ? 'Принять' : 'Выдать'}</button><button class="btn" onClick=${() => UI.close(mid)}>Отмена</button></div>
      </div>`;
    };
    const mid = UI.modal({ title: `${dir === 'recv' ? 'Оплата долга' : 'Выплата нашего долга'} — ${E.cpName(cp)}`, body: () => html`<${Body} />` });
  }

  // из таблицы долгов и ссылок на документы в режиме кассы открываем кассовые экраны
  UI.kassaOpenRef = (ref) => {
    if (['sale', 'receipt', 'order', 'ret'].includes(ref.t)) return UI.go('kassaDocView', { t: ref.t, id: ref.id });
    return UI.modal({ title: E.refTitle(ref), size: 'mid', body: () => html`<${UI.DocInfo} r=${ref} />` });
  };
  UI.kassaPay = (d, kind = 'sale') => UI.modal({ title: 'Оплата', size: 'payment', body: (mid) => html`<${PayDialog} d=${d} kind=${kind} mid=${mid} />` });
  UI.kassaStart = startDoc;
})();
