/* Общие компоненты интерфейса. */
(function () {
  const { html, useState, useEffect, useLayoutEffect, useRef, useMemo } = window.htmPreact;
  const UI = (window.UI = {});

  /* ---------- иконки (Lucide SVG paths) ---------- */
  const ICONS = {
    'refresh-cw': 'M3 12a9 9 0 0 1 15.36-6.36L21 8|M21 3v5h-5|M21 12a9 9 0 0 1-15.36 6.36L3 16|M8 16H3v5',
    home: 'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    package: 'M16.5 9.4 7.55 4.24M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z|M3.27 6.96 12 12.01l8.73-5.05|M12 22.08V12',
    'shopping-cart': 'M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6|Mcircle cx="9" cy="21" r="1"|Mcircle cx="20" cy="21" r="1"',
    'clipboard-list': 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2|Mrect width="8" height="4" x="8" y="2" rx="1" ry="1"|M12 11h4|M12 16h4|M8 11h.01|M8 16h.01',
    'package-plus': 'M16 16h6|M19 13v6|M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14|M3.29 7 12 12l8.71-5|M12 22V12',
    truck: 'M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2|M15 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 13.52 8H14|Mcircle cx="17" cy="18" r="2"|Mcircle cx="7" cy="18" r="2"',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2|Mcircle cx="9" cy="7" r="4"|M22 21v-2a4 4 0 0 0-3-3.87|M16 3.13a4 4 0 0 1 0 7.75',
    'bar-chart': 'M12 20V10|M18 20V4|M6 20v-4',
    upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M17 8l-5-5-5 5|M12 3v12',
    plus: 'M5 12h14|M12 5v14',
    search: 'Mcircle cx="11" cy="11" r="8"|M21 21l-4.3-4.3',
    save: 'M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z|M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7|M7 3v4a1 1 0 0 0 1 1h7',
    trash: 'M3 6h18|M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6|M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2',
    check: 'M20 6 9 17l-5-5',
    x: 'M18 6 6 18|M6 6l12 12',
    'chevron-left': 'M15 18l-6-6 6-6',
    printer: 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2|M6 9V3h12v6|M6 18h12v4H6z',
    wallet: 'M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V6',
    'file-down': 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z|M14 2v4a2 2 0 0 0 2 2h4|M12 18v-6|M9 15l3 3 3-3',
    edit: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
    'eye': 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0|Mcircle cx="12" cy="12" r="3"',
    copy: 'Mrect width="14" height="14" x="8" y="8" rx="2" ry="2"|M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2',
    'arrow-left': 'M12 19l-7-7 7-7|M19 12H5',
    menu: 'M4 12h16|M4 6h16|M4 18h16',
    'circle-dollar': 'Mcircle cx="12" cy="12" r="10"|M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8|M12 18V6',
    'hand-coins': 'M11 15h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 17|M7 21l1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9|Mcircle cx="16" cy="9" r="2.9"|M12 6V2H8',
    'ban': 'Mcircle cx="12" cy="12" r="10"|M4.9 4.9 19.1 19.1',
    'settings': 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z|Mcircle cx="12" cy="12" r="3"',
  };
  UI.Icon = ({ name, size, cls }) => {
    const d = ICONS[name]; if (!d) return null;
    const s = size || 16;
    const paths = d.split('|').map((p) => {
      if (p.startsWith('Mcircle ')) { const m = p.match(/cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/); return html`<circle cx=${m[1]} cy=${m[2]} r=${m[3]} />`; }
      if (p.startsWith('Mrect ')) { const m = p.match(/width="([^"]+)" height="([^"]+)" x="([^"]+)" y="([^"]+)"( rx="([^"]+)")?( ry="([^"]+)")?/); return html`<rect width=${m[1]} height=${m[2]} x=${m[3]} y=${m[4]} rx=${m[6] || 0} ry=${m[8] || 0} />`; }
      return html`<path d=${p} />`;
    });
    return html`<svg class="icon ${cls || ''}" width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  };
  const I = (name, size) => html`<${UI.Icon} name=${name} size=${size} />`;

  /* ---------- фото-заглушка ---------- */
  UI.productPhoto = (product, size) => {
    const sz = size || 80;
    const src = product && product.photo ? product.photo : 'assets/no_image.png';
    const alt = product && product.photo ? product.name : 'Фото товара отсутствует';
    return html`<img src=${src} alt=${alt} width=${sz} height=${sz} style="object-fit:cover;border-radius:8px;flex-shrink:0" />`;
  };

  /* ---------- навигация ---------- */
  const R = (UI.R = { cur: { s: 'products' }, listeners: [] });
  UI.refresh = () => R.listeners.forEach((f) => f());
  UI.go = (s, p = {}) => { R.cur = { s, ...p }; UI.refresh(); window.scrollTo(0, 0); };
  UI.area = ''; // текущая область: 'kassa' или 'admin' (ставит её каркас)
  UI.menuOpen = false; // боковое меню администрирования на узком экране
  UI.openRef = (ref) => {
    if (!ref) return;
    if (UI.area === 'kassa' && UI.kassaOpenRef) return UI.kassaOpenRef(ref);
    if (['pay', 'off', 'sret', 'imp'].includes(ref.t)) return UI.modal({ title: E.refTitle(ref), size: 'mid', body: () => html`<${UI.DocInfo} r=${ref} />` });
    UI.go(ref.t, { id: ref.id });
  };
  UI.DocLink = ({ r, title }) => (r ? html`<a onClick=${(e) => { e.preventDefault(); UI.openRef(r); }}>${title ? E.refTitle(r) : E.refNo(r)}</a>` : '—');

  /* ---------- модальные окна и уведомления ---------- */
  const M = (UI.M = { stack: [], toasts: [], listeners: [] });
  const mNotify = () => M.listeners.forEach((f) => f());
  let mId = 0;
  UI.modal = (o) => { const m = { id: ++mId, ...o }; M.stack.push(m); mNotify(); return m.id; };
  UI.close = (id) => { M.stack = id ? M.stack.filter((m) => m.id !== id) : M.stack.slice(0, -1); mNotify(); };
  UI.openProductPhoto = (product) => {
    if (!product || !product.photo) return;
    return UI.modal({
      title: product.name || 'Фото товара', size: 'photo-viewer',
      body: () => html`<img class="photo-viewer-image" src=${product.photo} alt=${product.name || 'Фото товара'} />`,
    });
  };
  UI.toast = (text, type = '') => { const t = { id: ++mId, text, type }; M.toasts.push(t); mNotify(); setTimeout(() => { M.toasts = M.toasts.filter((x) => x !== t); mNotify(); }, type === 'err' ? 7000 : 4500); };
  UI.confirm = (text, { ok = 'Да', title = 'Подтверждение', danger } = {}) => new Promise((res) => {
    const id = UI.modal({
      title, onClose: () => res(false),
      body: () => html`<div style="white-space:pre-line">${text}</div>`,
      foot: () => html`<button class="btn ${danger ? 'danger' : 'pri'}" autofocus onClick=${() => { UI.close(id); res(true); }}>${ok}</button><button class="btn" onClick=${() => { UI.close(id); res(false); }}>Отмена</button>`,
    });
  });
  // Выполнение учётной операции с понятным сообщением об ошибке
  UI.run = (fn, okMsg) => {
    try { const r = fn(); if (okMsg) UI.toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 'ok'); return r; }
    catch (e) { if (!(e instanceof E.AccErr)) console.error(e); UI.toast(e.message, 'err'); return undefined; }
  };

  UI.ModalHost = () => {
    const [, f] = useState(0);
    useEffect(() => { const h = () => f((x) => x + 1); M.listeners.push(h); return () => (M.listeners = M.listeners.filter((x) => x !== h)); }, []);
    // фокус в новое окно: [autofocus] или первое поле ввода; при закрытии — туда, где был
    const topId = M.stack.length ? M.stack[M.stack.length - 1].id : 0;
    const prevFocus = useRef([]);
    const lastTop = useRef(0);
    useLayoutEffect(() => {
      if (topId > lastTop.current) {
        prevFocus.current.push(document.activeElement);
        const ms = document.querySelectorAll('.modal');
        const box = ms[ms.length - 1];
        const el = box && (box.querySelector('[autofocus]') || box.querySelector('.modal-b input:not([type=checkbox]):not([disabled]), .modal-b select, .modal-b textarea') || box.querySelector('.modal-f .btn'));
        if (el) { el.focus(); el.select && el.select(); }
      } else if (topId < lastTop.current) {
        const el = prevFocus.current.pop();
        if (el && document.contains(el)) el.focus();
      }
      lastTop.current = topId;
    }, [topId]);
    return html`
      ${M.stack.map((m) => html`
        <div class="overlay ${m.size === 'photo-viewer' ? 'photo-viewer-overlay' : ''}" key=${m.id} onMouseDown=${(e) => { if (e.target === e.currentTarget && !m.sticky) { UI.close(m.id); m.onClose && m.onClose(); } }}>
          <div class="modal ${m.size || ''}" role="dialog">
            <div class="modal-h">${m.title}<button class="x" aria-label="Закрыть" autofocus=${m.size === 'photo-viewer'} title=${m.size === 'photo-viewer' ? undefined : 'Закрыть (Esc)'} onClick=${() => { UI.close(m.id); m.onClose && m.onClose(); }}>×</button></div>
            <div class="modal-b" onMouseDown=${(e) => { if (m.size === 'photo-viewer' && e.target === e.currentTarget) UI.close(m.id); }}>${m.body(m.id)}</div>
            ${m.foot ? html`<div class="modal-f">${m.foot(m.id)}</div>` : null}
          </div>
        </div>`)}
      <div class="toasts">${M.toasts.map((t) => html`<div class="toast ${t.type}" key=${t.id}>${t.text}</div>`)}</div>`;
  };

  /* ---------- горячие клавиши экрана ---------- */
  const HK = [];
  UI.useHotkeys = (fn) => {
    const ref = useRef(fn); ref.current = fn;
    useEffect(() => { const h = (e) => ref.current(e); HK.push(h); return () => HK.splice(HK.indexOf(h), 1); }, []);
  };
  UI.handleKey = (e) => {
    if (M.stack.length) {
      if (e.key === 'Escape') { const m = M.stack[M.stack.length - 1]; UI.close(m.id); m.onClose && m.onClose(); e.preventDefault(); }
      return;
    }
    for (let i = HK.length - 1; i >= 0; i--) if (HK[i](e) === true) { e.preventDefault(); return; }
  };
  UI.isTyping = (e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);

  /* ---------- поля ввода ---------- */
  // Числовое поле: хранит введённый текст, отдаёт число (или NaN, если введено некорректно)
  UI.Num = ({ value, onChange, cls = '', bad, ...rest }) => {
    const [txt, setTxt] = useState(U.editStr(value));
    const focused = useRef(false);
    useEffect(() => { if (!focused.current) setTxt(U.editStr(value)); }, [value]);
    return html`<input class="${cls} ${bad ? 'bad' : ''}" value=${txt} inputmode="decimal" autocomplete="off"
      onFocus=${(e) => { focused.current = true; e.target.select(); }}
      onBlur=${() => { focused.current = false; setTxt(U.editStr(value)); }}
      onInput=${(e) => { const v = e.target.value; setTxt(v); const n = U.num(v); onChange(v.trim() === '' ? 0 : n); }} ...${rest} />`;
  };
  UI.FieldErr = ({ errs, field, line }) => {
    const list = (errs || []).filter((e) => e.field === field && (line === undefined || e.line === line));
    return list.length ? html`<div class="field-err">${list[0].msg}</div>` : null;
  };
  UI.hasErr = (errs, field, line) => (errs || []).some((e) => e.field === field && (line === undefined || e.line === line));
  UI.ErrList = ({ errs }) => (errs && errs.length ? html`<ul class="errlist">${errs.map((e) => html`<li>${e.msg}</li>`)}</ul>` : null);

  // Перемещение по ячейкам-редакторам стрелками вверх/вниз
  UI.gridKey = (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const t = e.target; const g = t.dataset.g, r = +t.dataset.r, c = t.dataset.c;
    if (!g) return;
    const n = document.querySelector(`[data-g="${g}"][data-r="${r + (e.key === 'ArrowDown' ? 1 : -1)}"][data-c="${c}"]`);
    if (n) { e.preventDefault(); n.focus(); }
  };
  UI.focusCell = (g, r, c) => setTimeout(() => { const n = document.querySelector(`[data-g="${g}"][data-r="${r}"][data-c="${c}"]`); if (n) { n.focus(); n.select && n.select(); } }, 0);

  /* ---------- таблица списка ---------- */
  UI.Table = ({ cols, rows, rowKey = (r) => r.id, onOpen, sort: sort0, foot, empty = 'Нет данных', rowCls, autoFocus, maxH, selId, onSel }) => {
    const [sort, setSort] = useState(sort0 || null);
    const [sel, setSel] = useState(null);
    const wrap = useRef();
    const sorted = useMemo(() => {
      if (!sort) return rows;
      const c = cols.find((x) => x.k === sort.k);
      if (!c) return rows;
      const val = c.v || ((r) => r[c.k]);
      return [...rows].sort((a, b) => {
        const x = val(a), y = val(b);
        const d = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'ru', { numeric: true });
        return sort.d * d;
      });
    }, [rows, sort, cols]);
    const keys = sorted.map(rowKey);
    const cur = selId !== undefined && selId !== null && keys.includes(selId) ? selId : keys.includes(sel) ? sel : keys[0];
    const setCur = (k) => { setSel(k); onSel && onSel(k); };
    useLayoutEffect(() => { if (autoFocus && wrap.current) wrap.current.focus({ preventScroll: true }); }, []);
    useEffect(() => {
      const el = wrap.current && wrap.current.querySelector('tr.sel');
      if (el) { const w = wrap.current; const top = el.offsetTop - 24, bot = el.offsetTop + el.offsetHeight + 26; if (top < w.scrollTop) w.scrollTop = top; else if (bot > w.scrollTop + w.clientHeight) w.scrollTop = bot - w.clientHeight; }
    }, [cur]);
    const onKey = (e) => {
      if (UI.isTyping(e)) return;
      const i = keys.indexOf(cur);
      const page = Math.max(1, Math.floor((wrap.current.clientHeight - 30) / 24) - 1);
      const to = { ArrowDown: i + 1, ArrowUp: i - 1, PageDown: i + page, PageUp: i - page, Home: 0, End: keys.length - 1 }[e.key];
      if (to !== undefined) { e.preventDefault(); setCur(keys[Math.max(0, Math.min(keys.length - 1, to))]); }
      else if (e.key === 'Enter' && onOpen && i >= 0) { e.preventDefault(); onOpen(sorted[i]); }
    };
    return html`
      <div class="grid-wrap" tabindex="0" ref=${wrap} onKeyDown=${onKey} style=${maxH ? `max-height:${maxH}` : 'flex:1'}>
        <table class="grid">
          <thead><tr>${cols.map((c) => html`<th class="${c.a === 'r' ? 'r' : ''} ${c.nosort ? '' : 'sortable'}" style=${c.w ? `width:${c.w}` : ''} title=${c.tip || ''}
            onClick=${() => !c.nosort && setSort(sort && sort.k === c.k ? { k: c.k, d: -sort.d } : { k: c.k, d: c.a === 'r' ? -1 : 1 })}>
            ${c.t}${sort && sort.k === c.k ? html`<span class="arr">${sort.d > 0 ? '▲' : '▼'}</span>` : ''}</th>`)}</tr></thead>
          <tbody>${sorted.map((r) => {
            const k = rowKey(r);
            return html`<tr key=${k} class="${k === cur ? 'sel' : ''} ${rowCls ? rowCls(r) : ''}" onMouseDown=${() => setCur(k)} onDblClick=${() => onOpen && onOpen(r)}>
              ${cols.map((c) => html`<td class="${c.a === 'r' ? 'num' : ''} ${c.cls || ''}" title=${c.title ? c.title(r) : ''}>${c.r ? c.r(r) : r[c.k]}</td>`)}</tr>`;
          })}</tbody>
          ${foot ? html`<tfoot><tr>${cols.map((c) => html`<td class="${c.a === 'r' ? 'num' : ''}">${foot[c.k] ?? ''}</td>`)}</tr></tfoot>` : null}
        </table>
        ${!rows.length ? html`<div class="grid-empty">${empty}</div>` : null}
      </div>`;
  };
  UI.m = (x, zeroDim = true) => html`<span class=${x < 0 ? 'neg' : U.eq(x, 0) && zeroDim ? 'zero' : ''}>${U.money(x)}</span>`;
  UI.q = (x) => html`<span class=${U.eq(x, 0) ? 'zero' : x < 0 ? 'neg' : ''}>${U.qty(x)}</span>`;
  UI.Badge = ({ st }) => html`<span class="badge ${st}">${E.STATUS[st]}</span>`;
  UI.Tabs = ({ tabs, cur, onChange }) => html`<div class="tabs">${tabs.map((t) => html`<button class=${t.k === cur ? 'on' : ''} onClick=${() => onChange(t.k)}>${t.t}${t.n != null ? html`<span class="cnt">${t.n}</span>` : ''}</button>`)}</div>`;
  UI.Seg = ({ opts, value, onChange }) => html`<span class="seg">${opts.map((o) => html`<button type="button" class=${o.v === value ? 'on' : ''} onClick=${() => onChange(o.v)}>${o.t}</button>`)}</span>`;
  UI.Assume = ({ children, tip }) => html`<span class="assume" title=${tip || 'Предлагаемое правило ТЗ — требует подтверждения до запуска реального учёта'}>допущение: ${children}</span>`;

  /* ---------- подбор товара ---------- */
  UI.ProductPicker = ({ onPick, purchase, exceptOrderId, inputId = 'picker', autoFocus }) => {
    const [q, setQ] = useState('');
    const [open, setOpen] = useState(false);
    const [sel, setSel] = useState(0);
    const inp = useRef();
    useLayoutEffect(() => { if (autoFocus && inp.current) inp.current.focus(); }, []);
    const res = useMemo(() => {
      if (!open) return [];
      const t = q.trim();
      return E.S.products.filter((p) => p.active && U.match(t, p.name, p.variantName, p.category, p.code)).slice(0, 60);
    }, [q, open, E.S.products.length]);
    const pick = (p) => { if (!p) return; onPick(p); setQ(''); setOpen(false); setSel(0); };
    const card = (p) => p && UI.productCard(p.id);
    const onKey = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); else setSel((s) => Math.min(res.length - 1, s + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
      else if (e.key === 'Enter' && !e.ctrlKey) { if (open && res.length) { e.preventDefault(); e.stopPropagation(); pick(res[Math.min(sel, res.length - 1)]); } }
      else if (e.key === 'F3') { e.preventDefault(); card(res[sel]); }
      else if (e.key === 'Escape' && (open || q)) { e.preventDefault(); e.stopPropagation(); setQ(''); setOpen(false); }
    };
    useEffect(() => {
      const el = document.querySelector('.pick-drop tr.sel');
      if (el) el.scrollIntoView({ block: 'nearest' });
    }, [sel]);
    return html`
      <div class="picker">
        <input id=${inputId} ref=${inp} value=${q} placeholder="Поиск товара: название или категория  (F4)" autocomplete="off"
          onInput=${(e) => { setQ(e.target.value); setOpen(true); setSel(0); }} onKeyDown=${onKey}
          onFocus=${() => q && setOpen(true)} onBlur=${() => setTimeout(() => setOpen(false), 150)} />
        ${open && html`<div class="pick-drop">
          <table class="grid">
            <thead><tr><th>Категория</th><th>Наименование</th><th>Ед.</th><th class="r">${purchase ? 'Закуп. цена' : 'Цена'}</th><th></th></tr></thead>
            <tbody>${res.map((p, i) => {
              return html`<tr key=${p.id} class=${i === sel ? 'sel' : ''} onMouseDown=${(e) => { e.preventDefault(); pick(p); }} onMouseEnter=${() => setSel(i)}>
                <td class="muted">${p.category || ''}</td><td>${E.productLabel(p)}</td><td>${p.unit}</td>
                <td class="num">${U.money(purchase ? p.purchasePrice : p.retailPrice)}</td>
                <td><button class="ibtn" title="Открыть карточку (F3), продажа не закрывается" onMouseDown=${(e) => { e.preventDefault(); e.stopPropagation(); card(p); }}>карточка</button></td></tr>`;
            })}</tbody>
          </table>
          ${!res.length ? html`<div class="grid-empty">Ничего не найдено${q ? html` — <a href="https://otabek.glasscenter.kg/add" target="_blank" rel="noopener">создать товар в Otabek</a>` : ''}</div>` : null}
          <div class="hint">↑↓ — выбор · Enter — добавить в документ · F3 — карточка товара (документ остаётся открытым) · Esc — очистить</div>
        </div>`}
      </div>`;
  };

  /* ---------- выбор контрагента ---------- */
  UI.CpSelect = ({ value, onChange, bad, disabled, placeholder = 'Выберите контрагента…', id }) => {
    const [q, setQ] = useState(null);
    const [sel, setSel] = useState(0);
    const cur = value ? E.cp(value) : null;
    const editing = q !== null;
    const res = editing ? E.S.cps.filter((c) => U.match(q, c.name, c.phone, c.code)).slice(0, 30) : [];
    const pick = (c) => { onChange(c ? c.id : null); setQ(null); };
    const create = () => UI.cpQuick(q || '', (c) => pick(c));
    const onKey = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (!editing) setQ(''); else setSel((s) => Math.min(res.length, s + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
      else if (e.key === 'Enter' && editing) { e.preventDefault(); e.stopPropagation(); if (sel < res.length) pick(res[sel]); else create(); }
      else if (e.key === 'Escape' && editing) { e.preventDefault(); e.stopPropagation(); setQ(null); }
    };
    return html`
      <div class="picker" style="max-width:420px">
        <div style="display:flex;gap:4px">
          <input id=${id} class="in ${bad ? 'bad' : ''}" style="padding-left:6px;font-size:13px;border-width:1px" disabled=${disabled} value=${editing ? q : cur ? cur.name : ''} placeholder=${placeholder} autocomplete="off"
            onInput=${(e) => { setQ(e.target.value); setSel(0); }} onFocus=${(e) => e.target.select()} onKeyDown=${onKey} onBlur=${() => setTimeout(() => setQ(null), 180)} />
          ${!disabled && value ? html`<button class="btn sm" title="Очистить" onClick=${() => onChange(null)}>×</button>` : null}
          ${!disabled ? html`<button class="btn sm" title="Создать контрагента, не покидая документ" onClick=${() => UI.cpQuick('', (c) => pick(c))}>+ Новый</button>` : null}
          ${value ? html`<button class="btn sm" title="Открыть карточку контрагента" onClick=${() => UI.cpCardModal(value)}>…</button>` : null}
        </div>
        ${editing && html`<div class="pick-drop" style="width:520px">
          <table class="grid"><tbody>
            ${res.map((c, i) => { const b = E.balance(c.id); return html`<tr key=${c.id} class=${i === sel ? 'sel' : ''} onMouseDown=${(e) => { e.preventDefault(); pick(c); }}>
              <td>${c.name}</td><td class="muted">${c.phone}</td><td class="num">${b.recv ? html`<span class="ok-t">нам ${U.money(b.recv)}</span>` : ''} ${b.pay ? html`<span class="err-t">мы ${U.money(b.pay)}</span>` : ''}</td></tr>`; })}
            <tr class=${sel === res.length ? 'sel' : ''} onMouseDown=${(e) => { e.preventDefault(); create(); }}><td colspan="3"><a>+ Создать нового контрагента${q ? ` «${q}»` : ''}</a></td></tr>
          </tbody></table></div>`}
      </div>`;
  };

  UI.cpQuick = (name, onDone) => {
    const st = { name, phone: '', errs: [] };
    const Body = () => {
      const [, f] = useState(0); const upd = () => f((x) => x + 1);
      const save = () => { try { const c = E.saveCp(st); UI.close(id); UI.toast(`Контрагент «${c.name}» создан`, 'ok'); onDone && onDone(c); } catch (e) { st.errs = e.details; upd(); } };
      return html`<div class="form one" onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}>
        <label class="l">Имя или название *</label><div class="fw"><input class="in ${UI.hasErr(st.errs, 'name') ? 'bad' : ''}" autofocus value=${st.name} onInput=${(e) => { st.name = e.target.value; }} /><${UI.FieldErr} errs=${st.errs} field="name" /></div>
        <label class="l">Телефон</label><input class="in" value=${st.phone} placeholder="необязательно" onInput=${(e) => { st.phone = e.target.value; }} />
      </div>
      <div class="modal-f" style="padding:10px 0 0;border:none"><button class="btn pri" onClick=${save}>Создать (Enter)</button><button class="btn" onClick=${() => UI.close(id)}>Отмена</button></div>`;
    };
    const id = UI.modal({ title: 'Новый контрагент', body: () => html`<${Body} />` });
  };

  /* ---------- вывод деталей документов (оплата, зачёт, возврат поставщику, импорт) ---------- */
  UI.DocInfo = ({ r }) => {
    const d = E.doc(r);
    if (!d) return 'Документ не найден';
    const allocs = E.S.allocs.filter((a) => a.ref.t === r.t && a.ref.id === r.id);
    const alTable = allocs.length ? html`<h2 class="sec">Распределение по строкам долга</h2>
      <${UI.Table} maxH="300px" rowKey=${(a) => a.id} rows=${allocs} cols=${[
        { k: 'dir', t: 'Сторона', r: (a) => { const x = E.debt(a.debtId); return html`<span class="pill ${x.dir}">${x.dir === 'recv' ? 'нам должны' : 'мы должны'}</span>`; } },
        { k: 'src', t: 'Исходный документ', r: (a) => html`<${UI.DocLink} r=${E.debt(a.debtId).ref} title />` },
        { k: 'p', t: 'Товар', r: (a) => { const x = E.debt(a.debtId); return x.pid ? E.pName(x.pid) : html`<i class="muted">денежный долг</i>`; } },
        { k: 'amount', t: 'Сумма', a: 'r', r: (a) => U.money(a.amount) },
        { k: 'st', t: '', r: (a) => (a.cancelled ? html`<span class="badge cancelled">сторно</span>` : '') },
      ]} />` : null;
    if (r.t === 'pay') return html`<div class="form one">
        <label class="l">Контрагент</label><div>${E.cpName(d.cp)}</div>
        <label class="l">Направление</label><div>${d.dir === 'in' ? 'Получено от контрагента' : 'Выдано контрагенту'}</div>
        <label class="l">Сумма</label><div class="b">${U.som(d.amount)}</div>
        <label class="l">Основание</label><div>${d.src ? html`<${UI.DocLink} r=${d.src} title />` : d.comment}</div>
        <label class="l">Дата, пользователь</label><div>${U.fmtDT(d.at)} · ${d.author}</div>
        <label class="l">Статус</label><div><${UI.Badge} st=${d.status} /></div></div>
${alTable}`;
    if (r.t === 'off') return html`<div class="form one">
        <label class="l">Контрагент</label><div>${E.cpName(d.cp)}</div>
        <label class="l">Сумма зачёта</label><div class="b">${U.som(d.amount)}</div>
        <label class="l">Причина</label><div>Автоматически после ${d.trigger ? html`<${UI.DocLink} r=${d.trigger} title />` : '—'}</div>
        <label class="l">Дата</label><div>${U.fmtDT(d.at)} · ${d.author}</div></div>
${alTable}`;
    if (r.t === 'sret') return html`<div class="form one">
        <label class="l">Контрагент</label><div>${E.cpName(d.cp)}</div>
        <label class="l">Сумма</label><div class="b">${U.som(d.amount)}</div>
        <label class="l">Дата</label><div>${U.fmtDT(d.at)} · ${d.author}</div></div>
      <h2 class="sec">Возвращённый товар</h2>
      <${UI.Table} maxH="200px" rowKey=${(l) => l.debtId} rows=${d.lines} cols=${[
        { k: 'p', t: 'Товар', r: (l) => E.pName(l.pid) }, { k: 'qty', t: 'Кол-во', a: 'r', r: (l) => U.qtyU(l.qty, E.product(l.pid).unit) },
        { k: 'price', t: 'Цена расчёта', a: 'r', r: (l) => U.money(l.price) }, { k: 'amount', t: 'Сумма', a: 'r', r: (l) => U.money(l.amount) },
        { k: 'cost', t: 'Себестоимость списания', a: 'r', r: (l) => U.money(l.cost) },
        { k: 'lots', t: 'Партии', r: (l) => l.wo.map((w) => `${E.refNo(E.lot(w.lotId).ref)}: ${U.qty(w.qty)}`).join('; ') },
      ]} />
${alTable}`;
    if (r.t === 'imp') return html`<div class="form one">
        <label class="l">Файл</label><div>${d.fileName}</div>
        <label class="l">Загружено</label><div>товаров ${d.counts.products}, контрагентов ${d.counts.cps}, партий ${d.counts.lots}, долгов ${d.counts.debts}</div>
        <label class="l">Дата</label><div>${U.fmtDT(d.at)} · ${d.author}</div>
        <label class="l">Контроль повтора</label><div class="mono">${d.hash}</div></div>`;
    return null;
  };

  /* ---------- печать ---------- */
  UI.print = (vnode) => {
    const root = document.getElementById('print-root');
    window.htmPreact.render(vnode, root);
    setTimeout(() => window.print(), 50);
  };
})();
