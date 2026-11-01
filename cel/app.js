/* Panel Draguz — app del cel.
   Tareas: lee y escribe en 'draguz-board-v1' (el mismo tablero de TAREAS-PAULO). Solo agrega tareas y las marca/desmarca;
           nunca reemplaza el tablero completo.
   Tele:   manda comandos y avisos a 'panel-tv-v1'; la tele reporta su estado ahí mismo. */
(function () {
  'use strict';
  var firebaseConfig = {
    apiKey: 'AIzaSyAnQ7e2iQ-cKyUB3xOoL4Yim0FWy1GqvME',
    authDomain: 'tareas-paulo.firebaseapp.com',
    databaseURL: 'https://tareas-paulo-default-rtdb.firebaseio.com',
    projectId: 'tareas-paulo'
  };
  var DEMO = /[?&]demo/.test(location.search);
  var PRI = { alta: 0, media: 1, baja: 2 };

  function $(id) { return document.getElementById(id); }
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function uid(p) { return p + '_' + Date.now() + '_' + Math.floor(Math.random() * 1000); }
  function todayUTC() { return new Date().toISOString().slice(0, 10); }
  function localDay(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  var board = { tasks: [], categories: [], meta: {} }, loaded = false;
  var tvState = null, aviso = null, serverOffset = 0;
  var db = null, boardRef = null, tvRef = null;

  /* ---------- tabs ---------- */
  var tabs = document.querySelectorAll('nav button');
  for (var i = 0; i < tabs.length; i++) tabs[i].addEventListener('click', function () {
    var id = this.getAttribute('data-tab');
    for (var j = 0; j < tabs.length; j++) tabs[j].classList.toggle('on', tabs[j] === this);
    var secs = document.querySelectorAll('.tab');
    for (var k = 0; k < secs.length; k++) secs[k].classList.toggle('on', secs[k].id === id);
    store('panel-tab', id); window.scrollTo(0, 0);
  });
  var lastTab = store('panel-tab');
  if (lastTab && $(lastTab)) document.querySelector('nav button[data-tab="' + lastTab + '"]').click();

  /* ---------- toast con deshacer ---------- */
  var toastT;
  function toast(msg, undo) {
    $('toastTxt').textContent = msg;
    var u = $('toastUndo'); u.style.display = undo ? '' : 'none'; u.onclick = function () { $('toast').classList.remove('on'); undo(); };
    $('toast').classList.add('on'); clearTimeout(toastT);
    toastT = setTimeout(function () { $('toast').classList.remove('on'); }, undo ? 5000 : 2400);
  }

  /* ---------- fechas ---------- */
  function due(dateStr) {
    if (!dateStr) return null;
    var d = new Date(dateStr + 'T00:00:00'); if (isNaN(d)) return null;
    var t = new Date(); t.setHours(0, 0, 0, 0);
    var diff = Math.round((d - t) / 86400000);
    return { diff: diff, label: d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }).replace('.', ''), state: diff < 0 ? 'over' : diff === 0 ? 'today' : diff <= 2 ? 'soon' : 'ok' };
  }
  function catOf(id) { for (var i = 0; i < board.categories.length; i++) if (board.categories[i].id === id) return board.categories[i]; return { name: 'Sin área', color: '#5E6371' }; }
  function catCode(cat) {
    var w = String(cat.name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    var c = w.length >= 3 ? w[0][0] + w[1][0] + w[2][0] : w.length === 2 ? w[0][0] + w[1].slice(0, 2) : (w[0] || '---').slice(0, 3);
    return (c + '---').slice(0, 3);
  }

  /* =========================================================
     TAREAS
     ========================================================= */
  function renderCats() {
    var sel = $('fCat'), cur = sel.value || store('panel-cat');
    sel.innerHTML = board.categories.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('');
    if (cur && board.categories.some(function (c) { return c.id === cur; })) sel.value = cur;
  }
  function renderList() {
    var box = $('list');
    if (!loaded) return;
    var rank = { over: 0, today: 1, soon: 2, ok: 3 };
    var pend = board.tasks.filter(function (t) { return !t.done; }).map(function (t) { return { t: t, d: due(t.due) }; })
      .sort(function (a, b) {
        var ra = a.d ? rank[a.d.state] : 4, rb = b.d ? rank[b.d.state] : 4;
        if (ra !== rb) return ra - rb;
        if (a.d && b.d && a.d.diff !== b.d.diff) return a.d.diff - b.d.diff;
        return (PRI[a.t.priority] || 1) - (PRI[b.t.priority] || 1);
      });
    var today = localDay(new Date());
    var doneToday = board.tasks.filter(function (t) { return t.done && t.completedAt && localDay(new Date(t.completedAt)) === today; });
    var over = pend.filter(function (x) { return x.d && x.d.state === 'over'; }).length;
    var b = $('badge'); b.style.display = over ? '' : 'none'; b.textContent = over;

    var html = '';
    if (!pend.length) html += '<div class="empty">No tienes pendientes. Agrega uno arriba.</div>';
    else html += '<div class="group">' + pend.length + (pend.length === 1 ? ' pendiente' : ' pendientes') + '</div>' + pend.map(function (x) { return itemHtml(x.t, x.d); }).join('');
    if (doneToday.length) html += '<details><summary>Hechas hoy (' + doneToday.length + ')</summary>' + doneToday.map(function (t) { return itemHtml(t, due(t.due)); }).join('') + '</details>';
    box.innerHTML = html;
    var btns = box.querySelectorAll('.chk');
    for (var i = 0; i < btns.length; i++) btns[i].addEventListener('click', onCheck);
  }
  function itemHtml(t, d) {
    var c = catOf(t.category), when = '';
    if (d) when = d.state === 'over' ? '<span class="late">Venció ' + d.label + '</span>' : d.state === 'today' ? '<span class="today">Hoy</span>' : 'Vence ' + d.label;
    var pr = { alta: 'prioridad alta', media: 'prioridad media', baja: 'prioridad baja' }[t.priority] || 'prioridad media';
    return '<div class="item' + (t.done ? ' done' : '') + '"><span class="code" style="background:' + esc(c.color) + '">' + catCode(c) + '</span>'
      + '<div class="it"><b>' + esc(t.title) + '</b><small>' + (when ? when + ', ' : '') + pr + '</small></div>'
      + '<button class="chk" data-key="' + esc(t._key) + '" aria-label="' + (t.done ? 'Reabrir' : 'Marcar como hecha') + '"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button></div>';
  }
  function findByKey(k) { for (var i = 0; i < board.tasks.length; i++) if (String(board.tasks[i]._key) === String(k)) return board.tasks[i]; return null; }

  function onCheck() {
    var t = findByKey(this.getAttribute('data-key')); if (!t) return;
    var was = !!t.done;
    setDone(t, !was);
    toast(was ? 'Tarea reabierta' : 'Tarea completada', function () { var t2 = findByKey(t._key); if (t2) setDone(t2, was); });
  }
  function setDone(t, done) {
    var upd = {};
    upd['tasks/' + t._key + '/done'] = done;
    upd['tasks/' + t._key + '/completedAt'] = done ? new Date().toISOString() : null;
    if (done) {
      var today = todayUTC(), last = board.meta && board.meta.lastCompletionDate, streak = (board.meta && board.meta.streak) || 0;
      if (last !== today) {
        if (last) { var diff = Math.round((new Date(today) - new Date(last)) / 86400000); streak = diff === 1 ? streak + 1 : 1; } else streak = 1;
        upd['meta/streak'] = streak; upd['meta/lastCompletionDate'] = today;
      }
    }
    if (DEMO) { t.done = done; t.completedAt = upd['tasks/' + t._key + '/completedAt']; renderList(); return; }
    boardRef.update(upd).catch(function () { toast('No se guardó. Revisa tu internet.'); });
  }

  $('btnAdd').addEventListener('click', function () {
    var title = $('fTitle').value.trim();
    if (!title) { $('fTitle').focus(); return; }
    var task = { id: uid('task'), done: false, completedAt: null, createdAt: Date.now(), title: title,
      category: $('fCat').value || (board.categories[0] && board.categories[0].id) || '', priority: $('fPri').value,
      due: $('fDue').value || null, notes: '', subtasks: [] };
    store('panel-cat', $('fCat').value);
    var done = function () { $('fTitle').value = ''; $('fDue').value = ''; toast('Tarea agregada'); };
    if (DEMO) { task._key = String(board.tasks.length); board.tasks.push(task); renderList(); done(); return; }
    this.disabled = true; var btn = this;
    // agrega al final sin tocar las demás tareas
    boardRef.child('tasks').transaction(function (cur) {
      if (cur == null) return [task];
      if (Array.isArray(cur)) { cur.push(task); return cur; }
      var max = -1; Object.keys(cur).forEach(function (k) { var n = parseInt(k, 10); if (!isNaN(n) && n > max) max = n; });
      cur[String(max + 1)] = task; return cur;
    }).then(function () { done(); }).catch(function () { toast('No se pudo agregar. Revisa tu internet.'); })
      .then(function () { btn.disabled = false; });
  });
  $('fTitle').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('btnAdd').click(); });

  /* =========================================================
     TELE
     ========================================================= */
  function sendCmd(type, arg) {
    if (DEMO) { toast('Demo: ' + type + ' ' + (arg || '')); if (type === 'view') { tvState.view = arg; renderTv(); } return; }
    tvRef.child('cmd').set({ id: uid('c'), type: type, arg: arg || null, at: firebase.database.ServerValue.TIMESTAMP })
      .then(function () { if (type !== 'view') toast('Enviado a la tele'); })
      .catch(function () { toast('No se pudo mandar. Revisa tu internet.'); });
  }
  function bindAll(sel, fn) { var els = document.querySelectorAll(sel); for (var i = 0; i < els.length; i++) els[i].addEventListener('click', fn); }
  bindAll('.vbtn', function () { var v = this.getAttribute('data-view'); sendCmd('view', v); if (tvState) { tvState.view = v; renderTv(); } });
  bindAll('.pager button', function () { sendCmd('page', this.getAttribute('data-page')); });
  bindAll('#segNight button', function () { var n = this.getAttribute('data-n'); sendCmd('night', n); if (tvState) { tvState.nightMode = n; renderTv(); } });
  $('tgAuto').addEventListener('click', function () { var on = !(tvState && tvState.auto); sendCmd('auto', on ? 'on' : 'off'); if (tvState) { tvState.auto = on; renderTv(); } });
  $('btnPing').addEventListener('click', function () { sendCmd('ping'); });
  $('btnReload').addEventListener('click', function () { sendCmd('reload'); });

  function tvOnline() { return tvState && tvState.lastSeen && (Date.now() + serverOffset - tvState.lastSeen) < 150000; }
  function ago(ms) {
    var m = Math.round(ms / 60000);
    if (m < 1) return 'hace un momento'; if (m < 60) return 'hace ' + m + ' min';
    var h = Math.round(m / 60); if (h < 24) return 'hace ' + h + (h === 1 ? ' hora' : ' horas');
    var d = Math.round(h / 24); return 'hace ' + d + (d === 1 ? ' día' : ' días');
  }
  var VNAME = { fids: 'Salidas', board: 'Tablero', clock: 'Reloj' };
  function renderTv() {
    var on = tvOnline(), pill = $('tv');
    pill.className = 'tv' + (on ? ' on' : '');
    $('tvTxt').textContent = !tvState ? 'Tele sin conectar' : on ? 'Tele: ' + (VNAME[tvState.view] || 'en línea') + (tvState.night ? ', noche' : '') : 'Tele apagada';
    var vb = document.querySelectorAll('.vbtn');
    for (var i = 0; i < vb.length; i++) vb[i].classList.toggle('on', !!tvState && vb[i].getAttribute('data-view') === tvState.view);
    $('tgAuto').classList.toggle('on', !tvState || tvState.auto !== false);
    var nm = (tvState && tvState.nightMode) || 'auto', sb = document.querySelectorAll('#segNight button');
    for (var j = 0; j < sb.length; j++) sb[j].classList.toggle('on', sb[j].getAttribute('data-n') === nm);
    var info = '';
    if (!tvState) info = 'La tele todavía no se ha reportado. Abre el Panel Draguz en la tele.';
    else if (!on) info = 'La tele se reportó por última vez ' + ago(Date.now() + serverOffset - tvState.lastSeen) + '. Lo que mandes se aplica en cuanto abras el Panel en la tele.';
    else info = 'Conectada. Versión ' + esc(tvState.version || '') + '.';
    $('tvInfo').textContent = info;
  }
  setInterval(renderTv, 30000);

  /* =========================================================
     AVISOS
     ========================================================= */
  var DURS = [{ s: 30, l: '30 s' }, { s: 60, l: '1 min' }, { s: 300, l: '5 min' }, { s: 900, l: '15 min' }, { s: 0, l: 'Hasta quitarlo' }];
  var COLORS = [{ c: '', l: 'Aviso', dot: '#FFC52E' }, { c: 'red', l: 'Urgente', dot: '#D9483B' }, { c: 'green', l: 'Buena noticia', dot: '#4FAE74' }];
  var PRESETS = ['La comida está lista', 'Ya llegué', 'Estoy en llamada, no hagan ruido', 'Salgo en 10 minutos', '¿Alguien necesita algo de la tienda?'];
  var avDur = 60, avColor = '';
  $('durs').innerHTML = DURS.map(function (d) { return '<button class="chip' + (d.s === avDur ? ' on' : '') + '" data-s="' + d.s + '">' + d.l + '</button>'; }).join('');
  $('colors').innerHTML = COLORS.map(function (c) { return '<button class="chip' + (c.c === avColor ? ' on' : '') + '" data-c="' + c.c + '"><span class="dot" style="background:' + c.dot + '"></span>' + c.l + '</button>'; }).join('');
  $('presets').innerHTML = PRESETS.map(function (p) { return '<button class="chip" data-p="' + esc(p) + '">' + esc(p) + '</button>'; }).join('');
  bindAll('#durs .chip', function () { avDur = +this.getAttribute('data-s'); markOn('#durs .chip', this); });
  bindAll('#colors .chip', function () { avColor = this.getAttribute('data-c'); markOn('#colors .chip', this); preview(); });
  bindAll('#presets .chip', function () { $('avText').value = this.getAttribute('data-p'); preview(); });
  function markOn(sel, el) { var els = document.querySelectorAll(sel); for (var i = 0; i < els.length; i++) els[i].classList.toggle('on', els[i] === el); }
  $('avFrom').value = store('panel-from') || '';
  $('avText').addEventListener('input', preview);
  $('avFrom').addEventListener('input', function () { store('panel-from', this.value); preview(); });
  function preview() {
    var t = $('avText').value.trim();
    $('avCount').textContent = $('avText').value.length + ' / 90';
    $('pvTxt').textContent = t || '…';
    $('pvTop').className = 'top ' + avColor;
    $('pvKind').textContent = 'Aviso';
    $('pvFrom').textContent = $('avFrom').value.trim() ? 'De ' + $('avFrom').value.trim() : '';
    $('btnSend').disabled = !t;
  }
  $('btnSend').addEventListener('click', function () {
    var t = $('avText').value.trim(); if (!t) return;
    var a = { id: uid('a'), text: t, color: avColor, secs: avDur, from: $('avFrom').value.trim() || null, cleared: false };
    if (DEMO) { aviso = a; a.at = Date.now(); renderAviso(); toast('Demo: aviso enviado'); return; }
    a.at = firebase.database.ServerValue.TIMESTAMP;
    tvRef.child('aviso').set(a).then(function () { $('avText').value = ''; preview(); toast(tvOnline() ? 'Aviso en la tele' : 'Aviso enviado. Saldrá cuando la tele esté prendida en el Panel.'); })
      .catch(function () { toast('No se pudo mandar. Revisa tu internet.'); });
  });
  $('btnClear').addEventListener('click', function () {
    if (DEMO) { aviso = null; renderAviso(); return; }
    tvRef.child('aviso').update({ cleared: true }).then(function () { toast('Aviso quitado'); });
  });
  function avisoActive() {
    if (!aviso || !aviso.text || aviso.cleared) return false;
    if (!aviso.secs) return true;
    return (aviso.at || 0) + aviso.secs * 1000 > Date.now() + serverOffset;
  }
  function renderAviso() {
    var on = avisoActive();
    $('avActive').style.display = on ? '' : 'none';
    if (on) $('avActiveTxt').textContent = '“' + aviso.text + '”' + (aviso.secs ? '' : ', hasta que lo quites');
  }
  setInterval(renderAviso, 5000);
  preview();

  /* =========================================================
     ARRANQUE
     ========================================================= */
  function startFirebase() {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    boardRef = db.ref('draguz-board-v1');
    tvRef = db.ref('panel-tv-v1');
    db.ref('.info/serverTimeOffset').on('value', function (s) { serverOffset = s.val() || 0; });
    db.ref('.info/connected').on('value', function (s) { $('off').classList.toggle('on', s.val() === false && loaded); });
    boardRef.on('value', function (snap) {
      var tasks = [], cats = [];
      snap.child('tasks').forEach(function (c) { var t = c.val(); if (t && typeof t === 'object') { t._key = c.key; tasks.push(t); } });
      snap.child('categories').forEach(function (c) { var v = c.val(); if (v && v.id) cats.push(v); });
      board = { tasks: tasks, categories: cats, meta: snap.child('meta').val() || {} };
      loaded = true; renderCats(); renderList();
    }, function () { $('list').innerHTML = '<div class="empty">No tengo permiso para leer tu tablero. Revisa las reglas de Firebase.</div>'; });
    tvRef.child('estado').on('value', function (s) { tvState = s.val(); renderTv(); });
    tvRef.child('aviso').on('value', function (s) { aviso = s.val(); renderAviso(); });
  }
  function startDemo() {
    var d = function (n) { var x = new Date(); x.setDate(x.getDate() + n); return localDay(x); };
    board = { categories: [{ id: 'c1', name: 'Del Bravo · Trabajo', color: '#5B7DB1' }, { id: 'c2', name: 'Draguz Shop', color: '#B8892A' }, { id: 'c3', name: 'Personal / Fitness', color: '#4C8B6B' }],
      meta: { streak: 4 }, tasks: [
        { title: 'Revisar previo de importación A1', category: 'c1', priority: 'alta', due: d(-1) },
        { title: 'Rectificar pedimento V1', category: 'c1', priority: 'media', due: d(0) },
        { title: 'Cotizar DTF con Eurocoton', category: 'c2', priority: 'alta', due: d(1) },
        { title: 'Pagar internet', category: 'c3', priority: 'alta', due: d(2) },
        { title: 'Grabar reel UGC de playera oversize', category: 'c2', priority: 'baja', due: null },
        { title: 'Comprar película DTF', category: 'c2', priority: 'media', done: true, completedAt: new Date().toISOString() }] };
    board.tasks.forEach(function (t, i) { t._key = String(i); t.id = 't' + i; });
    tvState = { view: 'fids', auto: true, night: false, nightMode: 'auto', version: '1.2.0', lastSeen: Date.now() };
    loaded = true; renderCats(); renderList(); renderTv(); renderAviso();
  }
  if (DEMO) startDemo(); else startFirebase();

  /* ---------- instalar como app ---------- */
  var deferred = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; $('install').classList.add('on'); });
  $('btnInstall').addEventListener('click', function () { if (!deferred) return; deferred.prompt(); deferred.userChoice.then(function () { deferred = null; $('install').classList.remove('on'); }); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
})();
