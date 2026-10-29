/* Документы: продажа, возврат покупателя, поступление, заказ, лист сборки. */
(function () {
  const { html, useState, useEffect, useRef } = window.htmPreact;
  const S = (window.Screens = window.Screens || {});
  const upd = () => E.changed();
  const I = (n, s) => html`<${UI.Icon} name=${n} size=${s} />`;
  const focusPicker = () => setTimeout(() => { const el = document.getElementById('picker'); if (el) el.focus(); }, 0);

  /* ================= Списки документов ================= */
  function DocList({ title, tabs, tab, setTab, rows, cols, onNew, newLabel, onOpen, statusOpts }) {
    const [q, setQ] = useState('');
    const [st, setSt] = useState('all');
    const search = useRef();
    const filtered = rows.filter((d) => (st === 'all' || d.status === st || (st === 'active' && E.ORDER_ACTIVE.includes(d.status))) && U.match(q, d.no, E.cpName(d.cp), d.comment || ''));
    UI.useHotkeys((e) => {
      if (onNew && (e.key === 'F2' || e.key === 'Insert')) { onNew(); return true; }
      if (e.ctrlKey && e.key.toLowerCase() === 'f') { search.current.focus(); return true; }
    });
    return html`
      <div class="head"><h1>${title}</h1></div>
      <div class="body" style="display:flex;flex-direction:column">
        ${tabs ? html`<${UI.Tabs} tabs=${tabs} cur=${tab} onChange=${setTab} />` : null}
        <div class="bar">
          ${onNew ? html`<button class="btn pri" onClick=${onNew}>${newLabel}<span class="kb">F2</span></button>` : null}
          <div class="search"><input ref=${search} value=${q} placeholder="Поиск: номер, контрагент, комментарий" onInput=${(e) => setQ(e.target.value)} onKeyDown=${(e) => { if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); document.querySelector('.grid-wrap').focus(); } }} /></div>
          <${UI.Seg} value=${st} onChange=${setSt} opts=${statusOpts || [{ v: 'all', t: 'Все' }, { v: 'draft', t: 'Черновики' }, { v: 'posted', t: 'Проведённые' }, { v: 'cancelled', t: 'Отменённые' }]} />
        </div>
        <${UI.Table} key=${tab} autoFocus rows=${filtered} cols=${cols} onOpen=${onOpen} sort=${{ k: 'at', d: -1 }} rowCls=${(d) => (d.status === 'cancelled' ? 'dim' : '')} />
        <div class="statusline"><span>Документов: ${filtered.length}</span></div>
      </div>`;
  }
  const colAt = { k: 'at', t: 'Дата', w: '120px', r: (d) => U.fmtDT(d.postedAt || d.at), v: (d) => d.postedAt || d.at };
  const colNo = { k: 'no', t: 'Номер', w: '82px', cls: 'mono' };
  const colSt = { k: 'status', t: 'Статус', w: '96px', r: (d) => html`<${UI.Badge} st=${d.status} />` };
  const colCp = { k: 'cp', t: 'Контрагент', v: (d) => E.cpName(d.cp), r: (d) => (d.cp ? E.cpName(d.cp) : html`<span class="muted">Розничный покупатель</span>`) };
  const colAuthor = { k: 'author', t: 'Автор', w: '100px' };
  const saleDebt = (s) => U.sum(E.S.debts.filter((d) => !d.cancelled && d.ref.t === 'sale' && d.ref.id === s.id), E.debtRem);

  S.sales = ({ tab: tab0 }) => {
    const [tab, setTab] = useState(tab0 || 'sales');
    const newSale = () => { const s = E.newSale(); UI.go('sale', { id: s.id }); };
    const common = { title: 'Продажи', tab, setTab, tabs: [{ k: 'sales', t: 'Продажи', n: E.S.sales.length }, { k: 'rets', t: 'Возвраты покупателей', n: E.S.returns.length }], onNew: newSale, newLabel: 'Новая продажа' };
    if (tab === 'rets') return html`<${DocList} ...${common} rows=${E.S.returns} onOpen=${(d) => UI.go('ret', { id: d.id })} cols=${[
      colAt, colNo, colCp,
      { k: 'sale', t: 'По продаже', r: (d) => E.refNo({ t: 'sale', id: d.saleId }) },
      { k: 'amount', t: 'Сумма возврата', a: 'r', r: (d) => U.money(d.amount ?? E.returnCalc(d).amount) },
      { k: 'toDebt', t: 'Уменьшен долг', a: 'r', r: (d) => UI.m(d.toDebt || 0) },
      { k: 'refund', t: 'К выдаче', a: 'r', r: (d) => UI.m(d.refund || 0) },
      colSt, colAuthor]} />`;
    return html`<${DocList} ...${common} rows=${E.S.sales} onOpen=${(d) => UI.go('sale', { id: d.id })} cols=${[
      colAt, colNo,
      { k: 'cp', t: 'Контрагент', v: (d) => E.cpName(d.cp), r: (d) => html`${d.cp ? E.cpName(d.cp) : html`<span class="muted">Розничный покупатель</span>`}${d.transfer ? html` <span class="badge transfer">передача в долг</span>` : ''}${d.orderId ? html` <span class="pill">из заказа</span>` : ''}` },
      { k: 'total', t: 'Сумма', a: 'r', v: (d) => d.total ?? E.calcLines(d).total, r: (d) => U.money(d.total ?? E.calcLines(d).total) },
      { k: 'disc', t: 'Скидка', a: 'r', r: (d) => UI.m(d.disc ?? E.calcLines(d).disc) },
      { k: 'paid', t: 'Оплачено', a: 'r', r: (d) => UI.m(d.paid || 0) },
      { k: 'debt', t: 'Долг сейчас', a: 'r', v: saleDebt, r: (d) => (d.status === 'posted' ? UI.m(saleDebt(d)) : '') },
      { k: 'rets', t: 'Возвраты', r: (d) => E.S.returns.filter((r) => r.saleId === d.id && r.status === 'posted').map((r) => r.no).join(', ') },
      colSt, colAuthor]} />`;
  };

  S.orders = () => html`<${DocList} title="Заказы" rows=${E.S.orders}
    onNew=${() => { const o = E.newOrder(); UI.go('order', { id: o.id }); }} newLabel="Новый заказ" onOpen=${(d) => UI.go('order', { id: d.id })}
    statusOpts=${[{ v: 'all', t: 'Все' }, { v: 'draft', t: 'Черновики' }, { v: 'active', t: 'Действующие' }, { v: 'done', t: 'Выполненные' }, { v: 'cancelled', t: 'Отменённые' }]}
    cols=${[colAt, colNo, colCp,
      { k: 'n', t: 'Позиций', a: 'r', r: (d) => d.lines.length },
      { k: 'total', t: 'Сумма', a: 'r', v: (d) => E.calcLines(d).total, r: (d) => U.money(E.calcLines(d).total) },
      { k: 'comment', t: 'Комментарий для сборщика', cls: 'muted' },
      { k: 'status', t: 'Статус', w: '96px', r: (d) => html`<${UI.Badge} st=${d.status} />` },
      { k: 'sale', t: 'Продажа', r: (d) => (d.saleId ? (E.doc({ t: 'sale', id: d.saleId }) || {}).no : '') }]} />`;

  S.receipts = ({ tab: tab0 }) => {
    const [tab, setTab] = useState(tab0 || 'rc');
    const common = { title: 'Поступления', tab, setTab, tabs: [{ k: 'rc', t: 'Поступления', n: E.S.receipts.length }, { k: 'sr', t: 'Возвраты поставщикам', n: E.S.sreturns.length }] };
    if (tab === 'sr') return html`<${DocList} ...${common} rows=${E.S.sreturns} onOpen=${(d) => UI.openRef(E.ref(d))} cols=${[colAt, colNo, colCp,
      { k: 'goods', t: 'Товары', r: (d) => d.lines.map((l) => `${E.pName(l.pid)} — ${U.qty(l.qty)}`).join('; ') },
      { k: 'amount', t: 'Сумма', a: 'r', r: (d) => U.money(d.amount) }, colSt, colAuthor]} />`;
    return html`<${DocList} ...${common} rows=${E.S.receipts} onNew=${() => { const r = E.newReceipt(); UI.go('receipt', { id: r.id }); }} newLabel="Новое поступление" onOpen=${(d) => UI.go('receipt', { id: d.id })} cols=${[
      colAt, colNo, colCp,
      { k: 'goods', t: 'Сумма закупки', a: 'r', v: (d) => E.receiptCalc(d).goods, r: (d) => U.money(E.receiptCalc(d).goods) },
      { k: 'extras', t: 'Допрасходы', a: 'r', r: (d) => UI.m(E.receiptCalc(d).extras) },
      { k: 'paid', t: 'Оплачено', a: 'r', r: (d) => UI.m(d.paid || 0) },
      { k: 'comment', t: 'Комментарий', cls: 'muted' },
      colSt, colAuthor]} />`;
  };

  /* ================= Общие части документов ================= */
  const DocHead = ({ back, backTitle, title, doc, extra }) => html`
    <div class="head">
      <a onClick=${back}>← ${backTitle}</a>
      <h1>${title} ${doc.no} <span class="muted" style="font-size:13px;font-weight:400">от ${U.fmtDT(doc.postedAt || doc.at)}</span></h1>
      <${UI.Badge} st=${doc.status} />${extra}
      <span style="margin-left:auto" class="muted">Автор: ${doc.author}${doc.postedBy ? ` · провёл: ${doc.postedBy}` : ''}</span>
    </div>`;

  // Таблица строк продажи/заказа (редактируемая)
  function LinesEditor({ doc, exceptOrderId, priceEditable, errs, shortages, onShortage, g = 'ln' }) {
    const calc = E.calcLines(doc);
    const setL = (i, k, v) => { doc.lines[i][k] = v; upd(); };
    const del = (i) => { doc.lines.splice(i, 1); upd(); focusPicker(); };
    const dup = (i) => { doc.lines.splice(i + 1, 0, { ...doc.lines[i], qty: doc.lines[i].pid && E.product(doc.lines[i].pid).unit === 'шт' ? 1 : doc.lines[i].qty }); upd(); UI.focusCell(g, i + 1, 'qty'); };
    const lastIdx = {};
    doc.lines.forEach((l, i) => (lastIdx[l.pid] = i));
    const qtyKey = (e) => { if (e.key === 'Enter' && !e.ctrlKey) { e.preventDefault(); focusPicker(); } else UI.gridKey(e); };
    return html`
      <div class="grid-wrap" style="flex:1;min-height:160px">
        <table class="grid">
          <thead><tr><th style="width:30px">№</th><th style="width:110px">Категория</th><th>Товар</th><th style="width:36px">Ед.</th><th class="r" style="width:80px">Доступно</th>
            <th class="r" style="width:90px">Количество</th><th class="r" style="width:100px">Цена</th><th class="r" style="width:120px">Скидка</th><th class="r" style="width:90px">Скидка, сом</th><th class="r" style="width:100px">Сумма</th><th style="width:62px"></th></tr></thead>
          <tbody>${doc.lines.map((l, i) => {
            const p = E.product(l.pid) || {}; const c = calc.lines[i];
            const av = E.available(l.pid, exceptOrderId);
            const sh = shortages[l.pid] && lastIdx[l.pid] === i ? shortages[l.pid] : null;
            const le = (errs || []).filter((e) => e.line === i && !e.short);
            return html`
              <tr key=${i} class=${sh || le.length ? 'bad' : ''}>
                <td class="num muted">${i + 1}</td><td class="muted">${p.category || ''}</td>
                <td title=${E.productLabel(p)}>${E.productLabel(p)} <button class="ibtn" title="Карточка товара (документ остаётся открытым)" onClick=${() => UI.productCard(p.id)}>ⓘ</button></td>
                <td>${p.unit}</td>
                <td class="num ${av <= 0 ? 'neg' : ''}">${U.qty(av)}</td>
                <td class="ed"><${UI.Num} data-g=${g} data-r=${i} data-c="qty" onKeyDown=${qtyKey} value=${l.qty} onChange=${(v) => setL(i, 'qty', v)} bad=${!!sh || UI.hasErr(le, 'qty')} /></td>
                <td class=${priceEditable ? 'ed' : 'num'}>${priceEditable ? html`<${UI.Num} data-g=${g} data-r=${i} data-c="price" onKeyDown=${UI.gridKey} value=${l.price} onChange=${(v) => setL(i, 'price', v)} bad=${UI.hasErr(le, 'price')} />` : U.money(l.price)}</td>
                <td class="ed"><div class="disc-ed"><${UI.Num} data-g=${g} data-r=${i} data-c="disc" onKeyDown=${UI.gridKey} value=${calc.lines[i].lineDisc} onChange=${(v) => { l.dType = 'сум'; setL(i, 'dVal', v); }} bad=${UI.hasErr(le, 'disc')} />
                  <span>сом</span></div></td>
                <td class="num">${UI.m(c.disc)}</td>
                <td class="num b">${U.money(c.amount)}</td>
                <td class="c"><button class="ibtn" title="Ещё строка этого товара (например, по другой цене)" onClick=${() => dup(i)}>⧉</button><button class="xbtn" title="Удалить строку" onClick=${() => del(i)}>×</button></td>
              </tr>
              ${sh ? html`<tr class="errrow"><td colspan="11"><b>Не хватает товара.</b> ${E.shortageText(sh)} ${onShortage ? html`<button class="btn sm pri" style="margin-left:8px" onClick=${() => onShortage(sh)}>Создать приход на ${U.qtyU(sh.missing, p.unit)}</button>` : null}</td></tr>` : null}
              ${le.length ? html`<tr class="errrow"><td colspan="11">${le.map((e) => e.msg).join(' · ')}</td></tr>` : null}`;
          })}</tbody>
        </table>
        ${!doc.lines.length ? html`<div class="grid-empty">Найдите товар в строке поиска выше и нажмите Enter — он добавится сюда.</div>` : null}
      </div>`;
  }
  const addLine = (doc, p, g, merge) => {
    const i = merge ? doc.lines.findIndex((l) => l.pid === p.id) : -1;
    if (i >= 0) { const l = doc.lines[i]; l.qty = U.r3((U.isNum(l.qty) ? l.qty : 0) + 1); upd(); UI.focusCell(g, i, 'qty'); return; }
    doc.lines.push(E.lineFromProduct(p, doc.transfer ? p.retailPrice : undefined));
    upd(); UI.focusCell(g, doc.lines.length - 1, 'qty');
  };
  // «Создать приход» из документа с нехваткой: документ остаётся черновиком
  const quickReceipt = (doc, sh) => {
    const p = E.product(sh.pid);
    const r = E.newReceipt({ lines: [{ pid: p.id, qty: sh.missing, price: p.purchasePrice }], returnTo: E.ref(doc), comment: `Для ${E.TITLE[doc.t].toLowerCase()} ${doc.no}` });
    UI.toast(`${E.TITLE[doc.t]} ${doc.no} сохранена как черновик. Оформите приход.`);
    UI.go('receipt', { id: r.id });
  };

  /* ================= Продажа ================= */
  S.sale = ({ id }) => {
    const s = E.doc({ t: 'sale', id });
    if (!s) return html`<div class="body">Документ не найден. <a onClick=${() => UI.go('sales')}>К списку продаж</a></div>`;
    return s.status === 'draft' ? html`<${SaleEdit} s=${s} key=${id} />` : html`<${SaleView} s=${s} key=${id} />`;
  };

  function SaleEdit({ s }) {
    const [tried, setTried] = useState(false);
    const [busy, setBusy] = useState(false);
    const { errs, calc } = E.validateSale(s);
    const shortages = E.shortages(s, s.orderId);
    const shownErrs = tried ? errs : [];
    const debt = U.r2(calc.total - (U.isNum(s.paid) ? s.paid : 0));
    const order = s.orderId ? E.doc({ t: 'order', id: s.orderId }) : null;
    const leave = () => { if (!s.lines.length && !s.cp && s.status === 'draft') E.deleteDraft(E.ref(s)); UI.go('sales'); };
    const post = () => {
      setTried(true);
      if (busy) return;
      if (errs.length) { UI.toast(errs[0].msg, 'err'); return; }
      setBusy(true);
      const res = UI.run(() => E.postSale(s.id), (r) => `Продажа ${s.no} проведена. ${U.gt0(r.debt) ? `Долг ${E.cpName(s.cp)}: ${U.som(r.debt)}.` : 'Оплачена полностью.'}${r.offset ? ` Взаимозачёт ${U.som(r.offset.amount)}.` : ''}`);
      setBusy(false);
      return res;
    };
    const acceptPayment = () => payModal(s, calc.total);
    const switchPrice = (pt) => {
      s.priceType = pt;
      s.lines.forEach((l) => { const p = E.product(l.pid); if (p) l.price = E.productPrice(p, pt); });
      upd();
    };
    UI.useHotkeys((e) => {
      if (e.ctrlKey && e.key === 'Enter') { post(); return true; }
      if (e.key === 'F8') { acceptPayment(); return true; }
      if (e.key === 'F4') { focusPicker(); return true; }
      if (e.key === 'Escape' && !UI.isTyping(e)) { leave(); return true; }
    });
    return html`
      <${DocHead} back=${leave} backTitle="Продажи" title=${s.transfer ? 'Передача товара в долг' : 'Продажа'} doc=${s} extra=${s.transfer ? html`<span class="badge transfer">передача в долг</span>` : ''} />
      <div class="body split">
        <div class="left">
          <div class="form" style="grid-template-columns:max-content 1fr max-content 1fr">
            <label class="l">Контрагент</label>
            <div><${UI.CpSelect} value=${s.cp} bad=${UI.hasErr(shownErrs, 'cp')} placeholder="Розничный покупатель (по умолчанию)" onChange=${(v) => { s.cp = v; upd(); }} /></div>
            <label class="l">Тип цены</label>
            <div><${UI.Seg} value=${s.priceType || 'retail'} onChange=${switchPrice} opts=${E.PRICE_OPTS} />
              <label class="chk" style="margin-left:12px"><input type="checkbox" checked=${s.transfer} disabled=${!!s.orderId} onChange=${(e) => { s.transfer = e.target.checked; upd(); }} />Передача в долг</label></div>
            ${order ? html`<label class="l">Заказ</label><div>${order.no} — товар зарезервирован</div>` : null}
          </div>
          <div class="bar"><${UI.ProductPicker} autoFocus exceptOrderId=${s.orderId} onPick=${(p) => addLine(s, p, 'ln', !s.transfer)} /><${UI.FieldErr} errs=${shownErrs} field="cp" /></div>
          <${LinesEditor} doc=${s} g="ln" exceptOrderId=${s.orderId} priceEditable=${true} errs=${shownErrs} shortages=${shortages} onShortage=${(sh) => quickReceipt(s, sh)} />
        </div>
        <div class="right">
          <div class="card"><h3>Итоги</h3>
            <div class="kv"><span>Сумма без скидок</span><span class="v">${U.money(calc.gross)}</span></div>
            <${DocDiscount} doc=${s} errs=${shownErrs} />
            <div class="kv"><span>Скидки</span><span class="v">${U.money(calc.disc)}</span></div>
            <div class="kv big sep"><span>Итого</span><span class="v">${U.money(calc.total)}</span></div>
          </div>
          <div class="card"><h3>Оплата</h3>
            <div class="kv"><span>Оплачено</span><span class="v">${U.money(s.paid || 0)}</span></div>
            <div class="kv"><span>Долг</span><span class="v ${U.gt0(debt) ? 'err-t' : ''}">${U.money(debt)}</span></div>
            <button class="btn" style="width:100%;margin-top:4px" onClick=${acceptPayment}>${I('wallet')} Принять оплату<span class="kb">F8</span></button>
          </div>
          <div class="actions">
            <button class="btn pri" disabled=${busy} onClick=${post}>${I('check')} Провести<span class="kb">Ctrl+Enter</span></button>
            ${!s.orderId && !s.transfer ? html`<button class="btn" onClick=${() => { const o = UI.run(() => E.saleToOrder(s.id), 'Сохранено как заказ'); if (o) UI.go('order', { id: o.id }); }}>${I('clipboard-list')} Сохранить как заказ</button>` : null}
            <button class="btn" onClick=${leave}>${I('save')} Отложить</button>
            <button class="btn danger" onClick=${async () => { if (await UI.confirm('Удалить черновик продажи?', { ok: 'Удалить', danger: true })) { E.deleteDraft(E.ref(s)); UI.go('sales'); } }}>${I('trash')} Удалить черновик</button>
          </div>
          <${UI.ErrList} errs=${shownErrs.filter((e) => e.line === undefined && !['cp', 'paid', 'docDisc'].includes(e.field))} />
        </div>
      </div>`;
  }

  function payModal(s, total) {
    const Body = ({ id }) => {
      const [methods, setMethods] = useState(() => (s.payMethods && Object.keys(s.payMethods).length ? { ...s.payMethods } : { cash: U.gt0(s.paid) ? s.paid : total, mbank: 0 }));
      const num = (v) => (U.isNum(v) ? v : 0);
      const paid = U.r2(Object.keys(E.PAY_LABELS).reduce((a, k) => a + num(methods[k]), 0));
      const bad = paid > total + 0.0001;
      const debtAmount = U.r2(total - paid);
      const setM = (k, v) => setMethods((m) => ({ ...m, [k]: v }));
      const ok = () => { if (bad) return; s.paid = paid; s.payMethods = { ...methods }; upd(); UI.close(id); };
      return html`<div class="pay-modal" onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ok(); } }}>
        <div class="pay-row big"><span>К оплате</span><span class="v">${U.money(total)}</span></div>
        <div class="pay-divider"></div>
        <div class="pay-methods">${Object.keys(E.PAY_LABELS).map((k, i) => html`<div class="pay-method"><label>${E.PAY_LABELS[k]}</label><${UI.Num} cls="in num pay-input" autofocus=${i === 0} value=${methods[k]} onChange=${(v) => setM(k, v)} /></div>`)}</div>
        ${bad ? html`<div class="note err">Сумма оплаты больше суммы продажи</div>` : null}
        ${U.gt0(debtAmount) && !bad ? html`<div class="note warn">Неоплаченная сумма ${U.som(debtAmount)} станет долгом${s.cp ? ` контрагента ${E.cpName(s.cp)}` : ''}</div>` : null}
        <div class="pay-footer">
          <button class="btn" onClick=${() => setMethods({ cash: total, mbank: 0 })}>Вся сумма наличными</button>
          <button class="btn" onClick=${() => setMethods({ cash: 0, mbank: 0 })}>В долг</button>
          <span class="sp"></span>
          <button class="btn pri" disabled=${bad} onClick=${ok}>OK</button>
          <button class="btn" onClick=${() => UI.close(id)}>Закрыть</button>
        </div>
      </div>`;
    };
    UI.modal({ title: `Оплата — ${s.no}`, body: (mid) => html`<${Body} id=${mid} />` });
  }

  function SaleView({ s }) {
    const rets = E.S.returns.filter((r) => r.saleId === s.id);
    const debts = E.S.debts.filter((d) => d.ref.t === 'sale' && d.ref.id === s.id);
    const pays = E.S.payments.filter((p) => p.src && p.src.t === 'sale' && p.src.id === s.id);
    const offs = E.S.offsets.filter((o) => o.trigger && o.trigger.t === 'sale' && o.trigger.id === s.id);
    const posted = s.status === 'posted';
    const debtNow = U.sum(debts.filter((d) => !d.cancelled), E.debtRem);
    const order = s.orderId ? E.doc({ t: 'order', id: s.orderId }) : null;
    const newRet = () => { const r = UI.run(() => E.newReturn(s.id)); if (r) UI.go('ret', { id: r.id }); };
    const cancel = async () => { if (await UI.confirm(`Отменить проведение ${s.no}?\nТовар вернётся в исходные партии, долг и оплата будут сторнированы. Документ останется в истории со статусом «Отменён».`, { ok: 'Отменить проведение', danger: true })) UI.run(() => E.cancelSale(s.id), 'Проведение отменено'); };
    UI.useHotkeys((e) => { if (e.key === 'Escape' && !UI.isTyping(e)) { UI.go('sales'); return true; } });
    return html`
      <${DocHead} back=${() => UI.go('sales')} backTitle="Продажи" title=${s.transfer ? 'Передача товара в долг' : 'Продажа'} doc=${s} extra=${s.transfer ? html`<span class="badge transfer">передача в долг</span>` : ''} />
      <div class="body split">
        <div class="left">
          <div class="form" style="grid-template-columns:max-content 1fr max-content 1fr">
            <label class="l">Контрагент</label><div>${s.cp ? html`<a onClick=${() => UI.go('cp', { id: s.cp })}>${E.cpName(s.cp)}</a>` : html`<span class="muted">Розничный покупатель</span>`}</div>
            <label class="l">Заказ</label><div>${order ? html`<a onClick=${() => UI.go('order', { id: order.id })}>${order.no}</a> — резерв использован` : '—'}</div>
            <label class="l">Комментарий</label><div>${s.comment || '—'}</div>
            <label class="l">Учётные поля</label><div class="muted">заблокированы после проведения</div>
          </div>
          <div class="grid-wrap" style="flex:1">
            <table class="grid">
              <thead><tr><th>№</th><th>Товар</th><th>Ед.</th><th class="r">Кол-во</th><th class="r">Базовая цена</th><th class="r">Скидка</th><th class="r">Сумма</th><th class="r">Себестоимость FIFO</th><th class="r">Валовая прибыль</th><th class="r">Возвращено</th><th>Списано из партий</th></tr></thead>
              <tbody>${s.lines.map((l, i) => {
                const p = E.product(l.pid); const rt = E.returnedOf(s.id, i);
                return html`<tr key=${i}><td class="num muted">${i + 1}</td><td>${E.productLabel(p)}</td><td>${p.unit}</td><td class="num">${U.qty(l.qty)}</td><td class="num">${U.money(l.price)}</td>
                  <td class="num">${UI.m(l.disc)}</td><td class="num b">${U.money(l.amount)}</td><td class="num">${U.money(l.cogs)}</td><td class="num">${U.money(l.amount - l.cogs)}</td>
                  <td class="num">${rt.qty ? html`<span class="warn-t">${U.qty(rt.qty)}</span>` : UI.q(0)}</td>
                  <td class="wrap sub-lines" style="min-width:150px">${(l.wo || []).map((w) => { const lot = E.lot(w.lotId); return html`<div title=${`Партия №${lot.seq}, ${E.refTitle(lot.ref)}${lot.cp ? ', ' + E.cpName(lot.cp) : ''}`}>${U.qty(w.qty)} × ${U.money(w.cost / w.qty)} <span class="mono">${E.refNo(lot.ref)}</span></div>`; })}</td></tr>`;
              })}</tbody>
              <tfoot><tr><td></td><td>Итого</td><td></td><td></td><td class="num">${U.money(s.gross)}</td><td class="num">${U.money(s.disc)}</td><td class="num">${U.money(s.total)}</td><td class="num">${U.money(s.cogs)}</td><td class="num">${U.money(s.total - s.cogs)}</td><td></td><td></td></tr></tfoot>
            </table>
          </div>
          ${debts.length ? html`<h2 class="sec">Долг по строкам продажи</h2><${UI.DebtTable} rows=${debts.filter((d) => !d.cancelled)} maxH="200px" />` : null}
        </div>
        <div class="right">
          <div class="card"><h3>Итоги</h3>
            <div class="kv"><span>Сумма без скидок</span><span class="v">${U.money(s.gross)}</span></div>
            <div class="kv"><span>Скидки</span><span class="v">${U.money(s.disc)}</span></div>
            <div class="kv big sep"><span>Итого</span><span class="v">${U.money(s.total)}</span></div>
            <div class="kv"><span>Оплачено при продаже</span><span class="v">${U.money(s.paid)}</span></div>
            <div class="kv"><span>Долг по продаже сейчас</span><span class="v ${U.gt0(debtNow) ? 'err-t' : ''}">${U.money(debtNow)}</span></div>
            <div class="kv sep"><span>Себестоимость (FIFO)</span><span class="v">${U.money(s.cogs)}</span></div>
            <div class="kv"><span>Валовая прибыль</span><span class="v">${U.money(s.total - s.cogs)}</span></div>
          </div>
          <div class="card"><h3>Связанные документы</h3>
            ${pays.map((p) => html`<div class="kv"><span><${UI.DocLink} r=${E.ref(p)} title /></span><span class="v">${U.money(p.amount)}</span></div>`)}
            ${offs.map((o) => html`<div class="kv"><span><${UI.DocLink} r=${E.ref(o)} title /></span><span class="v">${U.money(o.amount)}</span></div>`)}
            ${rets.map((r) => html`<div class="kv"><span><${UI.DocLink} r=${E.ref(r)} title /> <${UI.Badge} st=${r.status} /></span><span class="v">${U.money(r.amount ?? 0)}</span></div>`)}
            ${!pays.length && !offs.length && !rets.length ? html`<div class="muted">—</div>` : null}
          </div>
          <div class="actions">
            ${posted ? html`<button class="btn pri" onClick=${newRet}>Создать возврат</button>` : null}
            <button class="btn" onClick=${() => { const c = E.copyDoc(E.ref(s)); UI.go('sale', { id: c.id }); }}>Скопировать в новую продажу</button>
            ${posted ? html`<button class="btn danger" onClick=${cancel}>Отменить проведение</button>` : null}
          </div>
          ${s.status === 'cancelled' ? html`<div class="note err">Проведение отменено ${U.fmtDT(s.cancelledAt)} (${s.cancelledBy}). Документ сохранён в истории.</div>` : null}
        </div>
      </div>`;
  }

  /* ================= Возврат покупателя ================= */
  S.ret = ({ id }) => {
    const r = E.doc({ t: 'ret', id });
    if (!r || !E.doc({ t: 'sale', id: r.saleId })) return html`<div class="body">Документ не найден</div>`;
    return html`<${RetDoc} r=${r} key=${id} />`;
  };
  function RetDoc({ r }) {
    const draft = r.status === 'draft';
    const [tried, setTried] = useState(false);
    const s = E.doc({ t: 'sale', id: r.saleId });
    const { errs, calc } = draft ? E.validateReturn(r) : { errs: [], calc: null };
    const shown = tried ? errs : errs.filter((e) => e.line !== undefined);
    const post = () => { setTried(true); if (errs.length) { UI.toast(errs[0].msg, 'err'); return; } UI.run(() => E.postReturn(r.id), (x) => `Возврат ${r.no} проведён${x.offset ? `, взаимозачёт ${U.som(x.offset.amount)}` : ''}`); };
    const leave = () => { if (draft && !r.lines.some((l) => U.gt0(l.qty))) E.deleteDraft(E.ref(r)); UI.go('sale', { id: s.id }); };
    UI.useHotkeys((e) => {
      if (draft && e.ctrlKey && e.key === 'Enter') { post(); return true; }
      if (e.key === 'Escape' && !UI.isTyping(e)) { leave(); return true; }
    });
    const lines = draft ? calc.lines : null;
    return html`
      <${DocHead} back=${leave} backTitle=${`Продажа ${s.no}`} title="Возврат покупателя" doc=${r} />
      <div class="body split">
        <div class="left">
          <div class="form">
            <label class="l">Исходная продажа</label><div><a onClick=${() => UI.go('sale', { id: s.id })}>${s.no} от ${U.fmtDT(s.postedAt)}</a> <span class="muted">— не редактируется</span></div>
            <label class="l">Контрагент</label><div>${E.cpName(r.cp)}</div>
            <label class="l">Комментарий</label><div class="full">${draft ? html`<input class="in" value=${r.comment} onInput=${(e) => { r.comment = e.target.value; upd(); }} placeholder="Причина возврата" />` : r.comment || '—'}</div>
          </div>
          <div class="grid-wrap" style="flex:1">
            <table class="grid">
              <thead><tr><th>№</th><th>Товар</th><th>Ед.</th><th class="r">Продано</th><th class="r">Возвращено ранее</th><th class="r">Можно вернуть</th><th class="r" style="background:#f3ecd0;width:90px">Вернуть</th><th class="r" title="Фактическая цена продажи с учётом скидки">Цена факт.</th><th class="r">Сумма</th>${draft ? null : html`<th class="r">Себестоимость</th>`}</tr></thead>
              <tbody>${r.lines.map((l, i) => {
                const sl = s.lines[l.li]; const p = E.product(sl.pid);
                if (!draft && !U.gt0(l.qty)) return null;
                const x = draft ? lines[i] : null;
                const le = shown.filter((e) => e.line === i);
                return html`<tr key=${i} class=${le.length ? 'bad' : ''}><td class="num muted">${l.li + 1}</td><td>${E.productLabel(p)}</td><td>${p.unit}</td>
                  <td class="num">${U.qty(sl.qty)}</td>
                  <td class="num">${draft ? UI.q(x.done.qty) : ''}</td>
                  <td class="num b">${draft ? U.qty(x.can) : ''}</td>
                  <td class=${draft ? 'ed' : 'num b'}>${draft ? html`<${UI.Num} data-g="rt" data-r=${i} data-c="q" onKeyDown=${UI.gridKey} value=${l.qty} onChange=${(v) => { l.qty = v; if (!r.cp) r.refundNow = E.returnCalc(r).refund; upd(); }} bad=${le.length > 0} />` : U.qty(l.qty)}</td>
                  <td class="num">${U.money(sl.amount / sl.qty)}${U.gt0(sl.disc) ? html` <span class="muted" title=${`Базовая ${U.money(sl.price)}, скидка по строке ${U.money(sl.disc)}`}>ⓘ</span>` : ''}</td>
                  <td class="num b">${U.money(draft ? x.amount : l.amount)}</td>
                  ${draft ? null : html`<td class="num">${U.money(l.cogs)}</td>`}</tr>
                  ${le.length ? html`<tr class="errrow"><td colspan="10">${le.map((e) => e.msg).join(' · ')}</td></tr>` : null}`;
              })}</tbody>
            </table>
          </div>
        </div>
        <div class="right">
          ${draft ? html`
            <div class="card"><h3>Расчёт</h3>
              <div class="kv big"><span>Сумма возврата</span><span class="v">${U.money(calc.amount)}</span></div>
              <div class="kv"><span>Уменьшит долг покупателя</span><span class="v">${U.money(calc.toDebt)}</span></div>
              <div class="kv sep"><span>К возврату деньгами</span><span class="v ${U.gt0(calc.refund) ? 'err-t' : ''}">${U.money(calc.refund)}</span></div>
              <div class="kv"><span>Выдать сейчас</span><span style="width:120px"><${UI.Num} cls="in num" value=${r.refundNow} onChange=${(v) => { r.refundNow = v; upd(); }} bad=${UI.hasErr(shown, 'refundNow') || UI.hasErr(errs, 'refundNow') && tried} /></span></div>
              <${UI.FieldErr} errs=${tried ? errs : []} field="refundNow" />
              ${r.cp && U.gt0(calc.refund - (r.refundNow || 0)) ? html`<div class="note warn">Невыданные ${U.som(calc.refund - (r.refundNow || 0))} станут нашим обязательством перед контрагентом (и могут закрыться взаимозачётом).</div>` : null}
            </div>
            <div class="actions"><button class="btn pri" onClick=${post}>${I('check')} Провести возврат<span class="kb">Ctrl+Enter</span></button>
              <button class="btn danger" onClick=${() => { E.deleteDraft(E.ref(r)); UI.go('sale', { id: s.id }); }}>Удалить черновик</button></div>
            <${UI.ErrList} errs=${tried ? errs.filter((e) => e.line === undefined && e.field !== 'refundNow') : []} />` : html`
            <div class="card"><h3>Итоги</h3>
              <div class="kv big"><span>Сумма возврата</span><span class="v">${U.money(r.amount)}</span></div>
              <div class="kv"><span>Уменьшен долг покупателя</span><span class="v">${U.money(r.toDebt)}</span></div>
              <div class="kv"><span>К возврату деньгами</span><span class="v">${U.money(r.refund)}</span></div>
              <div class="kv"><span>Выдано при возврате</span><span class="v">${U.money(r.refundNow)}</span></div>
              <div class="kv sep"><span>Себестоимость восстановлена</span><span class="v">${U.money(r.cogs)}</span></div>
            </div>
            <div class="card"><h3>Восстановленные партии</h3>
              ${r.lines.filter((l) => U.gt0(l.qty)).map((l) => l.restored.map((x) => { const lot = E.lot(x.lotId); return html`<div class="kv" style="font-size:12px"><span>${E.pName(l.pid)} — партия №${lot.seq} (${E.refNo(lot.ref)})</span><span class="v">${U.qty(x.qty)} / ${U.money(x.cost)}</span></div>`; }))}
            </div>`}
        </div>
      </div>`;
  }

  /* ================= Поступление ================= */
  S.receipt = ({ id }) => {
    const r = E.doc({ t: 'receipt', id });
    if (!r) return html`<div class="body">Документ не найден</div>`;
    return html`<${ReceiptDoc} r=${r} key=${id} />`;
  };
  function ReceiptDoc({ r }) {
    const draft = r.status === 'draft';
    const [tried, setTried] = useState(false);
    const [showExtras, setShowExtras] = useState(r.extras.length > 0);
    const errs = draft ? E.validateReceipt(r) : [];
    const shown = tried ? errs : [];
    const c = E.receiptCalc(r);
    const back = r.returnTo ? E.doc(r.returnTo) : null;
    const backLabel = back ? `${E.TITLE[back.t]} ${back.no}` : 'Поступления';
    const goBack = () => { if (draft && !r.lines.length && !r.cp) E.deleteDraft(E.ref(r)); if (back) UI.go(back.t, { id: back.id }); else UI.go('receipts'); };
    const post = () => {
      setTried(true);
      if (errs.length) { UI.toast(errs[0].msg, 'err'); return; }
      const res = UI.run(() => E.postReceipt(r.id), (x) => `Поступление ${r.no} проведено: создано партий ${r.lines.length}${x.offset ? `, взаимозачёт ${U.som(x.offset.amount)}` : ''}`);
      if (res && back && back.status === 'draft') { UI.toast(`Остатки обновлены. Возврат в ${E.TITLE[back.t].toLowerCase()} ${back.no}.`, 'ok'); UI.go(back.t, { id: back.id }); }
    };
    const setL = (i, k, v) => { r.lines[i][k] = v; upd(); };
    UI.useHotkeys((e) => {
      if (draft && e.ctrlKey && e.key === 'Enter') { post(); return true; }
      if (draft && e.key === 'F4') { focusPicker(); return true; }
      if (e.key === 'Escape' && !UI.isTyping(e)) { goBack(); return true; }
    });
    const cancel = async () => { if (await UI.confirm(`Отменить проведение ${r.no}?\nПартии будут аннулированы, долг и оплата — сторнированы. Если товар уже продан или по долгу были операции, отмена будет заблокирована.`, { ok: 'Отменить проведение', danger: true })) UI.run(() => E.cancelReceipt(r.id), 'Проведение отменено'); };
    const pv = draft && r.cp && U.gt0(c.debt) ? E.offsetPreview(r.cp, 'pay', c.debt) : null;
    return html`
      <${DocHead} back=${goBack} backTitle=${backLabel} title="Поступление" doc=${r} />
      <div class="body split">
        <div class="left">
          ${back && draft ? html`<div class="note warn" style="margin-top:0"><b>Приход создан из документа ${back.no}</b>, который сохранён черновиком со всеми строками, скидками и контрагентом. После проведения вы автоматически вернётесь в него. Если приход не провести, остаток не увеличится.
            <button class="btn sm" style="margin-left:8px" onClick=${goBack}>Вернуться в ${back.no} без проведения</button></div>` : null}
          <div class="form" style="grid-template-columns:max-content minmax(260px,420px) max-content 1fr">
            <label class="l">Контрагент *</label>
            <div class="fw">${draft ? html`<${UI.CpSelect} value=${r.cp} bad=${UI.hasErr(shown, 'cp')} placeholder="Поставщик или сосед" onChange=${(v) => { r.cp = v; upd(); }} />` : html`<a onClick=${() => UI.go('cp', { id: r.cp })}>${E.cpName(r.cp)}</a>`}<${UI.FieldErr} errs=${shown} field="cp" /></div>
            <label class="l">Комментарий</label>
            <div class="full">${draft ? html`<input class="in" value=${r.comment} onInput=${(e) => { r.comment = e.target.value; upd(); }} placeholder="Номер накладной, примечание" />` : r.comment || '—'}</div>
          </div>
          ${draft ? html`<div class="bar"><${UI.ProductPicker} purchase autoFocus=${!back} onPick=${(p) => { r.lines.push({ pid: p.id, qty: 1, price: p.purchasePrice, wholesale: p.wholesalePrice, retail: p.retailPrice }); upd(); UI.focusCell('rc', r.lines.length - 1, 'qty'); }} />
            <button class="btn" onClick=${() => { setShowExtras(true); r.extras.push({ name: '', amount: 0 }); upd(); UI.focusCell('ex', r.extras.length - 1, 'name'); }}>Добавить дополнительные расходы</button></div>` : null}
          <div class="grid-wrap" style="flex:1;min-height:140px">
            <table class="grid">
              <thead><tr><th style="width:30px">№</th><th>Товар</th><th style="width:36px">Ед.</th><th class="r" style="width:95px">Количество</th><th class="r" style="width:105px">Цена за ед.</th><th class="r" style="width:95px">Опт. цена</th><th class="r" style="width:95px">Розн. цена</th><th class="r" style="width:105px">Сумма</th><th class="r" style="width:95px">Доля допрасх.</th><th class="r" style="width:110px">Себестоимость</th><th class="r" style="width:95px">Себест. ед.</th>${draft ? html`<th style="width:30px"></th>` : html`<th class="r">Осталось в партии</th>`}</tr></thead>
              <tbody>${r.lines.map((l, i) => {
                const p = E.product(l.pid); const x = c.lines[i]; const le = shown.filter((e) => e.line === i);
                const lot = !draft && l.lotId ? E.lot(l.lotId) : null;
                return html`<tr key=${i} class=${le.length ? 'bad' : ''}><td class="num muted">${i + 1}</td><td>${E.productLabel(p)} <button class="ibtn" onClick=${() => UI.productCard(p.id)}>ⓘ</button></td><td>${p.unit}</td>
                  <td class=${draft ? 'ed' : 'num'}>${draft ? html`<${UI.Num} data-g="rc" data-r=${i} data-c="qty" value=${l.qty} onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); UI.focusCell('rc', i, 'price'); } else UI.gridKey(e); }} onChange=${(v) => setL(i, 'qty', v)} bad=${UI.hasErr(le, 'qty')} />` : U.qty(l.qty)}</td>
                  <td class=${draft ? 'ed' : 'num'}>${draft ? html`<${UI.Num} data-g="rc" data-r=${i} data-c="price" value=${l.price} onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); focusPicker(); } else UI.gridKey(e); }} onChange=${(v) => setL(i, 'price', v)} bad=${UI.hasErr(le, 'price')} />` : U.money(l.price)}</td>
                  ${['wholesale', 'retail'].map((k) => html`<td class=${draft ? 'ed' : 'num'}>${draft ? html`<${UI.Num} data-g="rc" data-r=${i} data-c=${k} onKeyDown=${UI.gridKey} value=${l[k]} onChange=${(v) => setL(i, k, v)} bad=${UI.hasErr(le, k)} />` : (U.isNum(l[k]) ? U.money(l[k]) : '')}</td>`)}
                  <td class="num">${U.money(x.amount)}</td><td class="num">${UI.m(x.extra)}</td><td class="num b">${U.money(x.cost)}</td><td class="num">${U.money(x.unitCost)}</td>
                  ${draft ? html`<td class="c"><button class="xbtn" onClick=${() => { r.lines.splice(i, 1); upd(); }}>×</button></td>` : html`<td class="num">${lot ? (lot.cancelled ? html`<span class="badge cancelled">аннулирована</span>` : U.qty(lot.qtyLeft)) : ''}</td>`}</tr>
                  ${le.length ? html`<tr class="errrow"><td colspan="12">${le.map((e) => e.msg).join(' · ')}</td></tr>` : null}`;
              })}</tbody>
              <tfoot><tr><td></td><td>Итого</td><td></td><td></td><td></td><td></td><td></td><td class="num">${U.money(c.goods)}</td><td class="num">${U.money(c.extras)}</td><td class="num">${U.money(c.cost)}</td><td></td><td></td></tr></tfoot>
            </table>
            ${!r.lines.length ? html`<div class="grid-empty">Найдите товар в строке поиска и нажмите Enter. Один товар можно указать несколькими строками с разными ценами.</div>` : null}
          </div>
          ${showExtras || r.extras.length ? html`
            <h2 class="sec">Дополнительные расходы <span class="muted" style="font-weight:400;font-size:12px">— распределяются пропорционально стоимости строк и увеличивают себестоимость партий; долг поставщику не увеличивают</span></h2>
            <div class="grid-wrap" style="max-height:150px;max-width:560px">
              <table class="grid"><thead><tr><th>Название</th><th class="r" style="width:130px">Сумма</th>${draft ? html`<th style="width:30px"></th>` : null}</tr></thead>
                <tbody>${r.extras.map((x, i) => { const le = shown.filter((e) => e.extra === i); return html`<tr key=${i} class=${le.length ? 'bad' : ''}>
                  <td class=${draft ? 'ed left' : ''}>${draft ? html`<input data-g="ex" data-r=${i} data-c="name" class=${UI.hasErr(le, 'name') ? 'bad' : ''} value=${x.name} placeholder="например, Доставка" onInput=${(e) => { x.name = e.target.value; upd(); }} />` : x.name}</td>
                  <td class=${draft ? 'ed' : 'num'}>${draft ? html`<${UI.Num} data-g="ex" data-r=${i} data-c="amount" value=${x.amount} onChange=${(v) => { x.amount = v; upd(); }} bad=${UI.hasErr(le, 'amount')} />` : U.money(x.amount)}</td>
                  ${draft ? html`<td class="c"><button class="xbtn" onClick=${() => { r.extras.splice(i, 1); upd(); }}>×</button></td>` : null}</tr>`; })}</tbody>
                <tfoot><tr><td>Итого допрасходов</td><td class="num">${U.money(c.extras)}</td>${draft ? html`<td></td>` : null}</tr></tfoot></table>
            </div>
            <${UI.FieldErr} errs=${shown} field="extras" />
` : null}
          <${UI.ErrList} errs=${shown.filter((e) => e.line === undefined && e.extra === undefined && !['cp', 'paid', 'extras'].includes(e.field))} />
        </div>
        <div class="right">
          <div class="card"><h3>Итоги</h3>
            <div class="kv"><span>Сумма закупки</span><span class="v">${U.money(c.goods)}</span></div>
            <div class="kv"><span>Дополнительные расходы</span><span class="v">${U.money(c.extras)}</span></div>
            <div class="kv big sep"><span>Себестоимость</span><span class="v">${U.money(c.cost)}</span></div>
          </div>
          <div class="card"><h3>Расчёт с контрагентом</h3>
            <div class="kv"><span>Оплачено</span><span style="width:120px">${draft ? html`<${UI.Num} cls="in num" value=${r.paid} onChange=${(v) => { r.paid = v; upd(); }} bad=${UI.hasErr(shown, 'paid')} />` : html`<span class="v">${U.money(r.paid)}</span>`}</span></div>
            ${draft ? html`<div style="text-align:right"><button class="btn link" onClick=${() => { r.paid = c.goods; upd(); }}>оплачено полностью</button></div>` : null}
            <${UI.FieldErr} errs=${shown} field="paid" />
            <div class="kv sep"><span>Долг перед контрагентом</span><span class="v ${U.gt0(c.debt) ? 'err-t' : ''}">${U.money(Math.max(0, c.debt))}</span></div>
          </div>
          <div class="actions">
            ${draft ? html`
              <button class="btn pri" onClick=${post}>${I('check')} Провести${back ? ` и вернуться в ${back.no}` : ''}<span class="kb">Ctrl+Enter</span></button>
              <button class="btn" onClick=${goBack}>${I('save')} Записать черновик</button>
              <button class="btn danger" onClick=${async () => { if (await UI.confirm('Удалить черновик поступления?', { ok: 'Удалить', danger: true })) { E.deleteDraft(E.ref(r)); if (back) UI.go(back.t, { id: back.id }); else UI.go('receipts'); } }}>${I('trash')} Удалить черновик</button>
` : html`
              ${r.status === 'posted' && E.openDebts(r.cp, 'pay').length ? html`<button class="btn" onClick=${() => UI.settlement(r.cp, 'pay')}>Погасить долг / вернуть товар</button>` : null}
              <button class="btn" onClick=${() => { const n = E.copyDoc(E.ref(r)); UI.go('receipt', { id: n.id }); }}>${I('copy')} Скопировать</button>
              ${r.status === 'posted' ? html`<button class="btn danger" onClick=${cancel}>${I('ban')} Отменить проведение</button>` : null}
              ${r.status === 'cancelled' ? html`<div class="note err">Проведение отменено ${U.fmtDT(r.cancelledAt)} (${r.cancelledBy}).</div>` : null}`}
          </div>
        </div>
      </div>`;
  }

  /* ================= Заказ ================= */
  S.order = ({ id }) => {
    const o = E.doc({ t: 'order', id });
    if (!o) return html`<div class="body">Документ не найден</div>`;
    return html`<${OrderDoc} o=${o} key=${id} />`;
  };
  function OrderDoc({ o }) {
    const [work, setWork] = useState(null); // рабочая копия при изменении действующего заказа
    const [tried, setTried] = useState(false);
    const active = E.ORDER_ACTIVE.includes(o.status);
    const editable = o.status === 'draft' || !!work;
    const doc = work || o;
    const reserveMode = active;
    const { errs, calc } = E.validateOrder(doc.id ? doc : { ...o, ...doc }, false);
    const shortages = E.shortages(doc, o.id);
    const shown = tried ? errs : [];
    const sale = o.saleId ? E.doc({ t: 'sale', id: o.saleId }) : null;
    const status = (to, msg) => UI.run(() => E.setOrderStatus(o.id, to), msg);
    const startEdit = () => setWork({ ...U.clone({ cp: o.cp, comment: o.comment, lines: o.lines, dType: o.dType, dVal: o.dVal }), id: o.id, t: 'order', no: o.no });
    const saveEdit = () => { setTried(true); if (UI.run(() => E.saveOrderEdit(o.id, work), 'Заказ изменён, резерв пересчитан') !== undefined) { setWork(null); setTried(false); } };
    const confirmOrder = () => { setTried(true); if (errs.length) { UI.toast(errs[0].msg, 'err'); return; } if (Object.keys(shortages).length) { UI.toast('Резерв сверх доступного остатка невозможен — оформите приход или уменьшите количество', 'err'); return; } if (status('assembling', 'Заказ подтверждён: товар зарезервирован') !== undefined) setTried(false); };
    const toSale = () => { const s = UI.run(() => E.saleFromOrder(o.id)); if (s) UI.go('sale', { id: s.id }); };
    const leave = () => { if (o.status === 'draft' && !o.lines.length && !o.cp) E.deleteDraft(E.ref(o)); UI.go('orders'); };
    UI.useHotkeys((e) => {
      if (e.key === 'F4' && editable) { focusPicker(); return true; }
      if (e.ctrlKey && e.key === 'Enter') { if (work) saveEdit(); else if (o.status === 'draft') confirmOrder(); return true; }
      if (e.ctrlKey && e.key.toLowerCase() === 'p' && active) { printSheet(o); return true; }
      if (e.key === 'Escape' && !UI.isTyping(e)) { if (work) setWork(null); else leave(); return true; }
    });
    const upd2 = work ? () => setWork({ ...work }) : upd;
    const bind = (k, v) => { doc[k] = v; upd2(); };
    const reserveNow = active ? o.lines : [];
    return html`
      <${DocHead} back=${leave} backTitle="Заказы" title="Заказ" doc=${o} extra=${work ? html`<span class="badge draft">изменение</span>` : ''} />
      <div class="body split">
        <div class="left">
          <div class="form" style="grid-template-columns:max-content minmax(260px,420px) max-content 1fr">
            <label class="l">Контрагент</label>
            <div>${editable ? html`<${UI.CpSelect} value=${doc.cp} onChange=${(v) => bind('cp', v)} placeholder="Покупатель" />` : doc.cp ? html`<a onClick=${() => UI.go('cp', { id: o.cp })}>${E.cpName(o.cp)}</a>` : '—'}</div>
            <label class="l">Комментарий для сборщика</label>
            ${editable ? html`<input class="in" value=${doc.comment} onInput=${(e) => { doc.comment = e.target.value; work ? setWork({ ...work }) : upd(); }} placeholder="Что важно при сборке" />` : html`<div>${o.comment || '—'}</div>`}
          </div>
          ${editable ? html`
            <div class="bar"><${UI.ProductPicker} autoFocus exceptOrderId=${o.id} onPick=${(p) => { if (work) { work.lines.push(E.lineFromProduct(p)); setWork({ ...work }); UI.focusCell('ol', work.lines.length - 1, 'qty'); } else addLine(o, p, 'ol', true); }} /></div>
            ${work ? html`<${WorkLines} work=${work} setWork=${setWork} errs=${shown} shortages=${shortages} o=${o} />`
              : html`<${LinesEditor} doc=${o} g="ol" exceptOrderId=${o.id} priceEditable=${false} errs=${shown} shortages=${shortages} onShortage=${(sh) => quickReceipt(o, sh)} />`}` : html`
            <div class="grid-wrap" style="flex:1">
              <table class="grid"><thead><tr><th>№</th><th>Товар</th><th>Ед.</th><th class="r">Количество</th><th class="r">Цена</th><th class="r">Скидка</th><th class="r">Сумма</th>${active ? html`<th class="r">Остаток</th><th class="r">Зарезервировано</th>` : null}</tr></thead>
                <tbody>${o.lines.map((l, i) => { const p = E.product(l.pid); const c = calc.lines[i]; return html`<tr key=${i}><td class="num muted">${i + 1}</td><td>${E.productLabel(p)}</td><td>${p.unit}</td><td class="num">${U.qty(l.qty)}</td><td class="num">${U.money(l.price)}</td><td class="num">${UI.m(c.disc)}</td><td class="num b">${U.money(c.amount)}</td>
                  ${active ? html`<td class="num">${U.qty(E.stock(l.pid))}</td><td class="num b" style="color:#1b5bab">${U.qty(l.qty)}</td>` : null}</tr>`; })}</tbody>
                <tfoot><tr><td></td><td>Итого</td><td></td><td></td><td class="num">${U.money(calc.gross)}</td><td class="num">${U.money(calc.disc)}</td><td class="num">${U.money(calc.total)}</td>${active ? html`<td></td><td></td>` : null}</tr></tfoot></table>
            </div>`}
          <${UI.ErrList} errs=${shown.filter((e) => e.line === undefined && e.field !== 'docDisc')} />
        </div>
        <div class="right">
          <div class="card"><h3>Итоги</h3>
            <div class="kv"><span>Сумма без скидок</span><span class="v">${U.money(calc.gross)}</span></div>
            ${editable ? html`<${DocDiscount} doc=${doc} errs=${errs} onChange=${upd2} />` : null}
            <div class="kv"><span>Скидки</span><span class="v">${U.money(calc.disc)}</span></div>
            <div class="kv big sep"><span>Итого</span><span class="v">${U.money(calc.total)}</span></div>
          </div>
          ${active ? html`<div class="card"><h3>Резерв</h3>${reserveNow.map((l) => html`<div class="kv" style="font-size:12px"><span>${E.pName(l.pid)}</span><span class="v">${U.qtyU(l.qty, E.product(l.pid).unit)}</span></div>`)}</div>` : null}
          <div class="actions">
            ${work ? html`
              <button class="btn pri" onClick=${saveEdit}>${I('save')} Сохранить изменения<span class="kb">Ctrl+Enter</span></button>
              <button class="btn" onClick=${() => { setWork(null); setTried(false); }}>${I('x')} Отменить изменения<span class="kb">Esc</span></button>
` : html`
              ${o.status === 'draft' ? html`
                <button class="btn pri" onClick=${confirmOrder}>${I('check')} Подтвердить и на сборку<span class="kb">Ctrl+Enter</span></button>
                <button class="btn" onClick=${leave}>${I('save')} Записать черновик</button>
                <button class="btn danger" onClick=${() => status('cancelled', 'Заказ отменён')}>${I('ban')} Отменить заказ</button>
                <button class="btn danger" onClick=${async () => { if (await UI.confirm('Удалить черновик заказа?', { ok: 'Удалить', danger: true })) { E.deleteDraft(E.ref(o)); UI.go('orders'); } }}>${I('trash')} Удалить черновик</button>
` : null}
              ${active ? html`
                <button class="btn pri" onClick=${toSale}>${I('shopping-cart')} ${sale && sale.status === 'draft' ? `Открыть продажу ${sale.no}` : 'Оформить продажу'}</button>
                <button class="btn" onClick=${() => printSheet(o)}>${I('printer')} Лист сборки<span class="kb">Ctrl+P</span></button>
                ${o.status === 'assembling' ? html`<button class="btn" onClick=${() => status('assembled', 'Заказ отмечен как собранный')}>Отметить «Собран»</button>` : html`<button class="btn" onClick=${() => status('assembling', 'Заказ возвращён на сборку')}>Вернуть на сборку</button>`}
                <button class="btn" onClick=${startEdit}>${I('edit')} Изменить заказ</button>
                <button class="btn" onClick=${() => status('draft', 'Заказ возвращён в черновик, резерв освобождён')}>Вернуть в черновик</button>
                <button class="btn danger" onClick=${async () => { if (await UI.confirm(`Отменить заказ ${o.no}? Резерв будет освобождён.`, { ok: 'Отменить заказ', danger: true })) status('cancelled', 'Заказ отменён, резерв освобождён'); }}>Отменить заказ</button>` : null}
              ${o.status === 'done' && sale ? html`<div class="note ok">Выполнен: продажа <a onClick=${() => UI.go('sale', { id: sale.id })}>${sale.no}</a> проведена, резерв использован.</div><button class="btn" onClick=${() => printSheet(o)}>Лист сборки</button>` : null}
              ${o.status === 'cancelled' ? html`<div class="note err">Заказ отменён, резерв освобождён.</div>` : null}
              <button class="btn" onClick=${() => { const n = E.copyDoc(E.ref(o)); UI.go('order', { id: n.id }); }}>${I('copy')} Скопировать в новый заказ</button>`}
          </div>
        </div>
      </div>`;
  }
  function DocDiscount({ doc, errs, onChange = upd }) {
    return html`<div class="kv"><span>Скидка на документ</span><span style="display:flex;gap:3px;width:150px">
      <${UI.Num} cls="in num" value=${E.calcLines(doc).docDisc} onChange=${(v) => { doc.dType = 'сум'; doc.dVal = v; onChange(); }} bad=${UI.hasErr(errs, 'docDisc')} />
      <span>сом</span></span></div><${UI.FieldErr} errs=${errs} field="docDisc" />`;
  }
  // строки рабочей копии действующего заказа
  function WorkLines({ work, setWork, errs, shortages, o }) {
    const calc = E.calcLines(work);
    const set = (i, k, v) => { work.lines[i][k] = v; setWork({ ...work }); };
    const lastIdx = {}; work.lines.forEach((l, i) => (lastIdx[l.pid] = i));
    return html`<div class="grid-wrap" style="flex:1"><table class="grid">
      <thead><tr><th>№</th><th>Товар</th><th>Ед.</th><th class="r">Доступно (с учётом резерва заказа)</th><th class="r" style="width:95px">Количество</th><th class="r">Цена</th><th class="r" style="width:120px">Скидка</th><th class="r">Сумма</th><th></th></tr></thead>
      <tbody>${work.lines.map((l, i) => { const p = E.product(l.pid); const sh = shortages[l.pid] && lastIdx[l.pid] === i ? shortages[l.pid] : null; return html`
        <tr key=${i} class=${sh ? 'bad' : ''}><td class="num muted">${i + 1}</td><td>${E.productLabel(p)}</td><td>${p.unit}</td><td class="num">${U.qty(E.available(l.pid, o.id))}</td>
          <td class="ed"><${UI.Num} data-g="ow" data-r=${i} data-c="qty" onKeyDown=${UI.gridKey} value=${l.qty} onChange=${(v) => set(i, 'qty', v)} bad=${!!sh} /></td>
          <td class="num">${U.money(l.price)}</td>
          <td class="ed"><div class="disc-ed"><${UI.Num} value=${calc.lines[i].lineDisc} onChange=${(v) => { l.dType = 'сум'; set(i, 'dVal', v); }} /><span>сом</span></div></td>
          <td class="num b">${U.money(calc.lines[i].amount)}</td><td><button class="xbtn" onClick=${() => { work.lines.splice(i, 1); setWork({ ...work }); }}>×</button></td></tr>
        ${sh ? html`<tr class="errrow"><td colspan="9">Увеличение невозможно: ${E.shortageText(sh)}</td></tr>` : null}`; })}</tbody></table></div>`;
  }
  const printSheet = (o) => UI.printDoc(o, 'order', 'worker');
})();
