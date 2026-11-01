/* Panel Draguz TV — tablero de pendientes estilo aeropuerto (paletas split-flap) para LG webOS.
   Este archivo vive en GitHub Pages (TAREAS-PAULO/tv/). La app de la tele lo descarga al abrir
   y cada 20 min revisa version.json: si subes un cambio y subes el número de versión, la tele se actualiza sola.
   Lee el mismo nodo de Firebase que TAREAS-PAULO ('draguz-board-v1'). Nunca borra ni sobrescribe el tablero:
   lo único que escribe ahí es marcar/desmarcar una tarea como hecha (y la racha).
   El control desde el cel usa otro nodo aparte: 'panel-tv-v1' (comandos, aviso y estado de la tele). */
(function () {
  'use strict';
  if (window.__PANEL_STARTED) return;   // evita arrancar dos veces (remoto + respaldo local)
  window.__PANEL_STARTED = true;

  var VERSION = '1.2.0';
  var MARKUP = ''
    + '<div id="shift">'
    + ' <div class="sign">'
    + '  <div class="picto"><div class="dz">DZ</div></div>'
    + '  <h1>Pendientes</h1><div class="en">Draguz · Del Bravo · Personal</div>'
    + '  <div class="clock"><div class="cells" id="clk"></div><div class="cells ap" id="clkAp"></div></div>'
    + ' </div>'
    + ' <div class="sub"><span class="date" id="dte"></span><span class="sum" id="sum"></span><span class="live" id="live"><i></i><span>Conectando</span></span></div>'
    + ' <section class="view" id="vFids"><div class="board"><div class="bhead"><div>Fecha</div><div>Área</div><div>Pendiente</div><div>Estado</div></div><div id="rows"></div></div><div class="legend" id="legend"></div></section>'
    + ' <section class="view" id="vBoard"><div id="lanesWrap"><div id="lanes"></div></div></section>'
    + ' <section class="view" id="vClock"><div class="bigclock"><div class="cells" id="bclk"></div><div class="cells ap" id="bclkAp"></div></div><div class="cdate" id="cdate"></div><div class="cnext" id="cnext"></div></section>'
    + '</div>'
    + '<div class="keys" id="keys"><span><i style="background:#3b6fd6"></i>Cambiar vista</span><span><i style="background:#e0c234"></i><b id="autoLbl">Cambio automático: sí</b></span><span>Flechas y OK · elegir tarea</span><span><i style="background:#d33"></i>Recargar</span></div>'
    + '<div class="dlg" id="dlg"><div class="box"><div class="hd" id="dK"></div><div class="bd"><h3 id="dT"></h3><p id="dN"></p><ul id="dS"></ul><div class="btns" id="dB"></div></div></div></div>'
    + '<div id="aviso"><div class="av-box"><div class="av-top" id="avTop"><div class="av-ic"><b>!</b></div><h2>Aviso</h2><span class="from" id="avFrom"></span></div><div class="av-text" id="avText"></div><div class="av-hint" id="avHint">OK para quitar</div><div class="av-bar"><div id="avBar"></div></div></div></div>'
    + '<div class="toast" id="toast"></div>'
    + '<div id="night"></div>';
  (function buildMarkup() {
    var st = document.getElementById('stage');
    if (!st) { st = document.createElement('div'); st.id = 'stage'; document.body.appendChild(st); }
    st.innerHTML = MARKUP;
  })();

  var APP_ID = 'com.paulo.tablerotv';
  var firebaseConfig = {
    apiKey: 'AIzaSyAnQ7e2iQ-cKyUB3xOoL4Yim0FWy1GqvME',
    authDomain: 'tareas-paulo.firebaseapp.com',
    databaseURL: 'https://tareas-paulo-default-rtdb.firebaseio.com',
    projectId: 'tareas-paulo'
  };
  var BOARD_PATH = 'draguz-board-v1';

  /* ---- Ajustes del modo protector ---- */
  var CFG = {
    viewMs: 40000,        // cada cuánto cambia de vista cuando nadie usa el control
    idleMs: 45000,        // tiempo sin tocar el control para volver a modo protector
    pageMs: 10000,        // cambio de página en Salidas
    shiftMs: 180000,      // cada 3 min mueve todo unos pixeles (cuida la pantalla)
    shiftPx: 10,
    nightFrom: 0,         // modo noche: de 12:00 a. m. ...
    nightTo: 7,           // ... a 7:00 a. m. (solo reloj y brillo bajo)
    nightDim: 0.6,
    rows: 8
  };
  var COLS = { date: 6, code: 3, title: 31, st: 9 };

  var PRIORITY_ORDER = { alta: 0, media: 1, baja: 2 };
  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, ESC: 27, BKSP: 8, RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406 };
  var DEMO = /[?&]demo/.test(location.search);
  var FORCE_NIGHT = /[?&]noche/.test(location.search), FORCE_DAY = /[?&]dia/.test(location.search);

  var data = { tasks: [], categories: [], meta: { streak: 0, lastCompletionDate: null } };
  var loaded = false, view = 'fids', auto = true, lastKey = 0, night = false, nightMode = 'auto';
  var remoteRef = null, avisoTimer = null, avisoId = null;
  var sel = { lane: 0, card: 0, id: null, active: false };
  var dlg = null, page = 0, boardRef = null, laneOffsets = {};

  function $(id) { return document.getElementById(id); }
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayUTC() { return new Date().toISOString().slice(0, 10); } // igual que la app original, para que la racha cuadre
  function localDay(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ---------- escalado 1920x1080 ---------- */
  function fit() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080), st = $('stage');
    st.style.transform = 'scale(' + s + ')';
    st.style.left = ((window.innerWidth - 1920 * s) / 2) + 'px';
    st.style.top = ((window.innerHeight - 1080 * s) / 2) + 'px';
  }
  window.addEventListener('resize', fit);

  /* =========================================================
     PALETAS SPLIT-FLAP
     ========================================================= */
  var SPIN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  var queue = [];
  function makeCells(container, n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var f = document.createElement('div'); f.className = 'f';
      var s = document.createElement('span'); s.textContent = ' ';
      f.appendChild(s); container.appendChild(f);
      out.push({ el: f, span: s, ch: ' ' });
    }
    return out;
  }
  function fitText(str, n, align) {
    str = (str || '').toUpperCase();
    if (str.length > n) {
      var cut = str.slice(0, n - 1), sp = cut.lastIndexOf(' ');
      str = (sp > n * 0.6 ? cut.slice(0, sp) : cut) + '…';
    }
    if (align === 'right') while (str.length < n) str = ' ' + str;
    while (str.length < n) str += ' ';
    return str.slice(0, n);
  }
  function setCells(cells, str, delay, align) {
    var t = fitText(str, cells.length, align), now = Date.now();
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i], target = t.charAt(i);
      if (c.ch === target && !c.pending) continue;
      if (c.pending) { c.pending.target = target; continue; }
      var job = { c: c, target: target, steps: 2 + Math.floor(Math.random() * 5), at: now + (delay || 0) + i * 22 };
      c.pending = job; queue.push(job);
    }
  }
  var flip = false;
  setInterval(function () {
    if (!queue.length) return;
    var now = Date.now(), rest = [];
    flip = !flip;
    for (var i = 0; i < queue.length; i++) {
      var j = queue[i];
      if (j.at > now) { rest.push(j); continue; }
      var c = j.c;
      c.el.className = 'f ' + (flip ? 'ta' : 'tb');
      if (j.steps > 0) { c.span.textContent = SPIN.charAt(Math.floor(Math.random() * SPIN.length)); j.steps--; rest.push(j); }
      else { c.span.textContent = j.target; c.ch = j.target; c.pending = null; }
    }
    queue = rest;
  }, 60);

  /* ---------- armar el tablero de Salidas ---------- */
  var rowCells = [];
  function buildRows() {
    var box = $('rows'); box.innerHTML = ''; rowCells = [];
    for (var r = 0; r < CFG.rows; r++) {
      var row = document.createElement('div'); row.className = 'brow';
      var cols = {};
      ['date', 'code', 'title', 'st'].forEach(function (k) {
        var c = document.createElement('div'); c.className = 'cells ' + k; row.appendChild(c);
        cols[k] = { el: c, cells: makeCells(c, COLS[k]) };
      });
      box.appendChild(row); rowCells.push(cols);
    }
    var w = function (n) { return n * 31 + (n - 1) * 3; };
    var hs = document.querySelectorAll('.bhead div');
    hs[0].style.width = w(COLS.date) + 'px'; hs[1].style.width = w(COLS.code) + 'px'; hs[2].style.width = w(COLS.title) + 'px';
  }

  /* ---------- relojes de 12 horas ---------- */
  var clk = null, clkAp = null, bclk = null, bclkAp = null;
  function time12() {
    var n = new Date(), h = n.getHours() % 12 || 12;
    return { hm: (h < 10 ? ' ' : '') + h + ':' + pad(n.getMinutes()), ap: n.getHours() < 12 ? 'AM' : 'PM' };
  }
  function tick() {
    var t = time12();
    setCells(clk, t.hm); setCells(clkAp, t.ap, 150);
    setCells(bclk, t.hm); setCells(bclkAp, t.ap, 150);
    bclk[0].el.style.display = t.hm.charAt(0) === ' ' ? 'none' : '';
    var dd = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
    $('dte').textContent = cap(dd);
    $('cdate').textContent = cap(dd);
  }

  /* ---------- fechas y datos ---------- */
  function dueInfo(dateStr) {
    if (!dateStr) return null;
    var d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d)) return null;
    var t = new Date(); t.setHours(0, 0, 0, 0);
    var diff = Math.round((d - t) / 86400000);
    var m = d.toLocaleDateString('es-MX', { month: 'short' }).replace('.', '').slice(0, 3);
    return { diff: diff, label: pad(d.getDate()) + ' ' + m, state: diff < 0 ? 'over' : diff === 0 ? 'today' : diff <= 2 ? 'soon' : 'ok' };
  }
  function catOf(id) {
    for (var i = 0; i < data.categories.length; i++) if (data.categories[i].id === id) return data.categories[i];
    return { id: id, name: 'Sin área', color: '#5E6371' };
  }
  // código de 3 letras tipo aerolínea a partir del nombre de la categoría
  function catCode(cat) {
    var words = String(cat.name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    var code = words.length >= 3 ? words[0][0] + words[1][0] + words[2][0] : words.length === 2 ? words[0][0] + words[1].slice(0, 2) : (words[0] || '---').slice(0, 3);
    return (code + '---').slice(0, 3);
  }
  function pending() { return data.tasks.filter(function (t) { return !t.done; }); }

  function readSnapshot(snap) {
    var tasks = [], cats = [];
    snap.child('tasks').forEach(function (c) {
      var t = c.val();
      if (t && typeof t === 'object') { t._key = c.key; if (!Array.isArray(t.subtasks)) t.subtasks = []; tasks.push(t); }
    });
    snap.child('categories').forEach(function (c) { var v = c.val(); if (v && v.id) cats.push(v); });
    data.tasks = tasks; data.categories = cats;
    data.meta = snap.child('meta').val() || { streak: 0, lastCompletionDate: null };
    loaded = true;
    renderAll();
  }
  function startFirebase() {
    firebase.initializeApp(firebaseConfig);
    var db = firebase.database();
    boardRef = db.ref(BOARD_PATH);
    boardRef.on('value', readSnapshot, function () { setLive('err', 'Sin permiso para leer'); });
    db.ref('.info/connected').on('value', function (s) {
      if (s.val()) { setLive('on', 'En vivo'); reportState(); } else setLive('', loaded ? 'Reconectando' : 'Conectando');
    });
    startRemote(db);
  }
  function startDemo() {
    var d = function (n) { var x = new Date(); x.setDate(x.getDate() + n); return localDay(x); };
    data = {
      categories: [
        { id: 'cat_trabajo', name: 'Del Bravo · Trabajo', color: '#5B7DB1' },
        { id: 'cat_draguz', name: 'Draguz Shop', color: '#B8892A' },
        { id: 'cat_personal', name: 'Personal / Fitness', color: '#4C8B6B' }
      ],
      meta: { streak: 4, lastCompletionDate: todayUTC() },
      tasks: [
        { id: 't1', title: 'Revisar previo de importación A1', category: 'cat_trabajo', priority: 'alta', due: d(-1), notes: 'Mercancía en patio fiscal, cliente urgente', subtasks: [{ id: 's1', text: 'Fotos del previo', done: true }, { id: 's2', text: 'Subir a OneDrive', done: false }] },
        { id: 't2', title: 'Rectificar pedimento V1', category: 'cat_trabajo', priority: 'media', due: d(0), notes: '', subtasks: [] },
        { id: 't3', title: 'Cotizar DTF con Eurocoton', category: 'cat_draguz', priority: 'alta', due: d(1), notes: 'Pedir precio mayoreo de polo Dri-Fit', subtasks: [] },
        { id: 't4', title: 'Subir catálogo de semitonos a la página', category: 'cat_draguz', priority: 'media', due: d(5), notes: '', subtasks: [{ id: 's3', text: 'Exportar fotos', done: true }, { id: 's4', text: 'Códigos ST', done: true }, { id: 's5', text: 'Publicar', done: false }] },
        { id: 't5', title: 'Grabar reel UGC de playera oversize', category: 'cat_draguz', priority: 'baja', due: null, notes: '', subtasks: [] },
        { id: 't6', title: 'Pierna y cardio 20 min', category: 'cat_personal', priority: 'media', due: d(0), notes: '', subtasks: [] },
        { id: 't7', title: 'Pagar internet', category: 'cat_personal', priority: 'alta', due: d(2), notes: '', subtasks: [] },
        { id: 't8', title: 'Enviar cuenta de gastos', category: 'cat_trabajo', priority: 'baja', due: d(8), notes: '', subtasks: [] },
        { id: 't9', title: 'Comprar película DTF', category: 'cat_draguz', priority: 'media', done: true, completedAt: new Date().toISOString(), subtasks: [] }
      ]
    };
    data.tasks.forEach(function (t, i) { t._key = String(i); });
    loaded = true; setLive('on', 'Demo'); renderAll();
  }
  function setLive(cls, txt) { var s = $('live'); s.className = 'live ' + (cls || ''); s.lastChild.textContent = txt; }

  /* ---------- marcar hecha (única escritura) ---------- */
  function toggleDone(t) {
    var nowDone = !t.done, upd = {};
    upd['tasks/' + t._key + '/done'] = nowDone;
    upd['tasks/' + t._key + '/completedAt'] = nowDone ? new Date().toISOString() : null;
    if (nowDone) {
      var today = todayUTC(), last = data.meta && data.meta.lastCompletionDate, streak = (data.meta && data.meta.streak) || 0;
      if (last !== today) {
        if (last) { var diff = Math.round((new Date(today) - new Date(last)) / 86400000); streak = diff === 1 ? streak + 1 : 1; } else streak = 1;
        upd['meta/streak'] = streak; upd['meta/lastCompletionDate'] = today;
      }
    }
    var msg = nowDone ? 'Tarea completada' : 'Tarea reabierta';
    if (DEMO || !boardRef) {
      t.done = nowDone; t.completedAt = upd['tasks/' + t._key + '/completedAt'];
      if (upd['meta/streak'] != null) { data.meta.streak = upd['meta/streak']; data.meta.lastCompletionDate = upd['meta/lastCompletionDate']; }
      renderAll(); toast(msg); return;
    }
    boardRef.update(upd).then(function () { toast(msg); }).catch(function () { toast('No se guardó. Revisa el internet de la tele.'); });
  }

  /* =========================================================
     RENDER
     ========================================================= */
  function renderAll() { renderSummary(); renderFids(false); renderBoard(); renderClockInfo(); }

  function renderSummary() {
    if (!loaded) { $('sum').textContent = ''; return; }
    var p = pending();
    var over = p.filter(function (t) { var d = dueInfo(t.due); return d && d.state === 'over'; }).length;
    var today = p.filter(function (t) { var d = dueInfo(t.due); return d && d.state === 'today'; }).length;
    var streak = (data.meta && data.meta.streak) || 0;
    var parts = ['<b>' + p.length + '</b> ' + (p.length === 1 ? 'pendiente' : 'pendientes')];
    if (over) parts.push('<b class="late">' + over + '</b> ' + (over === 1 ? 'vencida' : 'vencidas'));
    if (today) parts.push('<b>' + today + '</b> para hoy');
    $('sum').innerHTML = parts.join(', ') + (streak ? '. Racha de <b>' + streak + '</b> ' + (streak === 1 ? 'día' : 'días') + '.' : '.');
  }

  function fidsList() {
    var rank = { over: 0, today: 1, soon: 2, ok: 3 };
    return pending().map(function (t) { return { t: t, d: dueInfo(t.due) }; }).sort(function (a, b) {
      var ra = a.d ? rank[a.d.state] : 4, rb = b.d ? rank[b.d.state] : 4;
      if (ra !== rb) return ra - rb;
      if (a.d && b.d && a.d.diff !== b.d.diff) return a.d.diff - b.d.diff;
      return (PRIORITY_ORDER[a.t.priority] || 1) - (PRIORITY_ORDER[b.t.priority] || 1);
    });
  }
  var ST_LBL = { over: 'VENCIDA', today: 'HOY', soon: 'PRÓXIMA', ok: 'A TIEMPO' };

  function renderFids() {
    var list = fidsList(), per = CFG.rows, pages = Math.max(1, Math.ceil(list.length / per));
    if (page >= pages) page = 0;
    var slice = list.slice(page * per, page * per + per);
    for (var r = 0; r < CFG.rows; r++) {
      var row = rowCells[r], x = slice[r], base = r * 90;
      if (!x) {
        row.code.el.style.color = ''; row.code.cells.forEach(function (c) { c.el.style.background = ''; });
        row.st.el.className = 'cells st';
        setCells(row.date.cells, '', base); setCells(row.code.cells, '', base); setCells(row.title.cells, '', base); setCells(row.st.cells, '', base);
        continue;
      }
      var cat = catOf(x.t.category), state = x.d ? x.d.state : 'none';
      row.code.cells.forEach(function (c) { c.el.style.background = cat.color; });
      row.st.el.className = 'cells st ' + state;
      setCells(row.date.cells, x.d ? x.d.label : '--', base);
      setCells(row.code.cells, catCode(cat), base);
      setCells(row.title.cells, x.t.title, base);
      setCells(row.st.cells, x.d ? ST_LBL[state] : 'SIN FECHA', base);
    }
    // leyenda de áreas
    var used = {};
    list.forEach(function (x) { used[x.t.category] = true; });
    var lg = data.categories.filter(function (c) { return used[c.id]; }).map(function (c) {
      return '<span><i style="background:' + esc(c.color) + '">' + catCode(c) + '</i>' + esc(c.name) + '</span>';
    }).join('');
    if (!loaded) lg = '<span>Conectando con tu tablero…</span>';
    else if (!list.length) lg = '<span>Sin pendientes. Todo en tiempo.</span>';
    $('legend').innerHTML = lg + (pages > 1 ? '<span class="pg">Página ' + (page + 1) + ' de ' + pages + '</span>' : '');
  }
  function nextPage(dir) {
    var pages = Math.max(1, Math.ceil(fidsList().length / CFG.rows));
    if (pages < 2) return;
    page = (page + (dir || 1) + pages) % pages; renderFids();
  }

  function renderClockInfo() {
    var list = fidsList(), el = $('cnext');
    if (!loaded) { el.textContent = ''; return; }
    if (!list.length) { el.textContent = 'Sin pendientes. Todo en tiempo.'; return; }
    var x = list[0], d = x.d;
    var when = d ? (d.state === 'over' ? '<span class="late">venció el ' + d.label.toLowerCase() + '</span>' : d.state === 'today' ? 'vence hoy' : 'vence el ' + d.label.toLowerCase()) : 'sin fecha';
    el.innerHTML = 'Siguiente: <b>' + esc(x.t.title) + '</b>, ' + when + (list.length > 1 ? ' · ' + (list.length - 1) + ' más' : '');
  }

  /* --- vista Tablero (carriles) --- */
  function laneTasks(cat) {
    return data.tasks.filter(function (t) { return t.category === cat.id; }).sort(function (a, b) {
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      var pa = PRIORITY_ORDER[a.priority] != null ? PRIORITY_ORDER[a.priority] : 1, pb = PRIORITY_ORDER[b.priority] != null ? PRIORITY_ORDER[b.priority] : 1;
      if (pa !== pb) return pa - pb;
      return (a.due || '9999').localeCompare(b.due || '9999');
    });
  }
  function laneW() { var v = Math.min(Math.max(data.categories.length, 1), 4); return (1808 - 24 * (v - 1)) / v; }

  function renderBoard() {
    var box = $('lanes');
    if (!loaded || !data.categories.length) {
      box.innerHTML = '<div class="lane" style="width:1808px"><div class="none">' + (loaded ? 'Tu tablero está vacío. Agrega tareas desde la compu o el cel.' : 'Conectando con tu tablero…') + '</div></div>';
      return;
    }
    var w = laneW();
    box.innerHTML = data.categories.map(function (cat, li) {
      var ts = laneTasks(cat), n = ts.filter(function (t) { return !t.done; }).length;
      return '<div class="lane" style="width:' + w + 'px"><div class="lane-sign"><span class="tag" style="background:' + esc(cat.color) + '">' + catCode(cat) + '</span><h2>' + esc(cat.name) + '</h2><span class="n">' + n + '</span></div>'
        + '<div class="lane-body"><div class="lane-scroll">' + (ts.length ? ts.map(slipHtml).join('') : '<div class="none">Sin pendientes</div>') + '</div></div></div>';
    }).join('');
    if (sel.id) data.categories.forEach(function (cat, li) { laneTasks(cat).forEach(function (t, ci) { if (t.id === sel.id) { sel.lane = li; sel.card = ci; } }); });
    applySelection();
  }
  function slipHtml(t) {
    var d = dueInfo(t.due), over = d && d.state === 'over' && !t.done, today = d && d.state === 'today' && !t.done;
    var subs = t.subtasks || [], sd = subs.filter(function (s) { return s.done; }).length;
    var pr = { alta: 'Prioridad alta', media: 'Prioridad media', baja: 'Prioridad baja' }[t.priority] || 'Prioridad media';
    return '<div class="slip p-' + esc(t.priority || 'media') + (t.done ? ' done' : '') + '"><div class="t">' + esc(t.title) + '</div>'
      + (t.notes ? '<div class="n2">' + esc(t.notes) + '</div>' : '')
      + '<div class="m"><span>' + pr + '</span>' + (d ? '<span class="' + (over ? 'late' : today ? 'today' : '') + '">' + (over ? 'Venció ' : today ? 'Hoy, ' : 'Vence ') + d.label.toLowerCase() + '</span>' : '')
      + (subs.length ? '<span>' + sd + ' de ' + subs.length + ' pasos</span>' : '') + (t.done ? '<span style="color:#6FC08F">Hecha</span>' : '') + '</div>'
      + (subs.length ? '<div class="bar"><div style="width:' + Math.round(sd / subs.length * 100) + '%"></div></div>' : '') + '</div>';
  }
  function curLane() { var c = data.categories[sel.lane]; return c ? laneTasks(c) : []; }
  function applySelection() {
    var lanes = document.querySelectorAll('#lanes .lane');
    if (!lanes.length || !data.categories.length) return;
    sel.lane = Math.max(0, Math.min(sel.lane, lanes.length - 1));
    var ts = curLane(); sel.card = Math.max(0, Math.min(sel.card, ts.length - 1));
    sel.id = ts[sel.card] ? ts[sel.card].id : null;
    var all = document.querySelectorAll('#lanes .slip');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('sel');
    var v = Math.min(data.categories.length, 4), w = laneW() + 24;
    var first = Math.max(0, Math.min(sel.lane - v + 1, data.categories.length - v));
    $('lanes').style.transform = 'translateX(' + (-first * w) + 'px)';
    if (!sel.active) return;
    var lane = lanes[sel.lane], card = lane.querySelectorAll('.slip')[sel.card];
    if (!card) return;
    card.classList.add('sel');
    var sc = lane.querySelector('.lane-scroll'), bh = lane.querySelector('.lane-body').clientHeight;
    var top = card.offsetTop, bottom = top + card.offsetHeight + 16, off = laneOffsets[sel.lane] || 0;
    if (top - 16 < off) off = Math.max(0, top - 16);
    if (bottom > off + bh) off = bottom - bh;
    laneOffsets[sel.lane] = off; sc.style.transform = 'translateY(' + (-off) + 'px)';
  }

  /* ---------- vistas ---------- */
  function setView(v) {
    view = v;
    var ids = { fids: 'vFids', board: 'vBoard', clock: 'vClock' };
    Object.keys(ids).forEach(function (k) { $(ids[k]).classList.toggle('on', k === v); });
    document.querySelector('.sign .clock').style.visibility = v === 'clock' ? 'hidden' : '';
    if (v === 'fids') { page = 0; renderFids(); }
    if (v === 'board') applySelection();
    reportState();
  }
  function autoNext() {
    if (night) { setView('clock'); return; }
    if (loaded && !pending().length) { setView('clock'); return; }
    setView(view === 'fids' ? 'board' : view === 'board' ? 'clock' : 'fids');
  }

  /* ---------- diálogo ---------- */
  function openDialog(o) {
    $('dK').textContent = o.k || ''; $('dT').textContent = o.title || '';
    $('dN').textContent = o.notes || ''; $('dN').style.display = o.notes ? '' : 'none';
    $('dS').innerHTML = (o.subs || []).map(function (s) { return '<li class="' + (s.done ? 'd' : '') + '">' + (s.done ? '☑ ' : '☐ ') + esc(s.text) + '</li>'; }).join('');
    $('dB').innerHTML = o.buttons.map(function (b, i) { return '<div class="btn' + (i === 0 ? ' sel' : '') + '">' + esc(b.label) + '</div>'; }).join('');
    dlg = { buttons: o.buttons, index: 0 }; $('dlg').classList.add('on');
  }
  function closeDialog() { dlg = null; $('dlg').classList.remove('on'); }
  function dialogMove(d) {
    dlg.index = (dlg.index + d + dlg.buttons.length) % dlg.buttons.length;
    var bs = $('dB').children; for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('sel', i === dlg.index);
  }
  function openTask() {
    var t = curLane()[sel.card]; if (!t) return;
    var d = dueInfo(t.due), c = catOf(t.category);
    openDialog({
      k: c.name + (d ? (d.state === 'over' ? ', venció el ' : ', vence el ') + d.label.toLowerCase() : ''),
      title: t.title, notes: t.notes, subs: t.subtasks,
      buttons: [{ label: t.done ? 'Reabrir tarea' : 'Marcar como hecha', run: function () { toggleDone(t); } }, { label: 'Cerrar', run: function () {} }]
    });
  }
  function askExit() {
    openDialog({ k: 'Panel Draguz', title: '¿Salir del tablero?', buttons: [
      { label: 'Quedarme', run: function () {} },
      { label: 'Salir', run: function () { try { if (window.PalmSystem && window.PalmSystem.platformBack) { window.PalmSystem.platformBack(); return; } } catch (e) {} window.close(); } }
    ] });
  }
  var toastT;
  function toast(m) { var t = $('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 2600); }
  var keysT;
  function showKeys() { $('keys').classList.add('on'); clearTimeout(keysT); keysT = setTimeout(function () { $('keys').classList.remove('on'); }, 7000); }

  /* ---------- control remoto ---------- */
  document.addEventListener('keydown', function (e) {
    var k = e.keyCode, h = true;
    lastKey = Date.now(); showKeys(); applyNight();
    if ($('aviso').classList.contains('on') && (k === KEY.OK || k === KEY.BACK || k === KEY.ESC || k === KEY.BKSP)) { hideAviso(true); e.preventDefault(); return; }
    if (dlg) {
      if (k === KEY.LEFT || k === KEY.UP) dialogMove(-1);
      else if (k === KEY.RIGHT || k === KEY.DOWN) dialogMove(1);
      else if (k === KEY.OK) { var b = dlg.buttons[dlg.index]; closeDialog(); b.run(); }
      else if (k === KEY.BACK || k === KEY.ESC || k === KEY.BKSP) closeDialog();
      else h = false;
      if (h) e.preventDefault(); return;
    }
    if (k === KEY.BLUE || k === 66) setView(view === 'fids' ? 'board' : view === 'board' ? 'clock' : 'fids');
    else if (k === 49 || k === 50 || k === 51) setView(k === 49 ? 'fids' : k === 50 ? 'board' : 'clock');
    else if (k === KEY.YELLOW || k === 89) { auto = !auto; $('autoLbl').textContent = 'Cambio automático: ' + (auto ? 'sí' : 'no'); toast(auto ? 'Cambio automático activado' : 'Cambio automático apagado'); }
    else if (k === KEY.RED || k === 82) location.reload();
    else if (k === KEY.BACK || k === KEY.ESC || k === KEY.BKSP) { if (sel.active) { sel.active = false; applySelection(); } else askExit(); }
    else if (view === 'fids') {
      if (k === KEY.UP || k === KEY.LEFT) nextPage(-1);
      else if (k === KEY.DOWN || k === KEY.RIGHT) nextPage(1);
      else if (k === KEY.OK) { setView('board'); sel.active = true; applySelection(); }
      else h = false;
    } else if (view === 'clock') {
      if (k === KEY.OK || k === KEY.LEFT || k === KEY.RIGHT || k === KEY.UP || k === KEY.DOWN) setView('fids'); else h = false;
    } else {
      if (!sel.active && (k >= 37 && k <= 40 || k === KEY.OK)) { sel.active = true; applySelection(); }
      else if (k === KEY.LEFT) { sel.lane--; sel.card = 0; applySelection(); }
      else if (k === KEY.RIGHT) { sel.lane++; sel.card = 0; applySelection(); }
      else if (k === KEY.UP) { sel.card--; applySelection(); }
      else if (k === KEY.DOWN) { sel.card++; applySelection(); }
      else if (k === KEY.OK) openTask();
      else h = false;
    }
    if (h) e.preventDefault();
  });

  /* =========================================================
     MODO PROTECTOR
     ========================================================= */
  function isNightHour() {
    if (FORCE_NIGHT) return true;
    if (FORCE_DAY) return false;
    var h = new Date().getHours();
    return CFG.nightFrom <= CFG.nightTo ? (h >= CFG.nightFrom && h < CFG.nightTo) : (h >= CFG.nightFrom || h < CFG.nightTo);
  }
  function applyNight() {
    var idle = Date.now() - lastKey > CFG.idleMs;
    // auto: de noche y sin usar el control · on: forzado desde el cel · off: nunca
    var n = nightMode === 'on' ? true : nightMode === 'off' ? false : (isNightHour() && idle);
    if (n !== night) { night = n; if (night && !dlg) setView('clock'); reportState(); }
    $('night').style.opacity = night ? CFG.nightDim : 0;
  }
  // mover todo unos pixeles para que no se marque la pantalla
  setInterval(function () {
    var p = CFG.shiftPx, x = Math.round((Math.random() * 2 - 1) * p), y = Math.round((Math.random() * 2 - 1) * p);
    $('shift').style.transform = 'translate(' + x + 'px,' + y + 'px)';
  }, CFG.shiftMs);

  // bloquear el protector de pantalla de la tele
  var ssBridge = null;
  function blockScreenSaver() {
    if (typeof window.PalmServiceBridge !== 'function') return;
    try {
      ssBridge = new window.PalmServiceBridge();
      ssBridge.onservicecallback = function (msg) {
        try {
          var r = JSON.parse(msg);
          if (r && r.timestamp != null) {
            var b = new window.PalmServiceBridge();
            b.call('luna://com.webos.service.tvpower/power/responseScreenSaverRequest', JSON.stringify({ clientName: APP_ID, ack: false, timestamp: r.timestamp }));
          }
        } catch (e) {}
      };
      ssBridge.call('luna://com.webos.service.tvpower/power/registerScreenSaverRequest', JSON.stringify({ subscribe: true, clientName: APP_ID }));
    } catch (e) {}
  }


  /* =========================================================
     CONTROL DESDE EL CEL  (nodo 'panel-tv-v1')
     ========================================================= */
  var serverOffset = 0;
  function serverNow() { return Date.now() + serverOffset; }
  function startRemote(db) {
    remoteRef = db.ref('panel-tv-v1');
    db.ref('.info/serverTimeOffset').on('value', function (s) { serverOffset = s.val() || 0; });
    var firstCmd = true, lastCmd = null;
    remoteRef.child('cmd').on('value', function (s) {
      var c = s.val();
      if (firstCmd) { firstCmd = false; lastCmd = c && c.id; return; }   // no repetir el último comando al abrir
      if (!c || !c.id || c.id === lastCmd) return;
      lastCmd = c.id; runCommand(c);
    });
    remoteRef.child('aviso').on('value', function (s) {
      var a = s.val();
      if (!a || !a.text || a.cleared) { hideAviso(false); return; }
      var end = a.secs ? (a.at || 0) + a.secs * 1000 : 0;
      if (end && end < serverNow()) { hideAviso(false); return; }
      showAviso(a, end);
    });
    setInterval(reportState, 60000);
  }
  function runCommand(c) {
    lastKey = Date.now();           // un comando cuenta como "usar el control"
    applyNight();
    if (c.type === 'view' && /^(fids|board|clock)$/.test(c.arg)) setView(c.arg);
    else if (c.type === 'auto') { auto = c.arg === 'on'; $('autoLbl').textContent = 'Cambio automático: ' + (auto ? 'sí' : 'no'); toast(auto ? 'Cambio automático activado' : 'Cambio automático apagado'); reportState(); }
    else if (c.type === 'night' && /^(auto|on|off)$/.test(c.arg)) { nightMode = c.arg; applyNight(); reportState(); toast(nightMode === 'on' ? 'Modo noche encendido' : nightMode === 'off' ? 'Modo noche apagado' : 'Modo noche automático'); }
    else if (c.type === 'page') { if (view !== 'fids') setView('fids'); nextPage(c.arg === 'prev' ? -1 : 1); }
    else if (c.type === 'reload') location.reload();
    else if (c.type === 'ping') toast('Conectado con tu cel');
  }
  function showAviso(a, end) {
    if (a.id === avisoId && $('aviso').classList.contains('on')) return;
    avisoId = a.id;
    var col = a.color === 'red' ? 'red' : a.color === 'green' ? 'green' : '';
    $('avTop').className = 'av-top ' + col;
    $('aviso').className = 'on' + (col ? ' av-' + col : '');
    $('avText').textContent = a.text;
    $('avFrom').textContent = a.from ? 'De ' + a.from : '';
    var bar = $('avBar');
    clearTimeout(avisoTimer);
    bar.style.transition = 'none'; bar.style.width = '100%'; void bar.offsetWidth;
    if (end) {
      var left = Math.max(0, end - serverNow());
      bar.style.transition = 'width ' + left + 'ms linear'; bar.style.width = '0';
      avisoTimer = setTimeout(function () { hideAviso(false); }, left);
      $('avHint').textContent = 'OK para quitar';
    } else $('avHint').textContent = 'Se queda hasta que lo quites · OK para quitar';
    if (night) { $('night').style.opacity = 0; }
  }
  function hideAviso(byUser) {
    clearTimeout(avisoTimer);
    $('aviso').className = '';
    if (night) $('night').style.opacity = CFG.nightDim;
    if (byUser && remoteRef) remoteRef.child('aviso').update({ cleared: true }).catch(function () {});
  }
  function reportState() {
    if (!remoteRef) return;
    remoteRef.child('estado').set({
      view: view, auto: auto, night: night, nightMode: nightMode, version: VERSION,
      pending: loaded ? pending().length : null, lastSeen: firebase.database.ServerValue.TIMESTAMP
    }).catch(function () {});
  }

  /* =========================================================
     AUTO-ACTUALIZACIÓN
     ========================================================= */
  function checkUpdate() {
    var base = window.PANEL_REMOTE;
    if (!base || !window.fetch) return;
    fetch(base + 'version.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.v || j.v === VERSION) return;
      var go = function () {
        if (Date.now() - lastKey > CFG.idleMs && !dlg) location.reload();
        else setTimeout(go, 30000);
      };
      go();
    }).catch(function () {});
  }
  setInterval(checkUpdate, 20 * 60000);
  setTimeout(checkUpdate, 15000);

  /* ---------- temporizadores ---------- */
  var lastMin = -1, lastDay = localDay(new Date());
  setInterval(function () {
    var n = new Date();
    if (n.getMinutes() !== lastMin) { lastMin = n.getMinutes(); tick(); applyNight(); }
    var d = localDay(n); if (d !== lastDay) { lastDay = d; renderAll(); }
  }, 1000);
  setInterval(function () { if (view === 'fids' && !dlg) nextPage(1); }, CFG.pageMs);
  setInterval(function () {
    var idle = Date.now() - lastKey > CFG.idleMs;
    if (idle && sel.active && !dlg) { sel.active = false; applySelection(); }
    if (idle && !dlg && (auto || night)) autoNext();
  }, CFG.viewMs);
  // en la vista Tablero, sin control, recorre las columnas largas poco a poco
  setInterval(function () {
    if (sel.active || view !== 'board') return;
    var lanes = document.querySelectorAll('#lanes .lane');
    for (var i = 0; i < lanes.length; i++) {
      var sc = lanes[i].querySelector('.lane-scroll'), body = lanes[i].querySelector('.lane-body');
      if (!sc || !body) continue;
      var max = sc.scrollHeight - body.clientHeight;
      if (max <= 0) { sc.style.transform = ''; laneOffsets[i] = 0; continue; }
      var cur = laneOffsets[i] || 0, nx = cur >= max ? 0 : Math.min(max, cur + Math.round(body.clientHeight * 0.7));
      laneOffsets[i] = nx; sc.style.transform = 'translateY(' + (-nx) + 'px)';
    }
  }, 8000);

  /* ---------- arranque ---------- */
  fit();
  clk = makeCells($('clk'), 5); clkAp = makeCells($('clkAp'), 2);
  bclk = makeCells($('bclk'), 5); bclkAp = makeCells($('bclkAp'), 2);
  buildRows();
  tick();
  applyNight();
  setView(night ? 'clock' : 'fids');
  renderAll();
  blockScreenSaver();
  if (DEMO) { startDemo(); window.panelDemo = { aviso: function (a) { showAviso(a, a.secs ? Date.now() + a.secs * 1000 : 0); }, cmd: runCommand }; }
  else if (typeof firebase === 'undefined') setLive('err', 'Falta Firebase');
  else { try { startFirebase(); } catch (e) { setLive('err', 'Error de Firebase'); } }
})();
