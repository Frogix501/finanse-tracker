// ---------- Ustawienia lokalne ----------
const LS = {
  get(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
};
let settings = {
  apiBase: LS.get('ft_apiBase', ''),
  refreshSec: LS.get('ft_refreshSec', 3),
  sound: LS.get('ft_sound', false),
};
let goal = LS.get('ft_goal', null);
let selectedRange = 86400000; // 24h

// Stan boxow (kotwice do liczenia zarobku - resetowalne)
let stat = {
  session: LS.get('ft_session', null), // {t, v} - start biezacej sesji
  day: LS.get('ft_day', null),         // {date, v} - poczatek dnia
  record: LS.get('ft_record', null),   // {bestRate, peak}
};

// ---------- Formatowanie ----------
function fmt(n) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  const neg = n < 0; const a = Math.abs(n); let s;
  if (a >= 1e12) s = round(a / 1e12) + 'T';
  else if (a >= 1e9) s = round(a / 1e9) + 'B';
  else if (a >= 1e6) s = round(a / 1e6) + 'M';
  else if (a >= 1e3) s = round(a / 1e3) + 'K';
  else s = round(a);
  return (neg ? '-' : '') + s;
}
function round(v) {
  if (v >= 100) return Math.round(v).toString();
  return (Math.round(v * 100) / 100).toString();
}
function fmtFull(n) {
  if (!isFinite(n)) return '—';
  return Math.round(n).toLocaleString('pl-PL') + '$';
}
function fmtSigned(n) { return (n >= 0 ? '+' : '') + fmt(n); }

// zamienia "1.5M", "500K", "2,5B", "12345" na liczbę
function parseAmount(str) {
  if (!str) return null;
  const m = String(str).trim().replace(/\s/g, '').replace(',', '.')
    .match(/^([0-9]*\.?[0-9]+)([kmbtKMBT])?$/);
  if (!m) return null;
  let v = parseFloat(m[1]);
  const suf = (m[2] || '').toLowerCase();
  if (suf === 'k') v *= 1e3; else if (suf === 'm') v *= 1e6;
  else if (suf === 'b') v *= 1e9; else if (suf === 't') v *= 1e12;
  return v;
}

// ---------- Obliczenia ----------
// tempo zarobku [na minutę] z okna czasowego (domyślnie ostatnie 5 min)
function computeRate(points, windowMs = 300000) {
  if (points.length < 2) return 0;
  const now = points[points.length - 1].t;
  const from = now - windowMs;
  const win = points.filter(p => p.t >= from);
  if (win.length < 2) {
    // za mało w oknie – weź dwa ostatnie
    const a = points[points.length - 2], b = points[points.length - 1];
    const dtMin = (b.t - a.t) / 60000;
    return dtMin > 0 ? (b.v - a.v) / dtMin : 0;
  }
  const a = win[0], b = win[win.length - 1];
  const dtMin = (b.t - a.t) / 60000;
  return dtMin > 0 ? (b.v - a.v) / dtMin : 0;
}

// tempo [na minutę] liczone TYLKO od momentu sinceT (start sesji)
function rateWithin(points, sinceT, windowMs = 300000) {
  const pts = points.filter(p => p.t >= sinceT);
  if (pts.length < 2) return 0;
  const last = pts[pts.length - 1].t;
  const from = Math.max(sinceT, last - windowMs);
  let win = pts.filter(p => p.t >= from);
  if (win.length < 2) win = pts.slice(-2);
  const a = win[0], b = win[win.length - 1];
  const dtMin = (b.t - a.t) / 60000;
  return dtMin > 0 ? (b.v - a.v) / dtMin : 0;
}

// suma dodatnich przyrostów w danym zakresie czasu
function sumGains(points, fromT, toT) {
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p.t <= fromT || p.t > toT) continue;
    const d = p.v - points[i - 1].v;
    if (d > 0) sum += d;
  }
  return sum;
}

function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }

// zarobek pogrupowany wg godziny doby (dzisiaj)
function earningsByHour(points) {
  const hours = new Array(24).fill(0);
  const t0 = startOfToday();
  for (let i = 1; i < points.length; i++) {
    if (points[i].t < t0) continue;
    const d = points[i].v - points[i - 1].v;
    if (d > 0) hours[new Date(points[i].t).getHours()] += d;
  }
  return hours;
}

// zarobek wg dnia (ostatnie N dni)
function earningsByDay(points, days = 14) {
  const map = {};
  for (let i = 1; i < points.length; i++) {
    const d = points[i].v - points[i - 1].v;
    if (d <= 0) continue;
    const key = new Date(points[i].t).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
    map[key] = (map[key] || 0) + d;
  }
  const labels = [], data = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now); d.setDate(now.getDate() - i);
    const key = d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
    labels.push(key); data.push(map[key] || 0);
  }
  return { labels, data };
}

// info o bieżącej sesji (przerwa > gap = nowa sesja)
function sessionInfo(points, gapMs = 600000) {
  if (!points.length) return null;
  let startIdx = 0;
  for (let i = points.length - 1; i > 0; i--) {
    if (points[i].t - points[i - 1].t > gapMs) { startIdx = i; break; }
  }
  const start = points[startIdx];
  const last = points[points.length - 1];
  let best = 0;
  for (let i = startIdx + 1; i < points.length; i++) {
    const dtMin = (points[i].t - points[i - 1].t) / 60000;
    if (dtMin > 0.05) {
      const r = (points[i].v - points[i - 1].v) / dtMin;
      if (r > best) best = r;
    }
  }
  return {
    startT: start.t, startV: start.v,
    profit: last.v - start.v,
    duration: last.t - start.t,
    best,
  };
}

function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

// ---------- Wykresy ----------
Chart.defaults.color = '#9a8fc4';
Chart.defaults.font.family = "'Segoe UI', sans-serif";
Chart.defaults.borderColor = 'rgba(53, 39, 94, 0.5)';

let balanceChart, hourChart, dayChart;

function initCharts() {
  const gridC = 'rgba(53, 39, 94, 0.35)';

  balanceChart = new Chart(document.getElementById('balanceChart'), {
    type: 'line',
    data: { datasets: [{
      label: 'Stan konta', data: [],
      borderColor: '#3ce07a', borderWidth: 2,
      backgroundColor: (ctx) => {
        const c = ctx.chart.ctx; const g = c.createLinearGradient(0, 0, 0, 300);
        g.addColorStop(0, 'rgba(60,224,122,0.28)'); g.addColorStop(1, 'rgba(60,224,122,0)');
        return g;
      },
      fill: true, tension: 0.25, pointRadius: 0, pointHoverRadius: 4,
    }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: (c) => ' ' + fmtFull(c.parsed.y) } } },
      scales: {
        x: { type: 'time', grid: { color: gridC }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
        y: { grid: { color: gridC }, ticks: { callback: (v) => fmt(v) } },
      },
    },
  });

  hourChart = new Chart(document.getElementById('hourChart'), {
    type: 'bar',
    data: { labels: [...Array(24).keys()].map(h => h + 'h'), datasets: [{
      label: 'Zarobek', data: new Array(24).fill(0),
      backgroundColor: '#a970ff', borderRadius: 4,
    }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + fmtFull(c.parsed.y) } } },
      scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } },
                y: { grid: { color: gridC }, ticks: { callback: (v) => fmt(v) } } },
    },
  });

  dayChart = new Chart(document.getElementById('dayChart'), {
    type: 'bar',
    data: { labels: [], datasets: [{
      label: 'Zarobek', data: [],
      backgroundColor: '#3ce07a', borderRadius: 4,
    }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + fmtFull(c.parsed.y) } } },
      scales: { x: { grid: { display: false } },
                y: { grid: { color: gridC }, ticks: { callback: (v) => fmt(v) } } },
    },
  });
}

// ---------- Animacja liczby ----------
let displayedBalance = null;
function animateBalance(target) {
  const el = document.getElementById('balance');
  if (displayedBalance === null) { displayedBalance = target; el.textContent = fmt(target); return; }
  const start = displayedBalance, diff = target - start;
  if (Math.abs(diff) < 0.001) { el.textContent = fmt(target); return; }
  const t0 = performance.now(), dur = 600;
  function step(now) {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(start + diff * eased);
    if (p < 1) requestAnimationFrame(step); else displayedBalance = target;
  }
  requestAnimationFrame(step);
}

// ---------- Główna aktualizacja ----------
let lastBalance = null;

async function refresh() {
  let data;
  try {
    const res = await fetch(settings.apiBase + '/api/data', { cache: 'no-store' });
    data = await res.json();
  } catch (e) {
    setStatus(false, 'brak połączenia z serwerem');
    return;
  }

  const connected = data.connected;
  setStatus(connected, connected ? 'połączono z modem' : 'mod nieaktywny (brak danych)');

  const points = (data.points || []).map(p => ({ t: p.t, v: p.v }));
  const latest = data.latest;
  const current = latest ? latest.v : (points.length ? points[points.length - 1].v : null);

  // Hero
  if (current !== null) {
    animateBalance(current);
    document.getElementById('balanceFull').textContent = fmtFull(current);
    if (lastBalance !== null && current > lastBalance) onGain(current - lastBalance);
    lastBalance = current;
  }
  document.getElementById('playerName').textContent = latest && latest.p ? latest.p : '—';
  document.getElementById('rawValue').textContent = latest && latest.raw ? latest.raw : '—';

  // upewnij się, że "teraz" jest w danych do liczenia tempa
  const calcPoints = points.slice();
  if (latest && (!calcPoints.length || calcPoints[calcPoints.length - 1].t !== latest.t)) {
    calcPoints.push({ t: latest.t, v: latest.v });
  }

  const nowT = data.now || Date.now();

  // === SESJA: auto-start gdy połączony, auto-reset do zera gdy mod się rozłączy ===
  if (connected && current !== null) {
    if (!stat.session) { stat.session = { t: nowT, v: current }; LS.set('ft_session', stat.session); }
  } else if (stat.session) {
    stat.session = null; LS.set('ft_session', null); // koniec połączenia -> sesja wyzerowana
  }

  // === TEMPO: liczone tylko w obrębie sesji; 0 gdy rozłączony (reset i start od nowa) ===
  const rate = stat.session ? rateWithin(calcPoints, stat.session.t) : 0;
  document.getElementById('ratePerMin').textContent = fmtSigned(rate) + '$';
  document.getElementById('ratePerHour').textContent = fmtSigned(rate * 60) + '$/h';

  // === DZISIAJ: kotwica dnia (auto-reset o północy, lub ręcznie) ===
  const todayStr = new Date().toDateString();
  if (current !== null && (!stat.day || stat.day.date !== todayStr)) {
    stat.day = { date: todayStr, v: current };
    LS.set('ft_day', stat.day);
  }
  const today = (current !== null && stat.day) ? current - stat.day.v : 0;
  document.getElementById('today').textContent = fmtSigned(today) + '$';

  // === TA SESJA (zysk + czas) ===
  if (stat.session && current !== null) {
    document.getElementById('sessionProfit').textContent = fmtSigned(current - stat.session.v) + '$';
    document.getElementById('sessionSub').textContent =
      `${fmtDuration(nowT - stat.session.t)} · start ${fmt(stat.session.v)}`;
  } else {
    document.getElementById('sessionProfit').textContent = '+0$';
    document.getElementById('sessionSub').textContent = connected ? 'łączenie…' : 'brak połączenia z modem';
  }

  // === REKORD / SZCZYT (resetowalne) ===
  if (!stat.record) stat.record = { bestRate: 0, peak: (current ?? 0) };
  if (current !== null && current > stat.record.peak) stat.record.peak = current;
  if (rate > stat.record.bestRate) stat.record.bestRate = rate;
  LS.set('ft_record', stat.record);
  document.getElementById('bestRate').textContent = fmt(stat.record.bestRate) + '$';
  document.getElementById('peakBalance').textContent = 'szczyt: ' + fmt(stat.record.peak);

  // Wykres stanu
  updateBalanceChart(calcPoints);

  // Godziny
  const hours = earningsByHour(calcPoints);
  hourChart.data.datasets[0].data = hours;
  const bestH = hours.indexOf(Math.max(...hours));
  document.getElementById('bestHourHint').textContent =
    Math.max(...hours) > 0 ? `najlepsza godzina: ${bestH}:00 (${fmt(hours[bestH])}$)` : '';
  hourChart.update('none');

  // Dni
  const bd = earningsByDay(calcPoints, 14);
  dayChart.data.labels = bd.labels;
  dayChart.data.datasets[0].data = bd.data;
  const nonZero = bd.data.filter(x => x > 0);
  const avg = nonZero.length ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length : 0;
  document.getElementById('avgDayHint').textContent = avg > 0 ? `średnio ${fmt(avg)}$/dzień` : '';
  dayChart.update('none');

  // Cel + prognoza
  updateGoal(current, rate);
  updateForecast(current, rate);

  document.getElementById('lastUpdate').textContent =
    'ostatnia aktualizacja: ' + new Date().toLocaleTimeString('pl-PL');
}

function updateBalanceChart(points) {
  let pts = points;
  if (selectedRange > 0) {
    const from = Date.now() - selectedRange;
    pts = points.filter(p => p.t >= from);
  }
  // downsampling dla wydajności
  if (pts.length > 800) {
    const step = Math.ceil(pts.length / 800);
    pts = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  }
  balanceChart.data.datasets[0].data = pts.map(p => ({ x: p.t, y: p.v }));
  balanceChart.update('none');
}

function updateGoal(current, rate) {
  const bar = document.getElementById('goalBar');
  const pct = document.getElementById('goalPct');
  const eta = document.getElementById('goalEta');
  if (!goal || current === null) {
    bar.style.width = '0%'; pct.textContent = 'brak celu'; eta.textContent = '';
    return;
  }
  const p = Math.max(0, Math.min(100, (current / goal) * 100));
  bar.style.width = p + '%';
  pct.textContent = `${fmt(current)} / ${fmt(goal)} (${p.toFixed(1)}%)`;
  if (current >= goal) { eta.textContent = '🎉 cel osiągnięty!'; return; }
  if (rate > 0) {
    const minutes = (goal - current) / rate;
    eta.textContent = 'ETA: ' + fmtDuration(minutes * 60000);
  } else {
    eta.textContent = 'ETA: — (brak zarobku)';
  }
}

function updateForecast(current, rate) {
  const set = (id, mins) => {
    const el = document.getElementById(id);
    if (current === null) { el.textContent = '—'; return; }
    el.textContent = fmt(current + rate * mins) + '$';
  };
  set('fc1h', 60);
  set('fc8h', 480);
  const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
  set('fcEod', Math.max(0, (endOfDay.getTime() - Date.now()) / 60000));
  set('fc24h', 1440);
}

// ---------- Gain effect ----------
let audioCtx;
function onGain(delta) {
  const el = document.getElementById('gainFlash');
  el.textContent = '+' + fmt(delta) + '$';
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  if (settings.sound) beep();
}
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = 880; o.type = 'sine';
    g.gain.setValueAtTime(0.08, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
    o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + 0.15);
  } catch {}
}

function setStatus(on, text) {
  document.getElementById('statusDot').className = 'dot ' + (on ? 'on' : 'off');
  document.getElementById('statusText').textContent = text;
}

// ---------- UI eventy ----------
document.getElementById('rangeBtns').addEventListener('click', (e) => {
  if (e.target.tagName !== 'BUTTON') return;
  document.querySelectorAll('#rangeBtns button').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  selectedRange = Number(e.target.dataset.range);
  refresh();
});

document.getElementById('goalSet').addEventListener('click', () => {
  const v = parseAmount(document.getElementById('goalInput').value);
  if (v) { goal = v; LS.set('ft_goal', goal); refresh(); }
});
document.getElementById('goalClear').addEventListener('click', () => {
  goal = null; LS.set('ft_goal', null); document.getElementById('goalInput').value = ''; refresh();
});

// Reset boxów
document.querySelectorAll('[data-reset]').forEach(btn => {
  btn.addEventListener('click', () => resetStat(btn.dataset.reset));
});
function resetStat(which) {
  const cur = lastBalance;
  const now = Date.now();
  const newSession = () => (cur !== null ? { t: now, v: cur } : null);
  const newDay = () => ({ date: new Date().toDateString(), v: cur ?? 0 });
  const newRecord = () => ({ bestRate: 0, peak: cur ?? 0 });
  if (which === 'session' || which === 'rate' || which === 'all') {
    stat.session = newSession(); LS.set('ft_session', stat.session);
  }
  if (which === 'today' || which === 'all') {
    stat.day = newDay(); LS.set('ft_day', stat.day);
  }
  if (which === 'record' || which === 'all') {
    stat.record = newRecord(); LS.set('ft_record', stat.record);
  }
  refresh();
}

// Ustawienia modal
const modal = document.getElementById('settingsModal');
document.getElementById('settingsBtn').addEventListener('click', () => {
  document.getElementById('apiBase').value = settings.apiBase;
  document.getElementById('refreshSec').value = settings.refreshSec;
  document.getElementById('soundToggle').checked = settings.sound;
  modal.classList.remove('hidden');
});
document.getElementById('settingsClose').addEventListener('click', () => modal.classList.add('hidden'));
document.getElementById('settingsSave').addEventListener('click', () => {
  settings.apiBase = document.getElementById('apiBase').value.trim().replace(/\/$/, '');
  settings.refreshSec = Math.max(1, Number(document.getElementById('refreshSec').value) || 3);
  settings.sound = document.getElementById('soundToggle').checked;
  LS.set('ft_apiBase', settings.apiBase);
  LS.set('ft_refreshSec', settings.refreshSec);
  LS.set('ft_sound', settings.sound);
  modal.classList.add('hidden');
  restartLoop();
});

// ---------- Pętla ----------
let loopTimer;
function restartLoop() {
  clearInterval(loopTimer);
  loopTimer = setInterval(refresh, settings.refreshSec * 1000);
}

initCharts();
if (goal) document.getElementById('goalInput').value = fmt(goal);
refresh();
restartLoop();
