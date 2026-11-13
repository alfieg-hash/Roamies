// Desktop widgets: small cards the user asks to keep on their screen: a clock, a timer, a stopwatch, a note, a
// checklist, their reminders, a table, bars, a timeline, or values read from a web address every few minutes.
// They are kept in widgets.json (what each one is and where it was dragged to), so they come back after a restart.
// No model-written code ever runs: the overlay (showcase/roamies/widgets.js) only draws these structures, and a live
// widget's address goes through safety.mjs (checkWidgetUrl) when it is made and again on every refresh.
import dns from 'node:dns/promises';
import path from 'node:path';
import { z } from 'zod';
import { SAFE, checkWidgetUrl, isPrivateAddress } from './safety.mjs';
import { DIR, readJson, writeJson } from './store.mjs';

export const KINDS = ['clock', 'timer', 'stopwatch', 'note', 'todo', 'reminders', 'table', 'bars', 'timeline', 'live'];
export const TONES = ['accent', 'teal', 'amber', 'coral', 'lilac', 'sky', 'lime', 'red', 'white'];
export const LIMITS = { widgets: 12, items: 12, columns: 6, rows: 12, bars: 12, events: 10, fields: 6, bytes: 512_000, minEvery: 5, maxEvery: 1440, timer: 24 * 3600 };

// One flat object (no unions: some providers reject them); which fields a kind needs is checked in build().
export const WidgetArgs = z.object({
  do: z.enum(['add', 'change', 'remove']),
  id: z.string().max(8).optional(),
  kind: z.enum(KINDS).optional(),
  title: z.string().max(40).optional(),
  text: z.string().max(600).optional(),
  items: z.array(z.string().min(1).max(120)).max(LIMITS.items).optional(),
  done: z.array(z.number().int()).max(LIMITS.items).optional(),
  tone: z.enum(TONES).optional(),
  zone: z.string().max(60).optional(),
  seconds: z.number().optional(),
  run: z.enum(['start', 'pause', 'reset']).optional(),
  columns: z.array(z.string().max(30)).max(LIMITS.columns).optional(),
  rows: z.array(z.array(z.string().max(80)).max(LIMITS.columns)).max(LIMITS.rows).optional(),
  bars: z.array(z.object({ label: z.string().min(1).max(30), value: z.number() })).max(LIMITS.bars).optional(),
  unit: z.string().max(12).optional(),
  events: z.array(z.object({ when: z.string().min(1).max(16), text: z.string().min(1).max(60) })).max(LIMITS.events).optional(),
  url: z.string().max(600).optional(),
  fields: z.array(z.object({ label: z.string().min(1).max(24), path: z.string().max(120).optional(), after: z.string().max(60).optional(), unit: z.string().max(12).optional() })).max(LIMITS.fields).optional(),
  every: z.number().optional(),
});

const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const clock = (ms) => { const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), p = (n) => String(n).padStart(2, '0'); return h ? `${h}:${p(m)}:${p(s % 60)}` : `${m}:${p(s % 60)}`; };
const validZone = (zone) => { try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch { return false; } };

/** The value at a dotted path in parsed JSON ("current.temperature_2m", "prices.0.usd"): own keys and list indexes
 *  only, and only a plain value at the end. */
export function valueAt(data, dotted) {
  const parts = String(dotted ?? '').split('.').filter(Boolean);
  if (!parts.length || parts.length > 8) throw new Error(`"${dotted}" isn't a path I can follow (use up to 8 names with dots between).`);
  let at = data;
  for (const p of parts) {
    if (Array.isArray(at) && /^\d+$/.test(p)) at = at[Number(p)];
    else if (at && typeof at === 'object' && !Array.isArray(at) && Object.hasOwn(at, p)) at = at[p];
    else throw new Error(`Nothing at "${dotted}" (stopped at "${p}").`);
  }
  if (at === null || !['string', 'number', 'boolean'].includes(typeof at)) throw new Error(`"${dotted}" leads to a list or a group, not one value.`);
  return at;
}
const shown = (v, unit) => {
  const s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(Math.abs(v) < 10 ? 2 : 1)))) : String(v).replace(/\s+/g, ' ').trim();
  return clip(unit ? `${s}${/^[%°]/.test(unit) ? '' : ' '}${unit}` : s, 60);
};
/** What a live widget shows for each field, from the fetched text: JSON by path, a page by the words before it. */
export function readFields(body, fields) {
  let json, parsed = false;
  try { json = JSON.parse(body); parsed = true; } catch {}
  const text = parsed ? '' : String(body).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  return fields.map((f) => {
    if (f.path) {
      if (!parsed) throw new Error(`${f.label}: that address doesn't return JSON, so a path can't be followed. Use after (the words just before the value) instead.`);
      return { label: f.label, value: shown(valueAt(json, f.path), f.unit) };
    }
    if (parsed) throw new Error(`${f.label}: that address returns JSON, so give path, not after.`);
    const i = text.toLowerCase().indexOf(String(f.after).toLowerCase());
    if (i < 0) throw new Error(`${f.label}: the words "${f.after}" aren't on that page.`);
    // The next word after those words (a number, a price, a status); a lone sign before it ("$ 12") comes along.
    const [first = '', second = ''] = text.slice(i + f.after.length, i + f.after.length + 200).replace(/^[\s:=–-]+/, '').split(' ');
    const value = /[\p{L}\p{N}]/u.test(first) ? first : `${first} ${second}`.trim();
    if (!value) throw new Error(`${f.label}: nothing comes after "${f.after}" on that page.`);
    return { label: f.label, value: shown(value.replace(/[,;.]+$/, ''), f.unit) };
  });
}

/** Fetches a public https address for a widget. Redirects are followed by hand so each hop is checked too, as is
 *  where each host really points (a public name can point at this computer); the answer is cut off at a size limit. */
export async function fetchPublic(url, { fetch: get = fetch, lookup = (h) => dns.lookup(h, { all: true }) } = {}) {
  let res, at = String(url);
  for (let hop = 0; ; hop++) {
    const v = checkWidgetUrl(at);
    if (v.level !== SAFE) throw new Error(`Blocked for safety: ${v.reason}`);
    const host = new URL(at).hostname.replace(/^\[|\]$/g, '');
    const addrs = await Promise.resolve(lookup(host)).catch(() => []);
    if (addrs.some((x) => isPrivateAddress(x.address))) throw new Error(`Blocked for safety: ${host} leads to your own computer or network.`);
    res = await get(at, { headers: { 'user-agent': 'Roamies-Sidekick', accept: 'application/json, text/html;q=0.8, text/plain;q=0.7' }, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    const next = res.status >= 300 && res.status < 400 && res.headers.get('location');
    if (!next) break;
    if (hop >= 4) throw new Error('Too many redirects.');
    at = new URL(next, at).href;
  }
  if (!res.ok) throw new Error(`That address answered ${res.status}.`);
  const reader = res.body?.getReader?.();
  if (!reader) return (await res.text()).slice(0, LIMITS.bytes);
  const chunks = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > LIMITS.bytes) { await reader.cancel().catch(() => {}); throw new Error('That address returns too much to keep reading in a widget.'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The widgets on the desktop. onChange(list for the overlay) after every change; onTimer(widget) when a timer runs
 *  out while the app is open; reminders() gives the list a reminders widget shows. */
export function createWidgets({ file = path.join(DIR, 'widgets.json'), now = Date.now, onChange = () => {}, onTimer = () => {}, reminders = () => ({ today: [], later: [] }), net = {} } = {}) {
  const saved = readJson(file);
  const state = { next: Number.isInteger(saved?.next) ? saved.next : 1, list: Array.isArray(saved?.list) ? saved.list.filter((w) => w && KINDS.includes(w.kind) && typeof w.id === 'string').slice(0, LIMITS.widgets) : [] };
  const timers = new Map();
  let ticker = null;

  // A timer that ran out while the app was closed just shows as done; nothing is said about it now.
  for (const w of state.list) if (w.kind === 'timer' && w.running && w.endsAt <= now()) Object.assign(w, { running: false, left: 0, done: true });

  const find = (id) => state.list.find((w) => w.id === String(id ?? '').trim().toLowerCase());
  const need = (id) => { const w = find(id); if (!w) throw new Error(state.list.length ? `${id ? `No widget ${id}` : 'Give the id of the widget'}. On the desktop: ${state.list.map((x) => `${x.id} (${x.kind})`).join(', ')}.` : 'There are no widgets on the desktop.'); return w; };

  function arm(w) {
    clearTimeout(timers.get(w.id)); timers.delete(w.id);
    if (w.kind !== 'timer' || !w.running) return;
    const t = setTimeout(() => {
      timers.delete(w.id);
      if (!state.list.includes(w) || !w.running) return;
      Object.assign(w, { running: false, left: 0, done: true });
      commit(); onTimer(w);
    }, Math.max(0, w.endsAt - now()));
    t.unref?.();
    timers.set(w.id, t);
  }

  const view = () => state.list.map((w) => {
    const { made, ...v } = w;
    if (w.kind === 'reminders') { const r = reminders(); return { ...v, today: r.today ?? [], later: r.later ?? [] }; }
    return v;
  });
  let sent = '';
  /** Tells the overlay, if what it shows would change (force: even if not, e.g. when the overlay has just loaded). */
  function sync(force = false) { const list = view(), key = JSON.stringify(list); if (!force && key === sent) return; sent = key; onChange(list); }
  function commit() { const p = writeJson(file, { next: state.next, list: state.list }); sync(); return p; }

  // The fields a kind keeps, checked: what's missing or wrong is said in words the model can act on.
  function fill(w, a, fresh) {
    const has = (k) => a[k] !== undefined;
    if (has('title')) w.title = a.title.trim();
    if (has('tone')) w.tone = a.tone;
    switch (w.kind) {
      case 'clock':
        if (has('zone')) { if (a.zone && !validZone(a.zone)) throw new Error(`"${a.zone}" isn't a time zone I know. Use an IANA name like Europe/London or Asia/Tokyo.`); w.zone = a.zone || undefined; }
        break;
      case 'timer': {
        if (fresh && !has('seconds')) throw new Error('A timer needs seconds (how long it runs).');
        if (has('seconds')) {
          if (!(a.seconds >= 1 && a.seconds <= LIMITS.timer)) throw new Error('A timer runs from 1 second to 24 hours.');
          const total = Math.round(a.seconds) * 1000;
          Object.assign(w, { total, running: true, endsAt: now() + total, left: total, done: false });
        }
        if (a.run === 'pause' && w.running) Object.assign(w, { running: false, left: Math.max(0, w.endsAt - now()) });
        else if (a.run === 'start' && !w.running) { const left = w.done || !w.left ? w.total : w.left; Object.assign(w, { running: true, endsAt: now() + left, left, done: false }); }
        else if (a.run === 'reset') Object.assign(w, { running: false, left: w.total, done: false });
        break;
      }
      case 'stopwatch':
        if (fresh) Object.assign(w, { running: true, startedAt: now(), elapsed: 0 });
        if (a.run === 'pause' && w.running) Object.assign(w, { running: false, elapsed: w.elapsed + now() - w.startedAt });
        else if (a.run === 'start' && !w.running) Object.assign(w, { running: true, startedAt: now() });
        else if (a.run === 'reset') Object.assign(w, { running: false, elapsed: 0 });
        break;
      case 'note':
        if (has('text')) w.text = a.text;
        if (has('items')) w.items = a.items.slice();
        if (!w.text && !w.items?.length) throw new Error('A note needs text or items.');
        break;
      case 'todo': {
        if (has('items')) { const before = new Map((w.items ?? []).map((i) => [i.text, i.done])); w.items = a.items.map((text) => ({ text, done: before.get(text) === true })); }
        if (!w.items?.length) throw new Error('A to-do list needs items.');
        if (has('done')) { const bad = a.done.find((n) => n < 1 || n > w.items.length); if (bad !== undefined) throw new Error(`There is no item ${bad}: the list has ${w.items.length}.`); w.items.forEach((it, i) => { it.done = a.done.includes(i + 1); }); }
        break;
      }
      case 'reminders':
        if (fresh && state.list.some((x) => x.kind === 'reminders')) throw new Error('The reminders widget is already on the desktop.');
        break;
      case 'table':
        if (has('columns')) w.columns = a.columns.slice();
        if (has('rows')) w.rows = a.rows.map((r) => r.slice());
        if (!w.columns?.length || !w.rows?.length) throw new Error('A table needs columns and rows.');
        if (w.rows.some((r) => r.length > w.columns.length)) throw new Error('A row has more cells than there are columns.');
        break;
      case 'bars':
        if (has('bars')) w.bars = a.bars.map((b) => ({ label: b.label, value: b.value }));
        if (has('unit')) w.unit = a.unit;
        if (!w.bars?.length) throw new Error('Bars need bars: [{label, value}].');
        break;
      case 'timeline':
        if (has('events')) w.events = a.events.map((e) => ({ when: e.when, text: e.text }));
        if (!w.events?.length) throw new Error('A timeline needs events: [{when, text}].');
        break;
      case 'live': {
        if (has('url')) { const v = checkWidgetUrl(a.url); if (v.level !== SAFE) throw new Error(`Blocked for safety: ${v.reason}`); w.url = a.url; }
        if (has('fields')) {
          for (const f of a.fields) if (!f.path === !f.after) throw new Error(`${f.label}: give path (for JSON) or after (the words just before the value on a page), one of them.`);
          w.fields = a.fields.map((f) => ({ label: f.label, ...(f.path ? { path: f.path } : { after: f.after }), ...(f.unit ? { unit: f.unit } : {}) }));
        }
        if (has('every')) w.every = Math.round(Math.min(LIMITS.maxEvery, Math.max(LIMITS.minEvery, a.every)));
        if (!w.url || !w.fields?.length) throw new Error('A live widget needs url and fields.');
        w.every ??= 15;
        break;
      }
    }
  }

  async function refresh(w) {
    try {
      const values = readFields(await fetchPublic(w.url, net), w.fields);
      Object.assign(w, { values, at: now() }); delete w.error;
    } catch (e) {
      Object.assign(w, { error: clip(e.message, 160), at: now() });
      throw e;
    }
  }

  const label = (w) => `${w.id} (${w.kind}${w.title ? ` "${w.title}"` : ''})`;
  const api = {
    get count() { return state.list.length; },
    view, sync,
    /** The widget tool. Returns what to tell the model. */
    async run(args) {
      const a = WidgetArgs.parse(args);
      if (a.do === 'remove') {
        if (String(a.id ?? '').trim().toLowerCase() === 'all') { const n = state.list.length; for (const w of state.list.splice(0)) clearTimeout(timers.get(w.id)); timers.clear(); await commit(); return n ? `Removed all ${n} widgets.` : 'There were no widgets.'; }
        const w = need(a.id);
        state.list.splice(state.list.indexOf(w), 1); clearTimeout(timers.get(w.id)); timers.delete(w.id);
        await commit();
        return `Removed ${label(w)}.`;
      }
      if (a.do === 'add') {
        if (!a.kind) throw new Error(`Give kind: ${KINDS.join(', ')}.`);
        if (state.list.length >= LIMITS.widgets) throw new Error(`Only ${LIMITS.widgets} widgets fit on the desktop. Remove one first.`);
        const w = { id: `w${state.next}`, kind: a.kind, made: now() };
        fill(w, a, true);
        // A live widget is only kept if its first read works, so a wrong path is fixed now, not found later.
        if (w.kind === 'live') await refresh(w);
        state.next++; state.list.push(w); arm(w);
        await commit();
        return `Made ${label(w)}${w.kind === 'live' ? `, showing ${w.values.map((v) => `${v.label}: ${v.value}`).join(', ')}; it reads again every ${w.every} minutes` : ''}. It is on the desktop now and stays until removed.`;
      }
      const w = need(a.id);
      if (a.kind && a.kind !== w.kind) throw new Error(`${w.id} is a ${w.kind}; remove it and add a ${a.kind} instead.`);
      const before = JSON.stringify(w);
      try {
        fill(w, a, false);
        if (w.kind === 'live' && (a.url !== undefined || a.fields !== undefined)) await refresh(w);
      } catch (e) {
        // A change that fails leaves the widget as it was.
        const old = JSON.parse(before); for (const k of Object.keys(w)) delete w[k]; Object.assign(w, old);
        throw e;
      }
      arm(w);
      await commit();
      return `Changed ${label(w)}.`;
    },
    // From the overlay: dragged, closed, an item ticked, a timer or stopwatch button pressed.
    move(id, x, y) { const w = find(id); if (!w || !Number.isFinite(x) || !Number.isFinite(y)) return; w.x = Math.round(x); w.y = Math.round(y); sent = JSON.stringify(view()); return writeJson(file, { next: state.next, list: state.list }); },
    close(id) { const w = find(id); if (!w) return; state.list.splice(state.list.indexOf(w), 1); clearTimeout(timers.get(w.id)); timers.delete(w.id); return commit(); },
    tick(id, i) { const w = find(id), it = w?.kind === 'todo' ? w.items[i] : null; if (!it) return; it.done = !it.done; return commit(); },
    act(id, what) {
      const w = find(id);
      if (!w || (w.kind !== 'timer' && w.kind !== 'stopwatch')) return;
      const run = what === 'reset' ? 'reset' : what === 'toggle' ? (w.running ? 'pause' : 'start') : null;
      if (!run) return;
      fill(w, { run }, false); arm(w);
      return commit();
    },
    /** For the live state: what is on the desktop, so "the note" or "that timer" can be told apart by id. */
    describe() {
      if (!state.list.length) return '';
      const t = now();
      return state.list.map((w) => {
        const name = `${w.id}: ${w.kind}${w.title ? ` "${w.title}"` : ''}`;
        switch (w.kind) {
          case 'clock': return `- ${name}${w.zone ? ` (${w.zone})` : ''}`;
          case 'timer': return `- ${name}, ${w.done ? 'finished' : `${clock(w.running ? w.endsAt - t : w.left)} left, ${w.running ? 'running' : 'paused'}`}`;
          case 'stopwatch': return `- ${name}, ${clock(w.running ? w.elapsed + t - w.startedAt : w.elapsed)}, ${w.running ? 'running' : 'stopped'}`;
          case 'note': return `- ${name}: ${clip([w.text, ...(w.items ?? [])].filter(Boolean).join('; '), 160)}`;
          case 'todo': return `- ${name}: ${clip(w.items.map((it, i) => `${i + 1}. ${it.text}${it.done ? ' [done]' : ''}`).join(', '), 300)}`;
          case 'live': return `- ${name}: ${w.error ? `couldn't read it last time (${w.error})` : (w.values ?? []).map((v) => `${v.label} ${v.value}`).join(', ')}`;
          default: return `- ${name}`;
        }
      }).join('\n');
    },
    /** Starts the clockwork: timers that are running, live widgets read again when due, reminders kept current. */
    start() {
      for (const w of state.list) arm(w);
      let busy = false;
      ticker = setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
          let changed = false;
          for (const w of state.list.filter((x) => x.kind === 'live' && now() - (x.at ?? 0) >= x.every * 60_000)) { await refresh(w).catch(() => {}); changed = true; }
          if (changed) await commit(); else sync();
        } finally { busy = false; }
      }, 30_000);
      ticker.unref?.();
    },
    stop() { clearInterval(ticker); for (const t of timers.values()) clearTimeout(t); timers.clear(); },
  };
  return api;
}
