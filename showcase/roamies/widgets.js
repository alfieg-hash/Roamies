// Widgets: small cards the user asked to keep on the desktop (a clock, a timer, a stopwatch, a note, a to-do list,
// their reminders, a table, bars, a timeline, values read from the web). The sidecar keeps them (widgets.mjs) and
// sends the whole list after every change; this page only shows it. Each is real type in the research card's look
// (pixel frame, Martian Mono), dragged by its top bar and closed with its x. Model text goes in as textContent only.
// The overlay is click-through, so the host asks Roamie.widgetHit(x, y) whether the cursor is over one.
// API: Roamie.widgets.set(list) .send (set by host.js) .count; Roamie.widgetHit(x, y); Roamie.widgetRects()
(() => {
  const R = window.Roamie;
  if (!R || typeof document === 'undefined') return;
  const TONES = { accent: '#78ffe2', teal: '#78ffe2', amber: '#ffcf5c', coral: '#ff8a7a', lilac: '#b9a4ff', sky: '#7cc8ff', lime: '#b6f36b', red: '#ff6b6b', white: '#e8fffa' };
  const css = `
.rw { --ink: #e8fffa; --ink-2: #b4d8d1; --ink-3: #8ab8b0; --accent: #78ffe2; --rule: #12302e; --s: 2px; --ease: cubic-bezier(.2, .8, .2, 1);
  --notch: polygon(
    calc(var(--s) * 2) 0, calc(100% - var(--s) * 2) 0, calc(100% - var(--s) * 2) var(--s), calc(100% - var(--s)) var(--s),
    calc(100% - var(--s)) calc(var(--s) * 2), 100% calc(var(--s) * 2), 100% calc(100% - var(--s) * 2),
    calc(100% - var(--s)) calc(100% - var(--s) * 2), calc(100% - var(--s)) calc(100% - var(--s)),
    calc(100% - var(--s) * 2) calc(100% - var(--s)), calc(100% - var(--s) * 2) 100%, calc(var(--s) * 2) 100%,
    calc(var(--s) * 2) calc(100% - var(--s)), var(--s) calc(100% - var(--s)), var(--s) calc(100% - var(--s) * 2),
    0 calc(100% - var(--s) * 2), 0 calc(var(--s) * 2), var(--s) calc(var(--s) * 2), var(--s) var(--s), calc(var(--s) * 2) var(--s));
  position: fixed; z-index: 4; width: 240px; box-sizing: border-box; padding: 2px; background: var(--accent); clip-path: var(--notch);
  font: 400 12px/1.55 "Martian Mono", ui-monospace, Menlo, monospace; color: var(--ink); pointer-events: auto; cursor: default; user-select: none;
  opacity: 0; transform: scale(.96); transform-origin: top left; transition: opacity .16s var(--ease), transform .16s var(--ease); }
.rw.on { opacity: .97; transform: none; }
.rw.drag { transition: none; opacity: 1; }
.rw.wide { width: 300px; }
.rw.wider { width: 380px; }
.rw-in { background: rgba(5, 18, 20, .97); clip-path: var(--notch); }
.rw-head { display: flex; align-items: center; gap: 8px; padding: 6px 4px 6px 12px; border-bottom: 1px solid var(--rule); cursor: grab; touch-action: none; }
.rw.drag .rw-head { cursor: grabbing; }
.rw-dot { width: 6px; height: 6px; background: var(--accent); flex: none; }
.rw-title { flex: 1; font-size: 10px; line-height: 1.3; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rw-count { font-size: 10px; color: var(--ink-3); flex: none; }
.rw-x { all: unset; width: 24px; height: 22px; display: grid; place-items: center; color: var(--ink-3); cursor: pointer; flex: none; }
.rw-x:hover { color: var(--ink); background: #0d2a2a; }
.rw-body { padding: 10px 14px 12px; overflow-wrap: anywhere; }
.rw-big { font: 600 30px/1.15 "Martian Mono", ui-monospace, monospace; letter-spacing: -.01em; color: var(--accent); font-variant-numeric: tabular-nums; white-space: nowrap; }
.rw-big small { font-size: 13px; font-weight: 500; letter-spacing: .02em; margin-left: 6px; color: var(--ink-2); }
.rw-sub { font-size: 10.5px; color: var(--ink-3); margin-top: 4px; }
.rw-done .rw-big { animation: rw-blink 1s steps(2, jump-none) infinite; }
.rw-track { height: 4px; background: var(--rule); margin-top: 8px; }
.rw-fill { height: 100%; background: var(--accent); width: 0; }
.rw-row { display: flex; gap: 6px; margin-top: 10px; }
.rw-btn { all: unset; box-sizing: border-box; padding: 3px 10px; font: 600 10px/1.5 "Martian Mono", ui-monospace, monospace; letter-spacing: .04em; text-transform: uppercase;
  color: var(--ink); border: 1px solid var(--accent); cursor: pointer; }
.rw-btn:hover { background: color-mix(in srgb, var(--accent) 18%, transparent); }
.rw-btn.main { background: var(--accent); color: #032722; }
.rw-btn.main:hover { filter: brightness(1.15); }
.rw-text { margin: 0 0 6px; color: var(--ink); white-space: pre-wrap; }
.rw-list { margin: 0; padding: 0; list-style: none; }
.rw-list li { position: relative; padding-left: 14px; margin: 0 0 4px; color: var(--ink-2); }
.rw-list li::before { content: ""; position: absolute; left: 1px; top: .62em; width: 5px; height: 5px; background: var(--accent); }
.rw-item { all: unset; box-sizing: border-box; display: flex; gap: 9px; align-items: flex-start; width: 100%; padding: 3px 0; cursor: pointer; color: var(--ink); }
.rw-item:hover { color: #ffffff; }
.rw-box { flex: none; width: 11px; height: 11px; margin-top: 3px; border: 1.5px solid var(--accent); display: grid; place-items: center; font: 800 10px/1 "Martian Mono", monospace; color: #032722; }
.rw-item.done .rw-box { background: var(--accent); }
.rw-item.done .rw-label { color: var(--ink-3); text-decoration: line-through; }
.rw-label { flex: 1; min-width: 0; }
.rw-when { flex: none; font-size: 10px; color: var(--ink-3); margin-top: 2px; }
.rw-item.late .rw-when { color: #ff8a7a; }
.rw-h { margin: 8px 0 4px; font: 600 10px/1.3 "Martian Mono", ui-monospace, monospace; letter-spacing: .06em; text-transform: uppercase; color: var(--accent); }
.rw-h:first-child { margin-top: 0; }
.rw-empty { color: var(--ink-3); }
.rw table { border-collapse: collapse; width: 100%; font-size: 11px; line-height: 1.4; }
.rw th, .rw td { text-align: left; padding: 4px 8px 4px 0; border-bottom: 1px solid var(--rule); vertical-align: top; color: var(--ink-2); }
.rw th { color: var(--ink); font-weight: 600; }
.rw td:first-child { color: var(--ink); }
.rw td.yes { color: var(--accent); } .rw td.no { color: #ff8a7a; }
.rw-bar { display: grid; grid-template-columns: minmax(48px, 34%) 1fr auto; gap: 8px; align-items: center; margin: 0 0 6px; font-size: 11px; }
.rw-bar .rw-track { margin: 0; height: 8px; }
.rw-bar span:first-child { color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rw-ev { display: grid; grid-template-columns: 64px 1fr; gap: 8px; margin: 0 0 6px; padding-left: 10px; border-left: 2px solid var(--accent); }
.rw-ev span:first-child { color: var(--accent); font-size: 10.5px; }
.rw-kv { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; padding: 3px 0; border-bottom: 1px solid var(--rule); }
.rw-kv span:first-child { color: var(--ink-3); font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; }
.rw-kv span:last-child { color: var(--accent); font-weight: 600; font-size: 14px; text-align: right; }
.rw-err { color: #ff8a7a; font-size: 10.5px; margin-top: 6px; }
@keyframes rw-blink { 50% { opacity: .3; } }
@media (prefers-reduced-motion: reduce) { .rw { transform: none; transition: opacity .1s linear; } .rw-done .rw-big { animation: none; } }
`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
  const p2 = (n) => String(n).padStart(2, '0');
  // 1:05 or 1:02:05, from milliseconds.
  const span = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}:${p2(m)}:${p2(s % 60)}` : `${m}:${p2(s % 60)}`; };
  const TITLES = { clock: 'clock', timer: 'timer', stopwatch: 'stopwatch', note: 'note', todo: 'to do', reminders: 'reminders', table: 'table', bars: 'chart', timeline: 'timeline', live: 'live' };
  const WIDTH = { table: 'wider', bars: 'wide', timeline: 'wide', todo: 'wide', reminders: 'wide', note: 'wide' };
  const send = (msg) => api.send?.(msg);

  const cards = new Map(); // id → { el, w, key, tick }
  let drag = null, ticker = 0;

  // ---------- what each kind shows ----------
  const fmtTime = (zone) => { try { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: zone }); } catch { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }); } };
  const fmtDate = (zone) => { try { return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: zone }); } catch { return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); } };
  const runRow = (c, w) => {
    const row = mk('div', 'rw-row');
    const go = mk('button', 'rw-btn main', w.running ? 'Pause' : w.done ? 'Again' : 'Start'); go.type = 'button';
    go.addEventListener('click', () => send({ type: 'widget_act', id: w.id, act: 'toggle' }));
    const reset = mk('button', 'rw-btn', 'Reset'); reset.type = 'button';
    reset.addEventListener('click', () => send({ type: 'widget_act', id: w.id, act: 'reset' }));
    row.append(go, reset);
    return row;
  };
  const item = (text, done, when, late, onClick) => {
    const b = mk('button', `rw-item${done ? ' done' : ''}${late ? ' late' : ''}`); b.type = 'button';
    b.setAttribute('role', 'checkbox'); b.setAttribute('aria-checked', done ? 'true' : 'false');
    b.append(mk('span', 'rw-box', done ? '✓' : ''), mk('span', 'rw-label', text));
    if (when) b.append(mk('span', 'rw-when', when));
    b.addEventListener('click', onClick);
    return b;
  };
  const BUILD = {
    clock(c, w, body) {
      // Hours and minutes big, the seconds (and am or pm) small beside them, so it fits whatever the clock's style.
      const big = mk('div', 'rw-big'), hm = mk('span'), rest = mk('small'), sub = mk('div', 'rw-sub'), ft = fmtTime(w.zone), fd = fmtDate(w.zone);
      big.append(hm, rest); body.append(big, sub);
      c.tick = () => {
        const d = new Date(), parts = ft.formatToParts(d), get = (t) => parts.find((q) => q.type === t)?.value ?? '';
        hm.textContent = `${get('hour')}:${get('minute')}`; rest.textContent = `${get('second')} ${get('dayPeriod')}`.trim();
        sub.textContent = `${fd.format(d)}${w.zone ? ` · ${String(w.zone).split('/').pop().replace(/_/g, ' ')}` : ''}`;
      };
    },
    timer(c, w, body) {
      const big = mk('div', 'rw-big'), sub = mk('div', 'rw-sub'), track = mk('div', 'rw-track'), fill = mk('div', 'rw-fill');
      track.append(fill); body.append(big, track, sub, runRow(c, w));
      let rang = !!w.done;
      c.tick = () => {
        const left = w.running ? Math.max(0, w.endsAt - Date.now()) : w.done ? 0 : w.left;
        const over = w.done || (w.running && left <= 0);
        big.textContent = span(left + (w.running && left > 0 ? 999 : 0));
        fill.style.width = `${Math.round(100 * (1 - left / Math.max(1, w.total)))}%`;
        sub.textContent = over ? "Time's up" : w.running ? `of ${span(w.total)}` : 'Paused';
        c.el.classList.toggle('rw-done', over);
        if (over && !rang) { rang = true; R.sfx?.play('tick'); }
      };
    },
    stopwatch(c, w, body) {
      const big = mk('div', 'rw-big');
      body.append(big, runRow(c, w));
      c.tick = () => { big.textContent = span(w.running ? w.elapsed + Date.now() - w.startedAt : w.elapsed); };
    },
    note(c, w, body) {
      if (w.text) body.append(mk('p', 'rw-text', w.text));
      if (w.items?.length) { const ul = mk('ul', 'rw-list'); for (const it of w.items) ul.append(mk('li', '', it)); body.append(ul); }
    },
    todo(c, w, body) {
      c.count.textContent = `${w.items.filter((i) => i.done).length} of ${w.items.length}`;
      w.items.forEach((it, i) => body.append(item(it.text, it.done, '', false, () => { R.sfx?.play('tick'); send({ type: 'widget_tick', id: w.id, i }); })));
    },
    reminders(c, w, body) {
      const all = [...(w.today ?? []), ...(w.later ?? [])];
      if (!all.length) { body.append(mk('div', 'rw-empty', 'Nothing on your list.')); return; }
      c.count.textContent = `${all.filter((i) => !i.done).length} open`;
      for (const [name, list] of [['Today', w.today ?? []], ['Later', w.later ?? []]]) {
        if (!list.length) continue;
        body.append(mk('div', 'rw-h', name));
        for (const it of list) body.append(item(it.text, it.done, it.when, it.overdue && !it.done, () => { R.sfx?.play('tick'); send({ type: 'list_toggle', id: it.id }); }));
      }
    },
    table(c, w, body) {
      const t = mk('table'), head = mk('tr');
      for (const col of w.columns) { const th = mk('th', '', col); th.scope = 'col'; head.append(th); }
      t.append(head);
      for (const r of w.rows) {
        const tr = mk('tr');
        w.columns.forEach((_, i) => { const v = String(r[i] ?? ''), yn = /^(yes|no)$/i.exec(v.trim()); tr.append(mk('td', yn ? yn[1].toLowerCase() : '', yn ? (yn[1].toLowerCase() === 'yes' ? '✓' : '✗') : v)); });
        t.append(tr);
      }
      body.append(t);
    },
    bars(c, w, body) {
      const max = Math.max(...w.bars.map((b) => Math.abs(b.value)), 1e-9);
      for (const b of w.bars) {
        const row = mk('div', 'rw-bar'), track = mk('div', 'rw-track'), fill = mk('div', 'rw-fill');
        fill.style.width = `${Math.round(100 * Math.abs(b.value) / max)}%`;
        track.append(fill);
        row.append(mk('span', '', b.label), track, mk('span', '', `${Number(b.value.toFixed(2)).toLocaleString()}${w.unit ? ` ${w.unit}` : ''}`));
        body.append(row);
      }
    },
    timeline(c, w, body) { for (const e of w.events) { const row = mk('div', 'rw-ev'); row.append(mk('span', '', e.when), mk('span', '', e.text)); body.append(row); } },
    live(c, w, body) {
      for (const v of w.values ?? []) { const row = mk('div', 'rw-kv'); row.append(mk('span', '', v.label), mk('span', '', v.value)); body.append(row); }
      if (w.error) body.append(mk('div', 'rw-err', "Couldn't read it last time."));
      else if (w.at) body.append(mk('div', 'rw-sub', `Updated ${new Date(w.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`));
    },
  };

  // ---------- where they sit ----------
  const bounds = () => { const S = R.safe ?? { top: 0, right: 0, bottom: 0, left: 0 }; return { l: S.left + 8, t: S.top + 8, r: innerWidth - S.right - 8, b: innerHeight - S.bottom - 8 }; };
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
  const moveTo = (c, x, y) => {
    const B = bounds(), w = c.el.offsetWidth, h = c.el.offsetHeight;
    c.x = Math.round(Math.max(B.l, Math.min(x, B.r - w))); c.y = Math.round(Math.max(B.t, Math.min(y, B.b - h)));
    c.el.style.left = `${c.x}px`; c.el.style.top = `${c.y}px`;
  };
  // A new one goes in the first free spot, down the right edge and then in columns to its left.
  const freeSpot = (c) => {
    const B = bounds(), w = c.el.offsetWidth, h = c.el.offsetHeight, others = [...cards.values()].filter((o) => o !== c && o.placed).map((o) => rectOf(o.el));
    const hits = (x, y) => others.some((r) => x < r[0] + r[2] + 10 && x + w + 10 > r[0] && y < r[1] + r[3] + 10 && y + h + 10 > r[1]);
    for (let x = B.r - w - 8; x >= B.l; x -= 60) for (let y = B.t + 8; y + h <= B.b; y += 24) if (!hits(x, y)) return [x, y];
    return [B.r - w - 8, B.t + 8];
  };

  // ---------- one widget ----------
  function build(w) {
    const el = mk('section', `rw${WIDTH[w.kind] ? ` ${WIDTH[w.kind]}` : ''}`);
    el.setAttribute('role', 'region');
    const inner = mk('div', 'rw-in'), head = mk('div', 'rw-head'), title = mk('span', 'rw-title'), count = mk('span', 'rw-count'), body = mk('div', 'rw-body');
    const x = mk('button', 'rw-x'); x.type = 'button'; x.setAttribute('aria-label', 'Remove widget');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.setAttribute('width', '10'); svg.setAttribute('height', '10'); svg.setAttribute('viewBox', '0 0 10 10'); svg.setAttribute('aria-hidden', 'true');
    path.setAttribute('d', 'M1 1l8 8M9 1L1 9'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '2'); path.setAttribute('stroke-linecap', 'square');
    svg.append(path); x.append(svg);
    head.append(mk('span', 'rw-dot'), title, count, x);
    inner.append(head, body); el.append(inner);
    const c = { el, w, body, title, count, key: '', tick: null, placed: false, x: 0, y: 0 };
    x.addEventListener('click', () => { R.sfx?.play('poof'); send({ type: 'widget_close', id: c.w.id }); remove(c); cards.delete(c.w.id); });
    // Dragged by the top bar; where it is left is kept (the sidecar saves it).
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.rw-x')) return;
      const r = el.getBoundingClientRect();
      drag = { c, dx: e.clientX - r.left, dy: e.clientY - r.top };
      el.classList.add('drag'); el.style.zIndex = '5';
      try { head.setPointerCapture(e.pointerId); } catch {}
      e.preventDefault();
    });
    head.addEventListener('pointermove', (e) => { if (drag?.c === c) moveTo(c, e.clientX - drag.dx, e.clientY - drag.dy); });
    const drop = () => { if (drag?.c !== c) return; drag = null; el.classList.remove('drag'); el.style.zIndex = ''; c.w = { ...c.w, x: c.x, y: c.y }; send({ type: 'widget_move', id: c.w.id, x: c.x, y: c.y }); };
    head.addEventListener('pointerup', drop);
    head.addEventListener('pointercancel', drop);
    document.body.append(el);
    return c;
  }
  function fill(c, w) {
    c.w = w;
    // Everything but where it sits: a drag never redraws it.
    const { x, y, ...shown } = w, key = JSON.stringify(shown);
    if (key !== c.key) {
      c.key = key; c.tick = null;
      c.el.style.setProperty('--accent', TONES[w.tone] || TONES.accent);
      c.el.setAttribute('aria-label', `${w.title || TITLES[w.kind]} widget`);
      c.title.textContent = w.title || TITLES[w.kind] || 'widget';
      c.count.textContent = '';
      c.el.classList.remove('rw-done');
      c.body.replaceChildren();
      BUILD[w.kind]?.(c, w, c.body);
      c.tick?.();
    }
    if (drag?.c === c) return;
    if (Number.isFinite(w.x) && Number.isFinite(w.y)) { moveTo(c, w.x, w.y); c.placed = true; }
    else if (!c.placed) { const [fx, fy] = freeSpot(c); moveTo(c, fx, fy); c.placed = true; c.w = { ...w, x: c.x, y: c.y }; send({ type: 'widget_move', id: w.id, x: c.x, y: c.y }); }
    else moveTo(c, c.x, c.y); // taller now: still fully on screen
  }
  function remove(c) { c.el.classList.remove('on'); setTimeout(() => c.el.remove(), 200); if (drag?.c === c) drag = null; }

  const api = {
    send: null,
    get count() { return cards.size; },
    /** The whole list from the sidecar: new ones appear, changed ones redraw, missing ones go. */
    set(list) {
      list = Array.isArray(list) ? list.filter((w) => w && typeof w.id === 'string' && BUILD[w.kind]) : [];
      const keep = new Set(list.map((w) => w.id));
      for (const [id, c] of cards) if (!keep.has(id)) { remove(c); cards.delete(id); }
      for (const w of list) {
        let c = cards.get(w.id);
        if (!c) { c = build(w); cards.set(w.id, c); fill(c, w); requestAnimationFrame(() => c.el.classList.add('on')); }
        else fill(c, w);
      }
      clearInterval(ticker); ticker = 0;
      if ([...cards.values()].some((c) => c.tick)) ticker = setInterval(() => { for (const c of cards.values()) c.tick?.(); }, 250);
    },
  };
  // The screen changed size (or the overlay moved to another screen): keep every widget fully on it.
  addEventListener('resize', () => { for (const c of cards.values()) if (c.placed && drag?.c !== c) moveTo(c, c.w.x ?? c.x, c.w.y ?? c.y); });

  R.widgets = api;
  R.widgetHit = (x, y) => {
    if (drag) return true;
    for (const c of cards.values()) { const r = c.el.getBoundingClientRect(); if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true; }
    return false;
  };
  // Where each one is, as [x, y, w, h]: part of the window's click shape on Linux (host.js).
  R.widgetRects = () => [...cards.values()].map((c) => rectOf(c.el));
})();
