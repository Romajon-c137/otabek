/* Справочники: товары и контрагенты (с долгами). */
(function () {
  const { html, useState, useRef, useEffect } = window.htmPreact;
  const S = (window.Screens = window.Screens || {});
  const I = (n, s) => html`<${UI.Icon} name=${n} size=${s} />`;

  /* ================= Товары ================= */
  S.products = () => {
    const [q, setQ] = useState('');
    const [f, setF] = useState({ stock: false, res: false, inactive: false });
    const [cat, setCat] = useState('');
    const [selId, setSelId] = useState(null);
    const search = useRef();
    const rows = E.S.products.filter((p) => (f.inactive || p.active) && (!cat || (p.category || '') === cat) && U.match(q, p.name, p.variantName, p.category, p.code)).map((p) => {
      const stock = E.stock(p.id), res = E.reserved(p.id);
      return { ...p, stock, res, avail: U.r3(stock - res) };
    }).filter((r) => (!f.stock || r.stock > 0) && (!f.res || r.res > 0));
    UI.useHotkeys((e) => {
      if (e.key === 'Insert' || e.key === 'F2') { window.open('https://otabek.glasscenter.kg/add', '_blank', 'noopener'); return true; }
      if ((e.ctrlKey && e.key.toLowerCase() === 'f') || (e.key === '/' && !UI.isTyping(e))) { search.current.focus(); return true; }
    });
    return html`
      <div class="head"><h1>Товары</h1></div>
      <div class="body" style="display:flex;flex-direction:column">
        <div class="bar">
          <button class="btn pri" onClick=${() => window.open('https://otabek.glasscenter.kg/add', '_blank', 'noopener')}>${I('plus')} Новый товар в Otabek<span class="kb">Ins</span></button>
          ${window.Server && Server.on ? html`<button class="btn" onClick=${async () => { try { const r = await Server.syncOtabek(); UI.toast(`Otabek: ${r.sizes} размеров, новых ${r.created}`, 'ok'); } catch (e) { UI.toast(e.message || 'Не удалось обновить Otabek', 'err'); } }}>${I('refresh-cw')} Обновить каталог</button>` : null}
          <button class="btn" disabled=${!rows.length} onClick=${() => UI.productCard(selId || (rows[0] || {}).id)}>${I('eye')} Карточка<span class="kb">Enter</span></button>
          <div class="search"><input ref=${search} value=${q} placeholder="Поиск: название, размер, категория, код  (Ctrl+F)" onInput=${(e) => setQ(e.target.value)}
            onKeyDown=${(e) => { if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); document.querySelector('.grid-wrap').focus(); } if (e.key === 'Escape') setQ(''); }} autofocus /></div>
          <select class="in" style="width:190px" value=${cat} onChange=${(e) => setCat(e.target.value)}><option value="">Все категории</option>${E.categories().map((c) => html`<option value=${c} selected=${c === cat}>${c}</option>`)}</select>
          <label class="chk"><input type="checkbox" checked=${f.stock} onChange=${(e) => setF({ ...f, stock: e.target.checked })} />Только в наличии</label>
          <label class="chk"><input type="checkbox" checked=${f.res} onChange=${(e) => setF({ ...f, res: e.target.checked })} />С резервом</label>
          <label class="chk"><input type="checkbox" checked=${f.inactive} onChange=${(e) => setF({ ...f, inactive: e.target.checked })} />Показать неактивные</label>
        </div>
        <${UI.Table} rows=${rows} onOpen=${(r) => UI.productCard(r.id)} onSel=${setSelId} sort=${{ k: 'name', d: 1 }}
          rowCls=${(r) => (!r.active ? 'dim' : '')}
          cols=${[
            { k: 'code', t: 'Код', w: '64px', cls: 'mono muted' },
            { k: 'category', t: 'Категория', w: '150px', r: (r) => r.category || html`<span class="muted">—</span>` },
            { k: 'name', t: 'Наименование', r: (r) => html`${r.name}${!r.active ? html` <span class="pill">неактивен</span>` : ''}` },
            { k: 'variantName', t: 'Размер', w: '150px', r: (r) => r.variantName || html`<span class="muted">—</span>` },
            { k: 'unit', t: 'Ед.', w: '36px' },
            { k: 'stock', t: 'Остаток', a: 'r', w: '80px', r: (r) => UI.q(r.stock) },
            { k: 'retailPrice', t: 'Розничная цена', a: 'r', w: '110px', r: (r) => U.money(r.retailPrice) },
          ]} />
        <div class="statusline"><span>Показано ${rows.length} из ${E.S.products.length}</span></div>
      </div>`;
  };

  /* Загрузка фото с компьютера: уменьшаем до 480 px, чтобы не раздувать хранилище. */
  function PhotoField({ value, onChange, name }) {
    const [busy, setBusy] = useState(false);
    const pick = (file) => {
      if (!file) return;
      if (!/^image\//.test(file.type)) { UI.toast('Выберите файл-картинку (JPG, PNG, WebP)', 'err'); return; }
      setBusy(true);
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 480 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        onChange(c.toDataURL('image/jpeg', 0.82));
        URL.revokeObjectURL(url); setBusy(false);
      };
      img.onerror = () => { URL.revokeObjectURL(url); setBusy(false); UI.toast('Не удалось прочитать картинку', 'err'); };
      img.src = url;
    };
    return html`<div class="photo-field">
      <div class="photo-prev" onDragOver=${(e) => e.preventDefault()} onDrop=${(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>${UI.productPhoto({ name, photo: value }, 110)}</div>
      <div class="photo-btns">
        <label class="btn">${I('upload')} ${value ? 'Заменить фото' : 'Загрузить фото'}<input type="file" accept="image/*" hidden onChange=${(e) => { pick(e.target.files[0]); e.target.value = ''; }} /></label>
        ${value ? html`<button class="btn danger" onClick=${() => onChange('')}>Убрать</button>` : null}
        <span class="muted">${busy ? 'Обработка…' : 'Можно перетащить файл на картинку'}</span>
      </div>
    </div>`;
  }

  UI.productCard = (id, opts = {}) => {
    const mid = UI.modal({ title: id ? 'Карточка товара' : 'Новый товар', size: 'wide', body: () => html`<${ProductCard} id=${id} opts=${opts} mid=${mid} />` });
  };
  function ProductCard({ id, opts, mid }) {
    const [tab, setTab] = useState('main');
    const [curId, setCurId] = useState(id);
    const p = curId ? E.product(curId) : null;
    const [d, setD] = useState(() => (p ? { ...p } : { name: opts.name || '', category: '', unit: 'шт', purchasePrice: 0, wholesalePrice: 0, retailPrice: 0, photo: '', active: true }));
    const [errs, setErrs] = useState([]);
    const [openQty, setOpenQty] = useState(0);
    const [openCost, setOpenCost] = useState(0);
    const used = p && E.productUsed(p.id);
    const save = () => {
      const wantStock = !curId && U.isNum(openQty) && openQty > 0;
      let saved;
      try {
        if (wantStock && !U.validQty(openQty, d.unit)) throw new E.AccErr('Остаток', [{ field: 'openQty', msg: `Остаток — ${U.qtyRule(d.unit)}, больше нуля` }]);
        saved = E.saveProduct(d, curId);
      } catch (e) { setErrs(e.details && e.details.length ? e.details : [{ msg: e.message }]); return; }
      setErrs([]);
      if (curId) { UI.toast('Карточка сохранена', 'ok'); return; }
      // товар уже записан: дальше карточка работает с ним, даже если остаток не примется
      setCurId(saved.id); setD({ ...saved });
      UI.toast(saved.code ? `Товар создан, код ${saved.code}` : 'Товар создан', 'ok');
      if (wantStock && UI.run(() => E.addOpeningStock(saved.id, openQty, U.isNum(openCost) && openCost > 0 ? openCost : saved.purchasePrice), `На склад принято: ${U.qtyU(openQty, saved.unit)}`)) {
        setOpenQty(0); setOpenCost(0);
      }
      if (opts.onSaved) { UI.close(mid); opts.onSaved(saved); }
    };
    const set = (k) => (v) => setD((prev) => ({ ...prev, [k]: v }));
    const inp = (k, extra = {}) => html`<div class="fw"><input class="in ${UI.hasErr(errs, k) ? 'bad' : ''}" value=${d[k]} onInput=${(e) => set(k)(e.target.value)} ...${extra} /><${UI.FieldErr} errs=${errs} field=${k} /></div>`;
    const lots = p ? E.lotsOf(p.id).sort((a, b) => a.seq - b.seq) : [];
    const moves = p ? E.S.moves.filter((m) => m.pid === p.id).sort((a, b) => b.id - a.id) : [];
    const resv = p ? E.reserveOrders(p.id) : [];
    const stock = p ? E.stock(p.id) : 0;
    return html`
      ${p && E.tracksInventory(p) ? html`<div class="kpis" style="margin-bottom:10px">
        <div class="kpi"><div class="t">Остаток</div><div class="v">${U.qtyU(stock, p.unit)}</div></div>
        <div class="kpi"><div class="t">В резерве</div><div class="v">${U.qtyU(E.reserved(p.id), p.unit)}</div></div>
        <div class="kpi"><div class="t">Доступно</div><div class="v">${U.qtyU(E.available(p.id), p.unit)}</div></div>
        <div class="kpi"><div class="t">Стоимость остатка (FIFO)</div><div class="v">${U.money(E.stockCost(p.id))}</div></div>
      </div>` : null}
      <${UI.Tabs} cur=${tab} onChange=${setTab} tabs=${[{ k: 'main', t: 'Основное' }, ...(p && E.tracksInventory(p) ? [{ k: 'lots', t: 'Партии', n: lots.length }, { k: 'moves', t: 'История движений', n: moves.length }, { k: 'res', t: 'Резервы', n: resv.length }] : [])]} />
      ${tab === 'main' && html`<div onKeyDown=${(e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); save(); } }}>
        <div class="form one">
          <label class="l">Код</label><div class="mono">${p && p.code ? p.code : html`<span class="muted">сформируется при записи</span>`}</div>
          <label class="l">Наименование *</label>${p && p.externalSizeId ? html`<div><b>${p.name}</b><div class="muted" style="font-size:12px">управляется в Otabek Production</div></div>` : inp('name', { autofocus: true })}
          ${p && p.variantName ? html`<label class="l">Размер</label><div><b>${p.variantName}</b></div>` : null}
          <label class="l">Категория</label><div class="fw"><input class="in" list="cat-list" value=${d.category || ''} placeholder="Выберите или впишите новую" onInput=${(e) => set('category')(e.target.value)} /><datalist id="cat-list">${E.categories().map((c) => html`<option value=${c}></option>`)}</datalist></div>
          <label class="l">Единица измерения *</label><div class="fw"><div style="display:flex;gap:10px;align-items:center">
            <${UI.Seg} value=${d.unit} onChange=${(v) => !used && set('unit')(v)} opts=${E.UNITS.map((u) => ({ v: u, t: { шт: 'Штуки', кг: 'Килограммы', м: 'Метры' }[u] }))} />
            ${used ? html`<span class="muted" style="font-size:12px">нельзя менять: по товару уже есть остаток или документы</span>` : null}
            </div>
            <${UI.FieldErr} errs=${errs} field="unit" /></div>
          <label class="l">Фото</label><div class="fw"><${PhotoField} value=${d.photo} onChange=${set('photo')} name=${d.name} /></div>
          <label class="l">Закупочная цена</label><div class="fw"><${UI.Num} cls="in num" style="width:140px" value=${d.purchasePrice} onChange=${set('purchasePrice')} bad=${UI.hasErr(errs, 'purchasePrice')} /><${UI.FieldErr} errs=${errs} field="purchasePrice" /></div>
          <label class="l">Оптовая цена *</label><div class="fw"><${UI.Num} cls="in num" style="width:140px" value=${d.wholesalePrice} onChange=${set('wholesalePrice')} bad=${UI.hasErr(errs, 'wholesalePrice')} /><${UI.FieldErr} errs=${errs} field="wholesalePrice" /></div>
          <label class="l">Розничная цена *</label><div class="fw"><${UI.Num} cls="in num" style="width:140px" value=${d.retailPrice} onChange=${set('retailPrice')} bad=${UI.hasErr(errs, 'retailPrice')} /><${UI.FieldErr} errs=${errs} field="retailPrice" /></div>
          ${!curId ? html`<label class="l">Начальный остаток</label><div class="fw"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><${UI.Num} cls="in num" style="width:120px" value=${openQty} onChange=${setOpenQty} bad=${UI.hasErr(errs, 'openQty')} /><span>${d.unit}</span><span class="muted">по цене</span><${UI.Num} cls="in num" style="width:110px" value=${openCost} onChange=${setOpenCost} /><span class="muted">(пусто — закупочная ${U.money(d.purchasePrice || 0)})</span></div><${UI.FieldErr} errs=${errs} field="openQty" /><div class="muted" style="font-size:12px">Сколько товара уже лежит на складе. Задаётся только при создании; потом остаток растёт приходом и убывает продажами.</div></div>` : null}
          <label class="l">Активность</label><label class="chk"><input type="checkbox" checked=${d.active} onChange=${(e) => set('active')(e.target.checked)} />Использовать в новых документах</label>
        </div>
        <div class="bar" style="margin-top:8px"><button class="btn pri" onClick=${save}>${I('save')} Записать<span class="kb">Ctrl+Enter</span></button><button class="btn" onClick=${() => UI.close(mid)}>${I('x')} Закрыть<span class="kb">Esc</span></button></div>
      </div>`}
      ${tab === 'lots' && html`<${UI.Table} maxH="52vh" rows=${lots} rowCls=${(l) => (l.cancelled ? 'dim' : l.qtyLeft <= 0 ? 'dim' : '')} cols=${[
        { k: 'seq', t: '№ FIFO', a: 'r', w: '60px' },
        { k: 'at', t: 'Дата', r: (l) => U.fmtDT(l.at), v: (l) => l.at },
        { k: 'doc', t: 'Документ', r: (l) => html`<${UI.DocLink} r=${l.ref} title />` },
        { k: 'src', t: 'От кого', r: (l) => (l.source === 'initial' ? html`<i class="muted">начальный остаток</i>` : html`${E.cpName(l.cp)} <span class="pill">${l.source === 'neighbor' ? 'сосед' : 'поставщик'}</span>`) },
        { k: 'qtyInitial', t: 'Поступило', a: 'r', r: (l) => U.qty(l.qtyInitial) },
        { k: 'qtyLeft', t: 'Осталось', a: 'r', r: (l) => html`<b>${U.qty(l.qtyLeft)}</b>` },
        { k: 'purchasePrice', t: 'Закуп. цена', a: 'r', r: (l) => U.money(l.purchasePrice) },
        { k: 'extraCost', t: 'Допрасходы', a: 'r', r: (l) => UI.m(l.extraCost) },
        { k: 'unitCost', t: 'Себест. ед.', a: 'r', r: (l) => html`<b>${U.money(l.unitCost)}</b>` },
        { k: 'costLeft', t: 'Стоимость остатка', a: 'r', r: (l) => U.money(l.costLeft) },
        { k: 'st', t: '', r: (l) => (l.cancelled ? html`<span class="badge cancelled">аннулирована</span>` : l.qtyLeft <= 0 ? html`<span class="muted">израсходована</span>` : '') },
      ]} empty="Партий нет — товар ещё не поступал" />
`}
      ${tab === 'moves' && html`<${UI.Table} maxH="52vh" rows=${moves} cols=${[
        { k: 'at', t: 'Дата', r: (m) => U.fmtDT(m.at), v: (m) => m.at },
        { k: 'kind', t: 'Операция' },
        { k: 'doc', t: 'Документ', r: (m) => html`<${UI.DocLink} r=${m.ref} title />` },
        { k: 'cp', t: 'Контрагент', r: (m) => { const d = E.doc(m.ref); return d && 'cp' in d ? E.cpName(d.cp) : ''; } },
        { k: 'lot', t: 'Партия', r: (m) => { const l = E.lot(m.lotId); return l ? `№${l.seq} (${E.refNo(l.ref)})` : ''; } },
        { k: 'in', t: 'Приход', a: 'r', r: (m) => (m.qty > 0 ? U.qty(m.qty) : '') },
        { k: 'out', t: 'Расход', a: 'r', r: (m) => (m.qty < 0 ? U.qty(-m.qty) : '') },
        { k: 'cost', t: 'Себестоимость', a: 'r', r: (m) => UI.m(m.cost) },
        { k: 'user', t: 'Пользователь' },
      ]} empty="Движений нет" />`}
      ${tab === 'res' && html`<${UI.Table} maxH="52vh" rowKey=${(x) => x.order.id} rows=${resv} onOpen=${(x) => { UI.close(mid); UI.go('order', { id: x.order.id }); }} cols=${[
        { k: 'no', t: 'Заказ', r: (x) => x.order.no },
        { k: 'cp', t: 'Контрагент', r: (x) => E.cpName(x.order.cp) },
        { k: 'st', t: 'Статус', r: (x) => html`<${UI.Badge} st=${x.order.status} />` },
        { k: 'qty', t: 'Зарезервировано', a: 'r', r: (x) => U.qty(x.qty) },
      ]} empty="Действующих резервов нет" />`}`;
  }

  /* ================= Контрагенты ================= */
  S.cps = () => {
    const [q, setQ] = useState('');
    const [debtOnly, setDebtOnly] = useState(false);
    const [selId, setSelId] = useState(null);
    const search = useRef();
    const rows = E.S.cps.filter((c) => U.match(q, c.name, c.phone, c.code)).map((c) => ({ ...c, ...E.balance(c.id) })).filter((c) => !debtOnly || c.recv || c.pay);
    const tot = { recv: U.sum(rows, (r) => r.recv), pay: U.sum(rows, (r) => r.pay) };
    UI.useHotkeys((e) => {
      if (e.key === 'Insert' || e.key === 'F2') { UI.cpQuick('', (c) => UI.go('cp', { id: c.id })); return true; }
      if (e.ctrlKey && e.key.toLowerCase() === 'f') { search.current.focus(); return true; }
    });
    return html`
      <div class="head"><h1>Контрагенты и долги</h1></div>
      <div class="body" style="display:flex;flex-direction:column">
        <div class="kpis">
          <div class="kpi recv"><div class="t">Нам должны</div><div class="v">${U.money(tot.recv)}</div></div>
          <div class="kpi pay"><div class="t">Мы должны</div><div class="v">${U.money(tot.pay)}</div></div>
        </div>
        <div class="bar">
          <button class="btn pri" onClick=${() => UI.cpQuick('', (c) => UI.go('cp', { id: c.id }))}>${I('plus')} Создать<span class="kb">Ins</span></button>
          <button class="btn" disabled=${!rows.length} onClick=${() => UI.go('cp', { id: selId || rows[0].id })}>${I('eye')} Открыть<span class="kb">Enter</span></button>
          <div class="search"><input ref=${search} value=${q} autofocus placeholder="Поиск: имя, телефон" onInput=${(e) => setQ(e.target.value)} onKeyDown=${(e) => { if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); document.querySelector('.grid-wrap').focus(); } }} /></div>
          <label class="chk"><input type="checkbox" checked=${debtOnly} onChange=${(e) => setDebtOnly(e.target.checked)} />Только с долгами</label>
        </div>
        <${UI.Table} rows=${rows} onSel=${setSelId} onOpen=${(r) => UI.go('cp', { id: r.id })} sort=${{ k: 'name', d: 1 }} cols=${[
          { k: 'code', t: 'Код', w: '60px', cls: 'mono muted' },
          { k: 'name', t: 'Наименование' },
          { k: 'phone', t: 'Телефон', w: '150px' },
          { k: 'recv', t: 'Нам должны', a: 'r', w: '120px', r: (r) => (r.recv ? html`<span class="ok-t b">${U.money(r.recv)}</span>` : UI.m(0)) },
          { k: 'pay', t: 'Мы должны', a: 'r', w: '120px', r: (r) => (r.pay ? html`<span class="err-t b">${U.money(r.pay)}</span>` : UI.m(0)) },
          { k: 'net', t: 'Итог', w: '220px', r: (r) => netText(r.net) },
        ]} foot=${{ name: 'Итого', recv: U.money(tot.recv), pay: U.money(tot.pay) }} />
      </div>`;
  };
  const netText = (net) => (U.eq(net, 0) ? html`<span class="muted">—</span>` : net > 0 ? html`<span class="ok-t">должен нам ${U.som(net)}</span>` : html`<span class="err-t">мы должны ${U.som(-net)}</span>`);

  UI.cpCardModal = (id) => UI.modal({ title: E.cpName(id), size: 'wide', body: () => html`<${CpCard} id=${id} modal=${true} />` });
  S.cp = ({ id }) => html`<${CpCard} id=${id} />`;

  const CpCard = ({ id, modal }) => (E.cp(id) ? html`<${CpCardBody} id=${id} modal=${modal} />` : html`<div class="body">Контрагент не найден. <a onClick=${() => { UI.close(); UI.go('cps'); }}>К списку</a></div>`);
  function CpCardBody({ id, modal }) {
    const c = E.cp(id);
    const [tab, setTab] = useState('debts');
    const [showClosed, setShowClosed] = useState(false);
    const [d, setD] = useState({ name: c.name, phone: c.phone, note: c.note });
    const [errs, setErrs] = useState([]);
    useEffect(() => setD({ name: c.name, phone: c.phone, note: c.note }), [id]);
    const b = E.balance(id);
    const debts = E.debtsOf(id).sort((a, b) => a.seq - b.seq);
    const shownDebts = debts.filter((x) => showClosed || U.gt0(E.debtRem(x)));
    const is = (x) => x.cp === id;
    const docs = [
      ...E.S.receipts.filter(is), ...E.S.sales.filter(is), ...E.S.orders.filter(is), ...E.S.returns.filter(is), ...E.S.sreturns.filter(is),
    ].sort((a, b) => (b.at > a.at ? 1 : -1));
    const pays = E.S.payments.filter(is).sort((a, b) => (b.at > a.at ? 1 : -1));
    const rets = [...E.S.returns.filter(is), ...E.S.sreturns.filter(is)].filter((x) => x.status === 'posted');
    const offs = E.S.offsets.filter(is);
    const save = () => { try { E.saveCp(d, id); setErrs([]); UI.toast('Сохранено', 'ok'); } catch (e) { setErrs(e.details); } };
    const settle = (dir) => UI.settlement(id, dir);

    // хронология расчётов с нарастающим итогом (+ нам должны / − мы должны)
    const ledger = [];
    debts.forEach((x) => {
      const sgn = x.dir === 'recv' ? 1 : -1;
      ledger.push({ at: x.at, key: 'd' + x.id, ref: x.ref, text: `${x.dir === 'recv' ? 'Возник долг контрагента' : 'Возник наш долг'}${x.pid ? `: ${E.pName(x.pid)} ${U.qty(x.qty)} × ${U.money(x.price)}` : `: ${x.note || 'денежный'}`}`, delta: sgn * x.amount });
      E.S.allocs.filter((a) => a.debtId === x.id && !a.cancelled).forEach((a) => {
        const kind = { pay: 'Оплата деньгами', goods: 'Возврат товаром', offset: 'Взаимозачёт', pre: 'Погашено до начала учёта' }[a.kind];
        ledger.push({ at: a.at, key: 'a' + a.id, ref: a.ref, text: `${kind}${a.kind === 'goods' ? ` (${U.qty(a.qty)} ${E.product(x.pid).unit})` : ''} — ${x.pid ? E.pName(x.pid) : 'денежный долг'}`, delta: -sgn * a.amount });
      });
    });
    ledger.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.key < b.key ? -1 : 1));
    let run = 0; ledger.forEach((l) => { run = U.r2(run + l.delta); l.bal = run; });

    const byProduct = {};
    debts.filter((x) => x.pid && U.gt0(E.debtRem(x))).forEach((x) => {
      const k = x.dir + x.pid;
      const r = (byProduct[k] = byProduct[k] || { key: k, dir: x.dir, pid: x.pid, qty: 0, ret: 0, rem: 0, eq: 0 });
      r.qty += x.qty; r.ret += E.debtGoodsQty(x); r.rem += E.debtRem(x); r.eq += E.debtRem(x) / x.price;
    });

    return html`
      ${!modal ? html`<div class="head"><a onClick=${() => UI.go('cps')}>← Контрагенты</a><h1>${c.name}</h1><span class="muted">${c.phone}</span></div>` : null}
      <div class=${modal ? '' : 'body'}>
        <div class="kpis">
          <div class="kpi recv"><div class="t">Нам должны</div><div class="v">${U.money(b.recv)}</div></div>
          <div class="kpi pay"><div class="t">Мы должны</div><div class="v">${U.money(b.pay)}</div></div>
          <div class="kpi" style="min-width:260px"><div class="t">Итог: кто кому должен</div><div class="v" style="font-size:16px">${netText(b.net)}</div></div>
        </div>
        <div class="bar">
          <button class="btn pri" disabled=${!b.recv} onClick=${() => settle('recv')}>${I('wallet')} Принять погашение</button>
          <button class="btn pri" disabled=${!b.pay} onClick=${() => settle('pay')}>${I('hand-coins')} Погасить наш долг</button>
        </div>
        <div class="cp-actions">
          <button class="kassa-tile" onClick=${() => { UI.close(); const s = E.newSale({ cp: id }); UI.go('sale', { id: s.id }); }}>${I('shopping-cart', 34)}<span class="kt-title">Продажа</span><span class="kt-hint">Продать этому человеку</span></button>
          <button class="kassa-tile" onClick=${() => { UI.close(); const s = E.newSale({ cp: id, transfer: true }); UI.go('sale', { id: s.id }); }}>${I('hand-coins', 34)}<span class="kt-title">В долг</span><span class="kt-hint">Отдать товар без оплаты</span></button>
          <button class="kassa-tile" onClick=${() => { UI.close(); const r = E.newReceipt({ cp: id }); UI.go('receipt', { id: r.id }); }}>${I('package-plus', 34)}<span class="kt-title">Приход</span><span class="kt-hint">Принять товар от него</span></button>
          <button class="kassa-tile" onClick=${() => { UI.close(); const o = E.newOrder({ cp: id }); UI.go('order', { id: o.id }); }}>${I('clipboard-list', 34)}<span class="kt-title">Заказ</span><span class="kt-hint">Записать заказ</span></button>
        </div>
        <${UI.Tabs} cur=${tab} onChange=${setTab} tabs=${[
          { k: 'debts', t: 'Непогашенные обязательства', n: debts.filter((x) => U.gt0(E.debtRem(x))).length },
          { k: 'prod', t: 'Расшифровка по товарам' },
          { k: 'ledger', t: 'История расчётов', n: ledger.length },
          { k: 'docs', t: 'Документы', n: docs.length },
          { k: 'pays', t: 'Оплаты', n: pays.length },
          { k: 'rets', t: 'Возвраты товаров', n: rets.length },
          { k: 'offs', t: 'Взаимозачёты', n: offs.length },
          { k: 'main', t: 'Основные данные' },
        ]} />
        ${tab === 'debts' && html`
          <div class="bar"><label class="chk"><input type="checkbox" checked=${showClosed} onChange=${(e) => setShowClosed(e.target.checked)} />Показать погашенные строки</label>
            </div>
          <${DebtTable} rows=${shownDebts} maxH=${modal ? '40vh' : 'calc(100vh - 330px)'} />`}
        ${tab === 'prod' && html`<${UI.Table} maxH="50vh" rowKey=${(r) => r.key} rows=${Object.values(byProduct)} cols=${[
          { k: 'dir', t: 'Сторона', r: (r) => html`<span class="pill ${r.dir}">${r.dir === 'recv' ? 'нам должны' : 'мы должны'}</span>` },
          { k: 'pid', t: 'Товар', r: (r) => E.pName(r.pid) },
          { k: 'qty', t: 'Передано / получено', a: 'r', r: (r) => U.qtyU(r.qty, E.product(r.pid).unit) },
          { k: 'ret', t: 'Возвращено товаром', a: 'r', r: (r) => UI.q(r.ret) },
          { k: 'rem', t: 'Осталось, сом', a: 'r', r: (r) => html`<b>${U.money(r.rem)}</b>` },
          { k: 'eq', t: 'Товарный эквивалент', a: 'r', r: (r) => `≈ ${U.qty(r.eq)} ${E.product(r.pid).unit}` },
        ]} empty="Непогашенных товарных долгов нет" />
`}
        ${tab === 'ledger' && html`<${UI.Table} maxH="55vh" rowKey=${(l) => l.key} rows=${ledger} cols=${[
          { k: 'at', t: 'Дата', r: (l) => U.fmtDT(l.at), v: (l) => l.at },
          { k: 'doc', t: 'Документ', r: (l) => html`<${UI.DocLink} r=${l.ref} title />` },
          { k: 'text', t: 'Операция', cls: 'wrap' },
          { k: 'delta', t: 'Изменение', a: 'r', r: (l) => html`<span class=${l.delta > 0 ? 'ok-t' : 'err-t'}>${l.delta > 0 ? '+' : ''}${U.money(l.delta)}</span>` },
          { k: 'bal', t: 'Сальдо', a: 'r', r: (l) => html`<b>${U.money(l.bal)}</b>` },
        ]} />
`}
        ${tab === 'docs' && html`<${UI.Table} maxH="55vh" rows=${docs} rowKey=${(x) => x.id} onOpen=${(x) => { UI.close(); UI.openRef(E.ref(x)); }} cols=${[
          { k: 'at', t: 'Дата', r: (x) => U.fmtDT(x.at), v: (x) => x.at },
          { k: 't', t: 'Вид', r: (x) => E.TITLE[x.t] + (x.transfer ? ' (передача в долг)' : '') },
          { k: 'no', t: 'Номер' },
          { k: 'sum', t: 'Сумма', a: 'r', r: (x) => U.money(docSum(x)) },
          { k: 'status', t: 'Статус', r: (x) => html`<${UI.Badge} st=${x.status} />` },
        ]} />`}
        ${tab === 'pays' && html`<${UI.Table} maxH="55vh" rows=${pays} onOpen=${(x) => UI.openRef(E.ref(x))} cols=${[
          { k: 'at', t: 'Дата', r: (x) => U.fmtDT(x.at), v: (x) => x.at }, { k: 'no', t: 'Номер' },
          { k: 'dir', t: 'Направление', r: (x) => (x.dir === 'in' ? html`<span class="ok-t">получено</span>` : html`<span class="err-t">выдано</span>`) },
          { k: 'amount', t: 'Сумма', a: 'r', r: (x) => U.money(x.amount) },
          { k: 'src', t: 'Основание', r: (x) => (x.src ? html`<${UI.DocLink} r=${x.src} title />` : x.comment) },
          { k: 'status', t: 'Статус', r: (x) => html`<${UI.Badge} st=${x.status} />` },
        ]} empty="Оплат нет" />`}
        ${tab === 'rets' && html`<${UI.Table} maxH="55vh" rows=${rets} onOpen=${(x) => { UI.close(); UI.openRef(E.ref(x)); }} cols=${[
          { k: 'at', t: 'Дата', r: (x) => U.fmtDT(x.at), v: (x) => x.at },
          { k: 't', t: 'Вид', r: (x) => (x.t === 'ret' ? 'Контрагент вернул нам' : 'Мы вернули контрагенту') }, { k: 'no', t: 'Номер' },
          { k: 'goods', t: 'Товары', cls: 'wrap', r: (x) => x.lines.filter((l) => U.gt0(l.qty)).map((l) => `${E.pName(l.pid)} — ${U.qty(l.qty)}`).join('; ') },
          { k: 'amount', t: 'Сумма', a: 'r', r: (x) => U.money(x.amount) },
        ]} empty="Возвратов нет" />`}
        ${tab === 'offs' && html`<${UI.Table} maxH="55vh" rows=${offs} onOpen=${(x) => UI.openRef(E.ref(x))} cols=${[
          { k: 'at', t: 'Дата', r: (x) => U.fmtDT(x.at), v: (x) => x.at }, { k: 'no', t: 'Номер' },
          { k: 'amount', t: 'Сумма зачёта', a: 'r', r: (x) => U.money(x.amount) },
          { k: 'trigger', t: 'После документа', r: (x) => html`<${UI.DocLink} r=${x.trigger} title />` },
          { k: 'detail', t: 'Закрыто', cls: 'wrap', r: (x) => E.S.allocs.filter((a) => a.ref.t === 'off' && a.ref.id === x.id).map((a) => { const dd = E.debt(a.debtId); return `${dd.dir === 'recv' ? 'их' : 'наш'}: ${dd.pid ? E.pName(dd.pid) : 'ден.'} ${U.money(a.amount)}`; }).join('; ') },
        ]} empty="Взаимозачётов не было" />
`}
        ${tab === 'main' && html`<div class="form one">
          <label class="l">Код</label><div class="mono">${c.code}</div>
          <label class="l">Имя или название *</label><div class="fw"><input class="in ${UI.hasErr(errs, 'name') ? 'bad' : ''}" value=${d.name} onInput=${(e) => setD({ ...d, name: e.target.value })} /><${UI.FieldErr} errs=${errs} field="name" /></div>
          <label class="l">Телефон</label><input class="in" value=${d.phone} onInput=${(e) => setD({ ...d, phone: e.target.value })} />
          <label class="l">Комментарий</label><input class="in" value=${d.note} onInput=${(e) => setD({ ...d, note: e.target.value })} />
          <span></span><div><button class="btn pri" onClick=${save}>Записать</button></div>
        </div>`}
      </div>`;
  }
  const docSum = (x) => (x.t === 'receipt' ? (x.goods ?? E.receiptCalc(x).goods) : x.t === 'sale' ? (x.total ?? E.calcLines(x).total) : x.t === 'order' ? E.calcLines(x).total : x.amount ?? 0);

  function DebtTable({ rows, maxH }) {
    return html`<${UI.Table} maxH=${maxH} rows=${rows} rowCls=${(x) => (U.gt0(E.debtRem(x)) ? '' : 'dim')} cols=${[
      { k: 'dir', t: 'Сторона', w: '92px', r: (x) => html`<span class="pill ${x.dir}">${x.dir === 'recv' ? 'нам должны' : 'мы должны'}</span>` },
      { k: 'at', t: 'Дата', r: (x) => U.fmtDate(x.at), v: (x) => x.at },
      { k: 'doc', t: 'Документ', r: (x) => html`<${UI.DocLink} r=${x.ref} />` },
      { k: 'pid', t: 'Товар', r: (x) => (x.pid ? E.pName(x.pid) : html`<i class="muted">${x.note || 'денежный долг'}</i>`) },
      { k: 'qty', t: 'Кол-во', a: 'r', r: (x) => (x.pid ? U.qtyU(x.qty, E.product(x.pid).unit) : '—') },
      { k: 'price', t: 'Цена', a: 'r', r: (x) => (x.price ? U.money(x.price) : '—') },
      { k: 'amount', t: 'Сумма', a: 'r', r: (x) => U.money(x.amount) },
      { k: 'goods', t: 'Возвращено товаром', a: 'r', tip: 'Физически возвращённый товар', r: (x) => { const g = E.debtPart(x, 'goods'); return g ? html`${U.money(g)} <span class="muted">(${U.qty(E.debtGoodsQty(x))})</span>` : UI.m(0); } },
      { k: 'pay', t: 'Оплачено деньгами', a: 'r', r: (x) => UI.m(E.debtPart(x, 'pay') + E.debtPart(x, 'pre')) },
      { k: 'off', t: 'Взаимозачётом', a: 'r', r: (x) => UI.m(E.debtPart(x, 'offset')) },
      { k: 'rem', t: 'Осталось', a: 'r', v: (x) => E.debtRem(x), r: (x) => html`<b>${U.money(E.debtRem(x))}</b>` },
      { k: 'eq', t: 'Экв. товара', a: 'r', tip: 'Остаток долга в пересчёте по цене исходной строки — денежный эквивалент', r: (x) => (x.pid && U.gt0(E.debtRem(x)) ? `≈ ${U.qty(E.debtRem(x) / x.price)}` : '') },
    ]} empty="Непогашенных обязательств нет" />`;
  }
  UI.DebtTable = DebtTable;

  /* ================= Погашение долга: товар + деньги ================= */
  UI.settlement = (cp, dir) => {
    const mid = UI.modal({ title: `${dir === 'recv' ? 'Погашение долга контрагента' : 'Погашение нашего долга'} — ${E.cpName(cp)}`, size: 'wide', sticky: true, body: () => html`<${Settlement} cp=${cp} dir=${dir} mid=${mid} />` });
  };
  function Settlement({ cp, dir, mid }) {
    const debts = E.openDebts(cp, dir);
    const [rows, setRows] = useState(() => debts.map((d) => ({ debtId: d.id, goods: 0, money: 0 })));
    const [total0, setTotal] = useState(null); // null — сумма следует за распределением по строкам
    const total = total0 === null ? U.r2(U.sum(rows, (r) => (U.isNum(r.money) ? r.money : 0))) : total0;
    const [comment, setComment] = useState('');
    const [tried, setTried] = useState(false);
    const v = E.validateSettlement(cp, dir, rows, total);
    const errs = tried ? v.errs : v.errs.filter((e) => e.line !== undefined);
    const setRow = (i, k, val) => { const n = [...rows]; n[i] = { ...n[i], [k]: val }; setRows(n); };
    const autoFill = () => {
      // вспомогательная кнопка: распределить введённую сумму по строкам начиная со старых (пользователь может изменить)
      let left = U.isNum(total) ? total : 0;
      setRows(v.calc.map((x, i) => { const cap = U.r2(x.rem - x.gToDebt); const m = U.r2(Math.min(cap, left)); left = U.r2(left - m); return { ...rows[i], money: m }; }));
    };
    const goodsTotal = U.sum(v.calc, (x) => x.gToDebt);
    const moneyAlloc = U.sum(v.calc, (x) => x.m);
    const excess = U.sum(v.calc, (x) => x.excess);
    const remBefore = U.sum(v.calc, (x) => x.rem);
    const remAfter = U.r2(remBefore - goodsTotal - moneyAlloc);
    const post = () => {
      setTried(true);
      if (v.errs.length) return;
      UI.run(() => E.postSettlement(cp, dir, rows, total, comment), (created) => `Проведено: ${created.map((r) => E.refNo(r)).join(', ')}`) && UI.close(mid);
    };
    const back = dir === 'recv' ? 'на наш склад' : 'со склада соседу';
    return html`
      <div class="bar">
        <label>Сумма оплаты деньгами:</label>
        <${UI.Num} cls="in num" style="width:130px" value=${total} onChange=${setTotal} bad=${UI.hasErr(errs, 'moneyTotal')} title="Если не вводить сумму, она равна распределению по строкам" />
        <button class="btn sm" onClick=${autoFill} title="Заполнить колонку «Оплата» начиная со старых строк — можно исправить вручную">Распределить по старым</button>
        <span class="sp"></span>
        <input class="in" style="width:260px" placeholder="Комментарий" value=${comment} onInput=${(e) => setComment(e.target.value)} />
      </div>
      <div class="grid-wrap" style="max-height:46vh">
        <table class="grid">
          <thead><tr><th>Документ</th><th>Товар</th><th class="r">Исх. кол-во × цена</th><th class="r">Возвр. товаром</th><th class="r">Оплачено</th><th class="r">Зачтено</th><th class="r">Осталось</th><th class="r">Экв.</th>
            <th class="r" style="width:110px;background:#f3ecd0">Вернуть товаром</th><th class="r" style="width:110px;background:#f3ecd0">Оплата, сом</th><th class="r">Останется</th></tr></thead>
          <tbody>${v.calc.map((x, i) => {
            const d = x.d; const u = d.pid ? E.product(d.pid).unit : ''; const can = E.canReturnGoods(d);
            const le = errs.filter((e) => e.line === i);
            return html`
              <tr key=${d.id} class=${le.length ? 'bad' : ''}>
                <td><${UI.DocLink} r=${d.ref} /></td>
                <td>${d.pid ? E.pName(d.pid) : html`<i class="muted">${d.note || 'денежный долг'}</i>`}</td>
                <td class="num">${d.pid ? `${U.qty(d.qty)} ${u} × ${U.money(d.price)}` : U.money(d.amount)}</td>
                <td class="num">${d.pid ? html`${UI.q(E.debtGoodsQty(d))}` : '—'}</td>
                <td class="num">${UI.m(E.debtPart(d, 'pay') + E.debtPart(d, 'pre'))}</td>
                <td class="num">${UI.m(E.debtPart(d, 'offset'))}</td>
                <td class="num b">${U.money(x.rem)}</td>
                <td class="num muted">${d.pid ? `≈${U.qty(x.rem / d.price)}` : ''}</td>
                <td class="ed">${can.ok
                  ? html`<${UI.Num} data-g="st" data-r=${i} data-c="g" onKeyDown=${UI.gridKey} value=${rows[i].goods} onChange=${(val) => setRow(i, 'goods', val)} bad=${UI.hasErr(le, 'goods')} title=${`Можно вернуть до ${U.qty(can.max)} ${u}`} />`
                  : html`<span class="muted" title=${can.why} style="font-size:11px;padding:0 4px">только деньгами ⓘ</span>`}</td>
                <td class="ed"><${UI.Num} data-g="st" data-r=${i} data-c="m" onKeyDown=${UI.gridKey} value=${rows[i].money} onChange=${(val) => setRow(i, 'money', val)} bad=${UI.hasErr(le, 'money')} /></td>
                <td class="num b ${x.after < -0.001 ? 'neg' : ''}">${U.money(Math.max(x.after, 0))}</td>
              </tr>
              ${le.length ? html`<tr class="errrow"><td colspan="11">${le.map((e) => e.msg).join(' · ')}</td></tr>` : null}
              ${U.gt0(x.excess) ? html`<tr class="errrow" style="color:#7a5200"><td colspan="11" style="background:var(--warn-bg);color:#7a5200">Стоимость возвращаемого товара (${U.money(x.gAmount)}) больше остатка долга по строке — разница ${U.money(x.excess)} станет обязательством ${dir === 'recv' ? 'вернуть деньги контрагенту' : 'контрагента вернуть нам деньги'}.</td></tr>` : null}`;
          })}</tbody>
          <tfoot><tr><td colspan="6">Итого</td><td class="num">${U.money(remBefore)}</td><td></td><td class="num">${U.money(goodsTotal)}</td><td class="num">${U.money(moneyAlloc)}</td><td class="num">${U.money(Math.max(remAfter, 0))}</td></tr></tfoot>
        </table>
      </div>
      <${UI.ErrList} errs=${tried ? v.errs.filter((e) => e.line === undefined) : []} />
      <div class="card" style="margin-top:8px">
        <h3>Результат</h3>
        ${v.calc.filter((x) => U.gt0(x.g)).map((x) => html`<div class="kv"><span>Товар ${back}: ${E.pName(x.d.pid)}</span><span class="v">${U.qtyU(x.g, E.product(x.d.pid).unit)}</span></div>`)}
        <div class="kv"><span>Долг уменьшится возвратом товара</span><span class="v">${U.money(goodsTotal)}</span></div>
        <div class="kv"><span>Долг уменьшится деньгами (${dir === 'recv' ? 'получаем' : 'выдаём'})</span><span class="v">${U.money(moneyAlloc)}</span></div>
        ${U.gt0(excess) ? html`<div class="kv"><span>Встречное обязательство из-за возврата</span><span class="v warn-t">${U.money(excess)}</span></div>` : null}
        <div class="kv sep big"><span>Останется долг</span><span class="v">${U.money(Math.max(remAfter, 0))}</span></div>
      </div>
      <div class="modal-f" style="padding:8px 0 0">
        <span class="sp"></span>
        <button class="btn pri" onClick=${post}>Провести погашение</button>
        <button class="btn" onClick=${() => UI.close(mid)}>Отмена</button>
      </div>`;
  }
})();
