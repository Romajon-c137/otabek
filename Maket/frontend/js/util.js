/* Утилиты: округление, форматирование, распределение сумм. */
(function () {
  const U = (window.U = {});

  // Денежные суммы — 2 знака, количества — 3 знака. В реальной программе — decimal на сервере.
  U.r2 = (x) => { const s = x < 0 ? -1 : 1; return (s * Math.round(Math.abs(x) * 100 + 1e-6)) / 100; };
  U.r3 = (x) => { const s = x < 0 ? -1 : 1; return (s * Math.round(Math.abs(x) * 1000 + 1e-6)) / 1000; };
  U.eq = (a, b) => Math.abs((a || 0) - (b || 0)) < 0.0005;
  U.gt0 = (x) => (x || 0) > 0.0005;
  U.sum = (arr, f) => arr.reduce((a, x) => a + (f ? f(x) : x), 0);

  U.num = (v) => {
    if (typeof v === 'number') return v;
    if (v == null) return NaN;
    const s = String(v).replace(/[\s ]/g, '').replace(',', '.');
    if (s === '') return NaN;
    return /^-?\d*\.?\d+$|^-?\d+\.$/.test(s) ? Number(s) : NaN;
  };
  U.isNum = (v) => typeof v === 'number' && isFinite(v);

  const fm2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const fm0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
  const fq = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });
  U.money = (x) => fm2.format(U.r2(x || 0));
  U.som = (x) => fm0.format(U.r2(x || 0)) + ' сом';
  U.qty = (q) => fq.format(U.r3(q || 0));
  U.qtyU = (q, unit) => U.qty(q) + ' ' + unit;
  U.editStr = (v) => (v == null || (typeof v === 'number' && isNaN(v)) ? '' : String(v).replace('.', ','));

  U.validQty = (q, unit) => U.isNum(q) && q > 0 && (unit === 'шт' ? Number.isInteger(q) : U.eq(U.r3(q), q));
  U.qtyRule = (unit) => (unit === 'шт' ? 'целое число штук' : 'не более 3 знаков после запятой');

  /* Пропорциональное распределение суммы с сохранением точного итога (метод наибольших остатков, в тыйынах). */
  U.alloc = (total, weights) => {
    const T = Math.round(total * 100);
    const W = U.sum(weights);
    if (!(W > 0)) return null;
    const raw = weights.map((w) => (T * w) / W);
    const fl = raw.map((r) => Math.floor(r + 1e-9));
    const rest = T - U.sum(fl);
    const order = raw.map((r, i) => [r - fl[i], i]).sort((a, b) => b[0] - a[0]);
    for (let k = 0; k < rest; k++) fl[order[k % order.length][1]]++;
    return fl.map((c) => c / 100);
  };

  const p2 = (n) => String(n).padStart(2, '0');
  U.pad = (n, w = 4) => String(n).padStart(w, '0');
  U.fmtDate = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`; };
  U.fmtDT = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${U.fmtDate(iso)} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
  U.isoDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
  U.clone = (x) => JSON.parse(JSON.stringify(x));
  U.hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(16); };
  U.norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
  U.match = (q, ...fields) => {
    const words = U.norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const hay = U.norm(fields.join(' '));
    return words.every((w) => hay.includes(w));
  };
  U.plural = (n, a, b, c) => { const m = Math.abs(n) % 100, m1 = m % 10; if (m > 10 && m < 20) return c; if (m1 > 1 && m1 < 5) return b; if (m1 === 1) return a; return c; };
})();
