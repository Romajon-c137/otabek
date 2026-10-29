/* Каркас приложения: выбор режима (Администрирование / Касса), меню, маршрутизация. */
(function () {
  const { html, render, useState, useEffect } = window.htmPreact;
  const I = (n, s) => html`<${UI.Icon} name=${n} size=${s} />`;
  const MENU = [
    { s: 'products', t: 'Товары', i: 'package' },
    { s: 'sales', t: 'Продажи', i: 'shopping-cart', also: ['sale', 'ret'] },
    { s: 'orders', t: 'Заказы', i: 'clipboard-list', also: ['order'] },
    { s: 'receipts', t: 'Поступления', i: 'package-plus', also: ['receipt'] },
    { s: 'cps', t: 'Контрагенты и долги', i: 'users', also: ['cp'] },
    { s: 'reports', t: 'Отчёты', i: 'bar-chart' },
    { s: 'import', t: 'Импорт начальных данных', i: 'upload' },
  ];

  /* Перерисовка при изменении данных и при переходе между экранами; подписка снимается вместе с компонентом. */
  function useRefresh() {
    const [, force] = useState(0);
    useEffect(() => {
      const f = () => force((x) => x + 1);
      E.listeners.push(f); UI.R.listeners.push(f);
      return () => {
        E.listeners = E.listeners.filter((x) => x !== f);
        UI.R.listeners = UI.R.listeners.filter((x) => x !== f);
      };
    }, []);
  }
  // Горячие клавиши области; снимаются при уходе из неё
  function useKeys(onKey) {
    useEffect(() => {
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, []);
  }

  function ModeSelect({ onSelect }) {
    return html`
      <div class="mode-select">
        <div class="mode-brand">ХозУчёт</div>
        <div class="mode-sub">Выберите режим работы</div>
        <div class="mode-cards">
          <button class="mode-card" onClick=${() => onSelect('admin')}>
            ${I('settings', 40)}
            <span class="mode-card-title">Администрирование</span>
            <span class="mode-card-desc">Товары, поступления, контрагенты, отчёты, импорт — просмотр и редактирование</span>
          </button>
          <button class="mode-card" onClick=${() => onSelect('kassa')}>
            ${I('shopping-cart', 40)}
            <span class="mode-card-title">Касса</span>
            <span class="mode-card-desc">Продажа, приход, заказы, долги людей — просто и быстро</span>
          </button>
        </div>
      </div>`;
  }

  // В рабочем режиме администрирование пока ограничено теми разделами, что уже работают с сервером
  const menuItems = () => (window.Server && Server.on ? MENU.filter((m) => ['products', 'cps'].includes(m.s)) : MENU).map((m, i) => ({ ...m, k: String(i + 1) }));

  function AdminApp() {
    useRefresh();
    UI.area = 'admin';
    useKeys((e) => {
      if (e.key === 'F1') { e.preventDefault(); UI.modal({ title: 'Горячие клавиши', body: () => html`<${UI.HotkeysTable} />` }); return; }
      if (e.altKey && /^[1-7]$/.test(e.key) && menuItems()[+e.key - 1]) { e.preventDefault(); UI.go(menuItems()[+e.key - 1].s); return; }
      UI.handleKey(e);
    });
    const cur = UI.R.cur;
    const Screen = window.Screens[cur.s] || (window.Server && Server.on ? window.Screens.products : window.Screens.home);
    const go = (s) => { UI.menuOpen = false; UI.go(s); };
    const closeMenu = () => { UI.menuOpen = false; UI.refresh(); };
    return html`
      <div class="shell">
        ${UI.menuOpen ? html`<div class="side-overlay" onClick=${closeMenu}></div>` : null}
        <nav class=${`side ${UI.menuOpen ? 'open' : ''}`}>
          <div class="brand">ХозУчёт<small>администрирование</small></div>
          <ul class="menu">
            ${menuItems().map((m) => html`<li><a class=${cur.s === m.s || (m.also || []).includes(cur.s) ? 'on' : ''} onClick=${() => go(m.s)}>${I(m.i, 18)} ${m.t}<span class="k">Alt+${m.k}</span></a></li>`)}
          </ul>
          <div class="side-foot">Пользователь: ${E.S.user}<br />${window.Server && Server.on ? 'Данные: сервер' : 'Данные: localStorage браузера'}</div>
        </nav>
        <main class="main"><${Screen} key=${cur.s + (cur.id || '')} ...${cur} /></main>
      </div>
      <${UI.ModalHost} />`;
  }

  function KassaApp() {
    useRefresh();
    UI.area = 'kassa';
    useKeys((e) => UI.handleKey(e));
    const cur = UI.R.cur;
    const Screen = (cur.s.startsWith('kassa') && window.Screens[cur.s]) || window.Screens.kassaHome;
    return html`
      <main class="main kassa-main"><${Screen} key=${cur.s + (cur.id || '') + (cur.tab || '')} ...${cur} /></main>
      <${UI.ModalHost} />`;
  }

  /* Рабочий режим: вход на сервер; касса, а для администратора — и администрирование. */
  function ServerApp() {
    const [, force] = useState(0);
    const [area, setArea] = useState('kassa');
    useEffect(() => {
      const f = () => force((x) => x + 1);
      Server.listeners.push(f);
      UI.go('kassaHome');
      return () => { Server.listeners = Server.listeners.filter((x) => x !== f); };
    }, []);
    const switchArea = (a) => { setArea(a); UI.go(a === 'kassa' ? 'kassaHome' : 'products'); };
    if (!Server.on && !(Server.cfg && Server.cfg.token)) return html`<${Server.LoginScreen} /><${UI.ModalHost} />`;
    return html`
      <div class="server-bar">
        <b>ХозУчёт</b><span class="muted">${Server.cfg.username}</span><span class="sp"></span>
        ${Server.isAdmin ? html`<button class="btn sm" onClick=${() => switchArea(area === 'kassa' ? 'admin' : 'kassa')}>${area === 'kassa' ? 'Администрирование' : 'Касса'}</button>` : null}
        <${Server.Badge} />
        <button class="btn sm" onClick=${async () => { if (await UI.confirm('Выйти из программы? Неотправленные действия сохранятся на этом компьютере.', { ok: 'Выйти' })) Server.logout(); }}>Выйти</button>
      </div>
      ${area === 'kassa' ? html`<${KassaApp} />` : html`<${AdminApp} />`}`;
  }

  /* Демо: данные в браузере, выбор режима, сброс. */
  function DemoApp() {
    const [mode, setMode] = useState(() => { try { return localStorage.getItem('hoz_mode') || ''; } catch (e) { return ''; } });
    const remember = (m) => { try { if (m) localStorage.setItem('hoz_mode', m); else localStorage.removeItem('hoz_mode'); } catch (e) { /* нет хранилища */ } };
    const selectMode = (m) => { remember(m); setMode(m); UI.go(m === 'kassa' ? 'kassaHome' : 'products'); };
    const exitMode = () => { remember(''); setMode(''); UI.go('products'); };
    const toggleMenu = () => { UI.menuOpen = !UI.menuOpen; UI.refresh(); };
    return html`
      <div class="demo-bar">
        ${mode === 'admin' ? html`<button class="burger" onClick=${toggleMenu}>${I('menu', 20)}</button>` : null}
        <span class="demo-label">ЛОКАЛЬНЫЙ РЕЖИМ</span>
        <span class="sp"></span>
        ${mode ? html`<button onClick=${exitMode}>Сменить режим</button>` : null}
        <label>Пользователь: <select value=${E.S.user} onChange=${(e) => { E.S.user = e.target.value; E.changed(); UI.toast('Текущий пользователь: ' + e.target.value); }}>
          ${['Продавец 1', 'Продавец 2', 'Администратор'].map((u) => html`<option value=${u} selected=${u === E.S.user}>${u}</option>`)}</select></label>
        <button onClick=${async () => { if (await UI.confirm('Вернуть исходный каталог Отабек? Все локальные продажи и изменения будут удалены.', { ok: 'Сбросить', danger: true })) { E.reset(); UI.go(mode === 'kassa' ? 'kassaHome' : 'products'); UI.toast('Каталог Отабек восстановлен', 'ok'); } }}>Сбросить к каталогу Отабек</button>
      </div>
      ${!mode ? html`<${ModeSelect} onSelect=${selectMode} /><${UI.ModalHost} />` : mode === 'kassa' ? html`<${KassaApp} />` : html`<${AdminApp} />`}`;
  }

  const App = () => (window.Prototype?.requested ? html`<${UI.PrototypeShell}><${KassaApp} /><//>` : Server.available ? html`<${ServerApp} />` : html`<${DemoApp} />`);

  (async () => {
    if (window.Prototype?.requested) { await Prototype.init(); UI.go('kassaHome'); }
    else { await Server.boot(); if (!Server.available) E.load(); }
    render(html`<${App} />`, document.getElementById('app'));
  })();
})();
