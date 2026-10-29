/* Отчёты, импорт начальных данных, стартовая страница со сценариями. */
(function () {
  const { html, useState } = window.htmPreact;
  const S = (window.Screens = window.Screens || {});
  const I = (n, s) => html`<${UI.Icon} name=${n} size=${s} />`;

  /* ================= Отчёты ================= */
  S.reports = ({ tab: tab0 }) => {
    const [tab, setTab] = useState(tab0 || 'stock');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [pid, setPid] = useState('');
    const [transfers, setTransfers] = useState(true);
    const [zeros, setZeros] = useState(false);
    const productSelect = html`<label>Товар</label><select class="in" style="width:240px" value=${pid} onChange=${(e) => setPid(e.target.value)}>
      <option value="">Все товары</option>${[...E.S.products].sort((a, b) => E.productLabel(a).localeCompare(E.productLabel(b), 'ru')).map((p) => html`<option value=${p.id} selected=${p.id === pid}>${E.productLabel(p)}</option>`)}</select>`;
    const period = html`
      <label>Период с</label><input type="date" class="in" style="width:140px" value=${from} onInput=${(e) => setFrom(e.target.value)} />
      <label>по</label><input type="date" class="in" style="width:140px" value=${to} onInput=${(e) => setTo(e.target.value)} />
      <button class="btn sm" onClick=${() => { const d = U.isoDay(new Date().toISOString()); setFrom(d); setTo(d); }}>Сегодня</button>
      <button class="btn sm" onClick=${() => { setFrom(''); setTo(''); }}>Весь период</button>
      ${productSelect}
      <label class="chk" title="Передача соседу оформляется как продажа в долг"><input type="checkbox" checked=${transfers} onChange=${(e) => setTransfers(e.target.checked)} />Включать передачи в долг</label>`;
    let body;
    if (tab === 'stock') {
      const rows = E.S.products.filter((p) => !pid || p.id === pid).map((p) => ({ ...p, stock: E.stock(p.id), res: E.reserved(p.id), avail: E.available(p.id), cost: E.stockCost(p.id) })).filter((r) => zeros || r.stock > 0 || r.res > 0);
      body = html`
        <div class="bar">${productSelect}
          <label class="chk"><input type="checkbox" checked=${zeros} onChange=${(e) => setZeros(e.target.checked)} />Показывать нулевые</label>
          <span class="muted">Текущее состояние. <${UI.Assume}>остатки на произвольную дату — отдельно<//></span></div>
        <${UI.Table} rows=${rows} onOpen=${(r) => UI.productCard(r.id)} sort=${{ k: 'name', d: 1 }} cols=${[
          { k: 'category', t: 'Категория', w: '130px' }, { k: 'name', t: 'Товар' }, { k: 'unit', t: 'Ед.', w: '36px' },
          { k: 'stock', t: 'Фактический остаток', a: 'r', r: (r) => U.qty(r.stock) },
          { k: 'res', t: 'Резерв', a: 'r', r: (r) => UI.q(r.res) },
          { k: 'avail', t: 'Доступно', a: 'r', r: (r) => html`<b>${U.qty(r.avail)}</b>` },
          { k: 'cost', t: 'Стоимость остатка (FIFO)', a: 'r', r: (r) => U.money(r.cost) },
          { k: 'avg', t: 'Ср. себест. ед.', a: 'r', v: (r) => (r.stock ? r.cost / r.stock : 0), r: (r) => (r.stock ? U.money(r.cost / r.stock) : '') },
        ]} foot=${{ name: `Итого позиций: ${rows.length}`, cost: U.money(U.sum(rows, (r) => r.cost)) }} />`;
    } else if (tab === 'sales' || tab === 'profit') {
      const rows = E.salesReport({ from, to, pid, transfers }).map((r) => ({ ...r, id: r.pid, name: E.pName(r.pid), unit: E.product(r.pid).unit }));
      const T = (k) => U.money(U.sum(rows, (r) => r[k]));
      body = tab === 'sales' ? html`
        <div class="bar">${period}</div>
        <${UI.Table} rows=${rows} sort=${{ k: 'revenue', d: -1 }} cols=${[
          { k: 'name', t: 'Товар' }, { k: 'unit', t: 'Ед.', w: '36px' },
          { k: 'qty', t: 'Продано', a: 'r', r: (r) => U.qty(r.qty) },
          { k: 'gross', t: 'Сумма без скидок', a: 'r', r: (r) => U.money(r.gross) },
          { k: 'disc', t: 'Скидки', a: 'r', r: (r) => UI.m(r.disc) },
          { k: 'net', t: 'Сумма продаж', a: 'r', r: (r) => U.money(r.net) },
          { k: 'retQty', t: 'Возвращено', a: 'r', r: (r) => UI.q(r.retQty) },
          { k: 'retAmount', t: 'Сумма возвратов', a: 'r', r: (r) => UI.m(r.retAmount) },
          { k: 'revenue', t: 'Итоговая выручка', a: 'r', r: (r) => html`<b>${U.money(r.revenue)}</b>` },
        ]} foot=${{ name: 'Итого', gross: T('gross'), disc: T('disc'), net: T('net'), retAmount: T('retAmount'), revenue: T('revenue') }} empty="Нет продаж за период" />
` : html`
        <div class="bar">${period}</div>
        <${UI.Table} rows=${rows} sort=${{ k: 'profit', d: -1 }} cols=${[
          { k: 'name', t: 'Товар' }, { k: 'unit', t: 'Ед.', w: '36px' },
          { k: 'qty', t: 'Продано (нетто)', a: 'r', v: (r) => r.qty - r.retQty, r: (r) => U.qty(r.qty - r.retQty) },
          { k: 'revenue', t: 'Выручка после скидок и возвратов', a: 'r', r: (r) => U.money(r.revenue) },
          { k: 'cogsNet', t: 'Себестоимость по FIFO', a: 'r', r: (r) => U.money(r.cogsNet) },
          { k: 'profit', t: 'Валовая прибыль', a: 'r', r: (r) => html`<b class=${r.profit < 0 ? 'neg' : ''}>${U.money(r.profit)}</b>` },
          { k: 'margin', t: 'Наценка на себест., %', a: 'r', v: (r) => (r.cogsNet ? r.profit / r.cogsNet : 0), r: (r) => (U.gt0(r.cogsNet) ? (100 * r.profit / r.cogsNet).toFixed(1) : '') },
        ]} foot=${{ name: 'Итого', revenue: T('revenue'), cogsNet: T('cogsNet'), profit: T('profit') }} empty="Нет продаж за период" />
`;
    } else {
      const rows = [...E.S.log].reverse();
      body = html`<${UI.Table} rows=${rows} cols=${[
        { k: 'at', t: 'Дата и время', w: '130px', r: (l) => U.fmtDT(l.at), v: (l) => l.at + String(l.id).padStart(6, '0') },
        { k: 'user', t: 'Пользователь', w: '110px' }, { k: 'action', t: 'Действие', w: '150px' },
        { k: 'ref', t: 'Документ', w: '190px', r: (l) => (l.ref ? html`<${UI.DocLink} r=${l.ref} title />` : '') },
        { k: 'text', t: 'Описание', cls: 'wrap' },
      ]} />
`;
    }
    return html`
      <div class="head"><h1>Отчёты</h1></div>
      <div class="body" style="display:flex;flex-direction:column">
        <${UI.Tabs} cur=${tab} onChange=${setTab} tabs=${[{ k: 'stock', t: 'Остатки' }, { k: 'sales', t: 'Продажи за период' }, { k: 'profit', t: 'Валовая прибыль по товарам' }, { k: 'log', t: 'Журнал операций' }]} />
        ${body}
      </div>`;
  };

  /* ================= Импорт ================= */
  const DEMO_BAD = {
    'Товары': [
      { _row: 2, 'Код для импорта': 'N01', 'Наименование': 'Кашпо пластиковое 2 л', 'Категория': '', 'Единица': 'шт', 'Закупочная цена': 60, 'Розничная цена': 110 },
      { _row: 3, 'Код для импорта': 'N02', 'Наименование': '', 'Категория': '', 'Единица': 'шт', 'Закупочная цена': 40, 'Розничная цена': 70 },
      { _row: 4, 'Код для импорта': 'N03', 'Наименование': 'Лейка садовая 5 л', 'Категория': '', 'Единица': 'уп', 'Закупочная цена': 180, 'Розничная цена': 290 },
      { _row: 5, 'Код для импорта': 'N04', 'Наименование': 'Шпагат джутовый', 'Категория': '', 'Единица': 'м', 'Закупочная цена': 3.5, 'Розничная цена': 'семь' },
      { _row: 6, 'Код для импорта': 'N01', 'Наименование': 'Кашпо (дубль)', 'Категория': '', 'Единица': 'шт', 'Закупочная цена': 60, 'Розничная цена': 110 },
    ],
    'Контрагенты': [
      { _row: 2, 'Код для импорта': 'D01', 'Имя или название': 'Садовод Эрмек', 'Телефон': '+996 700 55 44 33' },
      { _row: 3, 'Код для импорта': 'D02', 'Имя или название': '', 'Телефон': '' },
    ],
    'Остатки': [
      { _row: 2, 'Код товара': 'N01', 'Количество': 10, 'Себестоимость единицы': 60, 'Порядок партии': 1 },
      { _row: 3, 'Код товара': 'N01', 'Количество': 2.5, 'Себестоимость единицы': 65, 'Порядок партии': 2 },
      { _row: 4, 'Код товара': 'N99', 'Количество': 5, 'Себестоимость единицы': 20, 'Порядок партии': 1 },
      { _row: 5, 'Код товара': 'N04', 'Количество': 120.5, 'Себестоимость единицы': 3.5, 'Порядок партии': 1 },
    ],
    'Долги': [
      { _row: 2, 'Код контрагента': 'D01', 'Направление': 'Нам должны', 'Код товара': 'N01', 'Количество': 3, 'Цена': 100, 'Непогашенная сумма': 400, 'Комментарий': '' },
      { _row: 3, 'Код контрагента': 'D77', 'Направление': 'Мы должны', 'Код товара': '', 'Количество': '', 'Цена': '', 'Непогашенная сумма': 500, 'Комментарий': '' },
      { _row: 4, 'Код контрагента': 'D01', 'Направление': 'Мы должны', 'Код товара': '', 'Количество': 2, 'Цена': '', 'Непогашенная сумма': 200, 'Комментарий': '' },
    ],
  };
  const DEMO_GOOD = {
    'Товары': [
      { _row: 2, 'Код для импорта': 'N01', 'Наименование': 'Кашпо пластиковое 2 л', 'Категория': '', 'Единица': 'шт', 'Закупочная цена': 60, 'Розничная цена': 110 },
      { _row: 3, 'Код для импорта': 'N03', 'Наименование': 'Лейка садовая 5 л', 'Категория': '', 'Единица': 'шт', 'Закупочная цена': 180, 'Розничная цена': 290 },
      { _row: 4, 'Код для импорта': 'N04', 'Наименование': 'Шпагат джутовый', 'Категория': '', 'Единица': 'м', 'Закупочная цена': 3.5, 'Розничная цена': 7 },
    ],
    'Контрагенты': [
      { _row: 2, 'Код для импорта': 'D01', 'Имя или название': 'Садовод Эрмек', 'Телефон': '+996 700 55 44 33' },
      { _row: 3, 'Код для импорта': 'D02', 'Имя или название': 'Тимур (сосед, павильон 3)', 'Телефон': '' },
    ],
    'Остатки': [
      { _row: 2, 'Код товара': 'N01', 'Количество': 10, 'Себестоимость единицы': 60, 'Порядок партии': 1 },
      { _row: 3, 'Код товара': 'N01', 'Количество': 5, 'Себестоимость единицы': 65, 'Порядок партии': 2 },
      { _row: 4, 'Код товара': 'N03', 'Количество': 6, 'Себестоимость единицы': 180, 'Порядок партии': 1 },
      { _row: 5, 'Код товара': 'N04', 'Количество': 120.5, 'Себестоимость единицы': 3.5, 'Порядок партии': 1 },
    ],
    'Долги': [
      { _row: 2, 'Код контрагента': 'D01', 'Направление': 'Нам должны', 'Код товара': 'N01', 'Количество': 3, 'Цена': 100, 'Непогашенная сумма': 300, 'Комментарий': 'Взял кашпо под реализацию' },
      { _row: 3, 'Код контрагента': 'D02', 'Направление': 'Мы должны', 'Код товара': '', 'Количество': '', 'Цена': '', 'Непогашенная сумма': 800, 'Комментарий': 'Занимали деньги' },
      { _row: 4, 'Код контрагента': 'D02', 'Направление': 'Нам должны', 'Код товара': 'N03', 'Количество': 1, 'Цена': 250, 'Непогашенная сумма': 250, 'Комментарий': 'Взял лейку' },
    ],
  };

  function downloadTemplate() {
    if (!window.XLSX) { UI.toast('Библиотека Excel не загрузилась. Перезапустите программу или используйте демонстрационные файлы ниже.', 'err'); return; }
    const wb = XLSX.utils.book_new();
    const instr = [
      ['Шаблон начальной загрузки данных — ХозУчёт'], [''],
      ['Порядок: заполните листы, сохраните файл и загрузите его на экране «Импорт начальных данных».'],
      ['Первая строка каждого листа — заголовки, их менять нельзя. Данные начинаются со второй строки.'], [''],
      ['Лист «Товары»', 'Код для импорта — любой уникальный код (на него ссылаются листы «Остатки» и «Долги»). Категория — по желанию. Единица: шт, кг или м. Цены — числа (закупочная и оптовая — по желанию).'],
      ['Лист «Контрагенты»', 'Код для импорта — уникальный. Имя обязательно, телефон — по желанию.'],
      ['Лист «Остатки»', 'Код товара, количество, себестоимость единицы. Несколько известных партий — отдельными строками с порядком 1, 2, 3… Если история неизвестна — одна строка.'],
      ['Лист «Долги»', 'Направление: «Нам должны» или «Мы должны». Для товарного долга укажите товар, количество и цену. Денежный долг — без товара и количества.'],
      ['', 'Непогашенная сумма может быть меньше стоимости товара — разница считается погашенной до начала учёта.'],
      ['', 'Долги не двигают склад: остатки загружаются только с листа «Остатки».'], [''],
      ['Примеры', 'Товары: T01 | Вилка столовая | Столовые приборы | шт | 50 | 65 | 80'],
      ['', 'Остатки: T01 | 10 | 45 | 1'],
      ['', 'Долги: K02 | Мы должны | T01 | 10 | 50 | 500'],
      ['', 'Долги (денежный): K06 | Нам должны |  |  |  | 1500'],
      [''], ['При ошибках программа покажет лист, строку и поле; данные не будут загружены частично. Повторная загрузка того же файла блокируется.'],
    ];
    const wsI = XLSX.utils.aoa_to_sheet(instr); wsI['!cols'] = [{ wch: 22 }, { wch: 120 }];
    XLSX.utils.book_append_sheet(wb, wsI, 'Инструкция');
    Object.entries(E.IMPORT_SHEETS).forEach(([name, cols]) => {
      const ws = XLSX.utils.aoa_to_sheet([cols]); ws['!cols'] = cols.map((c) => ({ wch: Math.max(14, c.length + 4) }));
      XLSX.utils.book_append_sheet(wb, ws, name);
    });
    XLSX.writeFile(wb, 'Шаблон начальных данных.xlsx');
  }
  function readFile(file, done) {
    if (!window.XLSX) { UI.toast('Библиотека Excel не загрузилась. Перезапустите программу.', 'err'); return; }
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const wb = XLSX.read(fr.result, { type: 'array' });
        const data = {}; const missing = [];
        Object.keys(E.IMPORT_SHEETS).forEach((name) => {
          const ws = wb.Sheets[name];
          if (!ws) { missing.push(name); data[name] = []; return; }
          const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
          data[name] = rows.map((r, i) => ({ ...r, _row: i + 2 })).filter((r) => Object.keys(r).some((k) => k !== '_row' && String(r[k]).trim() !== ''));
        });
        done(data, missing);
      } catch (e) { UI.toast('Не удалось прочитать файл: ' + e.message, 'err'); }
    };
    fr.readAsArrayBuffer(file);
  }

  S.import = () => {
    const [st, setSt] = useState({ step: 1, data: null, name: '', missing: [], result: null, err: null });
    const [sheet, setSheet] = useState('Товары');
    const load = (data, name, missing = []) => { setSt({ step: 3, data, name, missing, result: null, err: null }); setSheet('Товары'); };
    const v = st.data ? E.validateImport(st.data) : null;
    const errs = v ? [...st.missing.map((m) => ({ sheet: m, row: '—', field: '—', msg: 'Лист не найден в файле' })), ...v.errs] : [];
    const dup = st.data ? E.S.imports.find((i) => i.hash === E.importHash(st.data)) : null;
    const apply = () => {
      try { const res = E.applyImport(st.data, st.name); setSt({ ...st, step: 4, result: res }); UI.toast('Импорт выполнен', 'ok'); }
      catch (e) { setSt({ ...st, err: e.message }); UI.toast(e.message, 'err'); }
    };
    const rowErr = (sh, row) => errs.filter((e) => e.sheet === sh && e.row === row);
    const steps = ['Шаблон', 'Выбор файла', 'Предварительная проверка', 'Итог'];
    return html`
      <div class="head"><h1>Импорт начальных данных</h1></div>
      <div class="body">
        <div class="steps">${steps.map((s, i) => html`<div class=${st.step === i + 1 || (st.step === 1 && i === 1) ? 'on' : st.step > i + 1 ? 'done' : ''}>${i + 1}. ${s}</div>`)}</div>
        ${st.step !== 4 ? html`
          <div class="twocol" style="margin-bottom:8px">
            <div class="card"><h3>1. Скачайте шаблон</h3>
              <div style="margin-bottom:6px">Файл Excel с листами: Инструкция, Товары, Контрагенты, Остатки, Долги.</div>
              <button class="btn pri" onClick=${downloadTemplate}>${I('file-down')} Скачать шаблон Excel</button></div>
            <div class="card"><h3>2. Загрузите заполненный файл</h3>
              <input type="file" accept=".xlsx,.xls" onChange=${(e) => { const f = e.target.files[0]; if (f) readFile(f, (d, m) => load(d, f.name, m)); e.target.value = ''; }} />
              <div style="margin-top:8px" class="muted">Для проверки макета без файла:</div>
              <div class="bar" style="margin-top:4px"><button class="btn" onClick=${() => load(U.clone(DEMO_BAD), 'Демо — с ошибками.xlsx')}>Демо-файл с ошибками</button>
                <button class="btn" onClick=${() => load(U.clone(DEMO_GOOD), 'Демо — корректный.xlsx')}>Демо-файл без ошибок</button></div></div>
          </div>` : null}
        ${st.step === 3 && html`
          <h2 class="sec">3. Предварительный результат — ${st.name}</h2>
          <div class="kpis">${Object.keys(E.IMPORT_SHEETS).map((k) => html`<div class="kpi"><div class="t">${k}</div><div class="v">${st.data[k].length} <span style="font-size:12px;font-weight:400" class=${errs.some((e) => e.sheet === k) ? 'err-t' : 'ok-t'}>${errs.filter((e) => e.sheet === k).length ? `ошибок: ${errs.filter((e) => e.sheet === k).length}` : 'без ошибок'}</span></div></div>`)}</div>
          ${dup ? html`<div class="note err">Этот файл уже загружен документом ${dup.no} от ${U.fmtDT(dup.at)}. Повторная загрузка не создаст второй комплект остатков и долгов — она будет заблокирована.</div>` : null}
          ${dup ? null : errs.length ? html`
            <div class="note err"><b>Найдено ошибок: ${errs.length}.</b> Импорт не будет применён частично. Исправьте файл и загрузите его снова.</div>
            <${UI.Table} maxH="220px" rowKey=${(e) => e.sheet + e.row + e.field + e.msg} rows=${errs} cols=${[
              { k: 'sheet', t: 'Лист', w: '110px' }, { k: 'row', t: 'Строка', a: 'r', w: '60px' }, { k: 'field', t: 'Поле', w: '170px' }, { k: 'msg', t: 'Ошибка', cls: 'wrap err-t' },
            ]} />` : html`<div class="note ok"><b>Ошибок нет.</b> Проверьте данные и подтвердите импорт.</div>`}
          ${v.warn.length ? html`<div class="note warn">${v.warn.map((w) => html`<div>Лист «${w.sheet}», строка ${w.row}: ${w.msg}</div>`)}</div>` : null}
          <${UI.Tabs} cur=${sheet} onChange=${setSheet} tabs=${Object.keys(E.IMPORT_SHEETS).map((k) => ({ k, t: k, n: st.data[k].length }))} />
          <${UI.Table} maxH="260px" rowKey=${(r) => r._row} rows=${st.data[sheet]} rowCls=${(r) => (rowErr(sheet, r._row).length ? 'bad' : '')} cols=${[
            { k: '_row', t: 'Стр.', a: 'r', w: '46px' },
            ...E.IMPORT_SHEETS[sheet].map((c) => ({ k: c, t: c, r: (r) => { const bad = rowErr(sheet, r._row).some((e) => e.field === c); return html`<span class=${bad ? 'err-t b' : ''}>${String(r[c] ?? '')}</span>`; } })),
            { k: 'st', t: 'Проверка', cls: 'wrap', r: (r) => { const re = rowErr(sheet, r._row); return re.length ? html`<span class="err-t">${re.map((e) => e.msg).join('; ')}</span>` : html`<span class="ok-t">✓</span>`; } },
          ]} />
          <div class="bar" style="margin-top:8px">
            <button class="btn pri" disabled=${errs.length > 0 || !!dup} onClick=${apply}>Подтвердить импорт</button>
            <button class="btn" onClick=${() => setSt({ step: 1, data: null })}>Отменить</button>
            <span class="muted">Импорт выполняется целиком одной операцией. Начальные долги не двигают склад — остатки грузятся только с листа «Остатки».</span>
          </div>
          ${st.err ? html`<div class="note err">${st.err}</div>` : null}`}
        ${st.step === 4 && st.result && html`
          <div class="note ok"><b>Импорт выполнен: ${st.result.imp.no}.</b> Файл «${st.name}».</div>
          <div class="kpis">
            <div class="kpi"><div class="t">Товаров</div><div class="v">${st.result.imp.counts.products}</div></div>
            <div class="kpi"><div class="t">Контрагентов</div><div class="v">${st.result.imp.counts.cps}</div></div>
            <div class="kpi"><div class="t">Партий остатков</div><div class="v">${st.result.imp.counts.lots}</div></div>
            <div class="kpi"><div class="t">Строк долгов</div><div class="v">${st.result.imp.counts.debts}</div></div>
          </div>
          ${st.result.offs.length ? html`<div class="note">Выполнены автоматические взаимозачёты встречных долгов: ${st.result.offs.map((o) => html`<${UI.DocLink} r=${E.ref(o)} title /> (${E.cpName(o.cp)}, ${U.som(o.amount)}) `)}</div>` : null}
          <div class="bar"><button class="btn" onClick=${() => UI.go('products')}>Открыть товары</button><button class="btn" onClick=${() => UI.go('cps')}>Открыть контрагентов</button>
            <button class="btn" onClick=${() => setSt({ step: 1, data: null })}>Загрузить другой файл</button>
            <button class="btn" onClick=${() => { setSt({ step: 3, data: st.data, name: st.name, missing: [], result: null }); }}>Попробовать загрузить этот же файл повторно</button></div>`}
        <h2 class="sec">История загрузок</h2>
        <${UI.Table} maxH="160px" rows=${E.S.imports} onOpen=${(d) => UI.openRef(E.ref(d))} cols=${[
          { k: 'at', t: 'Дата', r: (d) => U.fmtDT(d.at), v: (d) => d.at }, { k: 'no', t: 'Номер' }, { k: 'fileName', t: 'Файл' },
          { k: 'c', t: 'Загружено', r: (d) => `товаров ${d.counts.products}, контрагентов ${d.counts.cps}, партий ${d.counts.lots}, долгов ${d.counts.debts}` }, { k: 'author', t: 'Пользователь' },
        ]} />
      </div>`;
  };

  /* ================= Стартовая страница: сценарии проверки ================= */
  const P = (code) => E.S.products.find((p) => p.importCode === code) || {};
  const C = (code) => E.S.cps.find((c) => c.importCode === code) || {};
  const newSaleWith = (code, qty, extra = {}) => { const p = P(code); const s = E.newSale({ ...extra, lines: p.id ? [{ ...E.lineFromProduct(p), qty }] : [] }); UI.go('sale', { id: s.id }); };
  const SCEN = [
    ['Создать товар и найти его в плотной таблице', 'Товары → Ins → заполнить карточку → Ctrl+Enter. Затем поиск по названию, ↑↓ и Enter.', () => UI.go('products')],
    ['Оформить поступление с дополнительными расходами', 'Посмотрите проведённое ПТ-0001 (доставка + грузчики распределены по строкам) или создайте новое.', () => UI.go('receipt', { id: (E.S.receipts.find((r) => r.extras.length) || {}).id })],
    ['Продать товар со скидкой', 'Новая продажа → поиск → Enter → количество → скидка в строке или на документ → F8 → Ctrl+Enter.', () => { const s = E.newSale(); UI.go('sale', { id: s.id }); }],
    ['Оформить частичную оплату и долг', 'Выберите контрагента, в «Принять оплату» введите меньше суммы. Долг появится в карточке контрагента по строкам.', () => newSaleWith('T16', 1.5, { cp: C('K04').id })],
    ['Из продажи с нехваткой открыть приход и вернуться', 'Таз 20 л: остаток 2, в продаже 5. Нажмите «Создать приход», выберите поставщика, проведите — вернётесь в продажу.', () => newSaleWith('T08', 5)],
    ['Создать заказ, увидеть резерв и распечатать лист сборки', 'ЗК-0001: вёдер 20, резерв 6, доступно 14 (видно в «Товарах»). Кнопка «Лист сборки».', () => UI.go('order', { id: (E.S.orders.find((o) => E.ORDER_ACTIVE.includes(o.status)) || E.S.orders[0] || {}).id })],
    ['Превратить заказ в продажу', 'В заказе «Оформить продажу» — строки переносятся, собственный резерв используется при проведении.', () => UI.go('orders')],
    ['Оформить возврат по продаже', 'Откройте проведённую продажу → «Создать возврат» → количество. Цена — фактическая, со скидкой.', () => UI.go('sales')],
    ['Погасить долг частью товара и частью денег', 'Бакыт взял 10 вилок по 100. «Принять погашение долга»: вернуть 5 шт + 500 сом деньгами.', () => UI.go('cp', { id: C('K03').id })],
    ['Увидеть автоматический взаимозачёт', 'Азамат: мы должны 500, он взял ложки на 300 → зачёт 300, мы должны 200. Вкладка «Взаимозачёты».', () => UI.go('cp', { id: C('K02').id })],
    ['Открыть отчёты', 'Остатки, продажи за период, валовая прибыль по FIFO, журнал операций.', () => UI.go('reports')],
    ['Пройти экран предварительной проверки Excel', 'Импорт → «Демо-файл с ошибками» (лист, строка, поле) → «Демо-файл без ошибок» → подтвердить.', () => UI.go('import')],
    ['FIFO: 10×100 + 10×120, продать 12', 'Кружка эмалированная: две начальные партии. После продажи 12 шт себестоимость 1 240, осталось 8 по 120.', () => newSaleWith('T31', 12)],
    ['Два продавца и последняя единица', 'Создайте две продажи одного остатка (переключите пользователя сверху). Проведётся только первая — вторая получит «Не хватает».', () => UI.go('sales')],
  ];
  const ASSUME = [
    'Штуки — целые числа; кг и м — до 3 знаков после запятой. После движений единицу менять нельзя.',
    'Оплата — наличными или через МБанк, можно частями; неоплаченная часть становится долгом. Это касается и продажи, и поступления.',
    'Допрасходы влияют только на себестоимость; расчёты с перевозчиком не ведутся. При нулевой закупке с расходами — блок.',
    'Полностью оплаченную продажу можно провести без контрагента. Переплата (сдача, аванс) не принимается.',
    'В кассе скидка — суммой в сомах на товар. В администрировании — процентом или суммой, на строку и/или на документ; скидка документа распределяется по строкам пропорционально.',
    'Оплата при проведении документа распределяется по строкам долга пропорционально их суммам.',
    'Статусы заказа: Черновик → На сборке (резерв) → Собран → Выполнен / Отменён. Резерв по товару, партии FIFO — при продаже.',
    'Передача соседу = продажа в долг с признаком «передача»; входит в отчёты (есть переключатель в отчётах). Требует подтверждения.',
    'Взаимозачёт автоматический, сначала самые старые долги с обеих сторон. Требует подтверждения.',
    'Возврат покупателя сначала уменьшает долг по возвращаемым строкам; остаток — обязательство вернуть деньги. Партии восстанавливаются в обратном порядке списаний.',
    'Возврат товара соседу (погашение нашего долга) списывает сначала из партии исходного поступления, затем по FIFO; зарезервированный товар вернуть нельзя.',
    'Начальный товарный долг «нам должны» из импорта погашается только деньгами (себестоимость возвращаемого товара неизвестна).',
    'После проведения учётные поля заблокированы. Исправление — отменой проведения (если нет зависимых операций) и копированием в новый документ. Требует подтверждения.',
    'Импорт: при ошибках ничего не загружается; повторная загрузка того же файла блокируется по контрольной сумме.',
  ];
  S.home = () => html`
    <div class="head"><h1>Демонстрационный макет</h1></div>
    <div class="body">
      <h2 class="sec">Сценарии проверки</h2>
      <${UI.Table} maxH="none" rowKey=${(r) => r[0]} rows=${SCEN} onOpen=${(r) => r[2]()} cols=${[
        { k: 'n', t: '№', w: '30px', a: 'r', nosort: true, r: (r) => SCEN.indexOf(r) + 1 },
        { k: '0', t: 'Сценарий', nosort: true, r: (r) => html`<b>${r[0]}</b>` },
        { k: '1', t: 'Как проверить', cls: 'wrap muted', nosort: true },
        { k: 'go', t: '', w: '90px', nosort: true, r: (r) => html`<button class="btn sm" onClick=${r[2]}>Перейти →</button>` },
      ]} />
      <div class="twocol" style="margin-top:12px">
        <div class="card"><h3>Допущения макета («предлагаемые правила»)</h3>
          <ol style="margin:0;padding-left:18px;font-size:12px">${ASSUME.map((a) => html`<li style="margin:3px 0">${a}</li>`)}</ol>
          </div>
        <div class="card"><h3>Горячие клавиши</h3><${HotkeysTable} /></div>
      </div>
    </div>`;

  const HotkeysTable = () => html`<table class="help-keys" style="font-size:12px">
    <tr><td>Alt+1…7</td><td>Разделы меню (Товары, Продажи, Заказы, Поступления, Контрагенты, Отчёты, Импорт)</td></tr>
    <tr><td>F2 / Ins</td><td>Создать документ или элемент в текущем списке</td></tr>
    <tr><td>Ctrl+F</td><td>Поиск в списке</td></tr>
    <tr><td>↑ ↓ PgUp PgDn</td><td>Перемещение по таблице; Enter — открыть</td></tr>
    <tr><td>F4</td><td>В документе: поиск товара</td></tr>
    <tr><td>Enter</td><td>В подборе: добавить выделенный товар; в количестве — вернуться к поиску</td></tr>
    <tr><td>F3</td><td>В подборе: карточка товара (документ не закрывается)</td></tr>
    <tr><td>F8</td><td>В продаже: принять оплату</td></tr>
    <tr><td>Ctrl+Enter</td><td>Провести / завершить документ, записать карточку</td></tr>
    <tr><td>Ctrl+P</td><td>В заказе: лист сборки</td></tr>
    <tr><td>Esc</td><td>Закрыть окно / вернуться к списку (черновик сохраняется)</td></tr>
    <tr><td>Tab</td><td>Переход между полями</td></tr>
    <tr><td>F1</td><td>Эта справка</td></tr></table>`;
  UI.HotkeysTable = HotkeysTable;
})();
