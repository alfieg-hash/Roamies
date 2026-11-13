// Desktop widgets (widgets.mjs): what the widget tool makes, keeps and refuses. Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { flushWrites } from '../store.mjs';
import { LIMITS, createWidgets, fetchPublic, parseUntil, readFields, valueAt } from '../widgets.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roamies-widgets-'));
const file = path.join(dir, 'widgets.json');
let clock = 1_800_000_000_000;
const now = () => clock;
const page = (body, { status = 200, headers = {} } = {}) => new Response(body, { status, headers });
const publicHost = async () => [{ address: '93.184.216.34' }];
const weather = JSON.stringify({ current: { temperature_2m: 11.36, wind_speed_10m: 14 }, daily: { max: [15.2, 16] }, note: 'fine' });

// ---------- reading a value ----------
assert.equal(valueAt({ a: { b: [10, { c: 'x' }] } }, 'a.b.1.c'), 'x');
assert.equal(valueAt({ a: 0 }, 'a'), 0, 'zero is a value');
assert.throws(() => valueAt({ a: { b: 1 } }, 'a'), /list or a group/);
assert.throws(() => valueAt({ a: 1 }, 'a.b'), /Nothing at/);
assert.throws(() => valueAt({}, '__proto__.polluted'), /Nothing at/, 'only own keys are followed');
assert.throws(() => valueAt({}, 'constructor.name'), /Nothing at/);
assert.throws(() => valueAt({}, ''), /isn't a path/);
assert.deepEqual(readFields(weather, [{ label: 'Now', path: 'current.temperature_2m', unit: '°C' }, { label: 'Wind', path: 'current.wind_speed_10m', unit: 'km/h' }]),
  [{ label: 'Now', value: '11.4°C' }, { label: 'Wind', value: '14 km/h' }]);
assert.deepEqual(readFields('<html><script>var price = 1;</script><p>Gold price: <b>$2,410.50</b>   per ounce</p></html>', [{ label: 'Gold', after: 'gold price' }]), [{ label: 'Gold', value: '$2,410.50' }]);
assert.throws(() => readFields('<p>hello</p>', [{ label: 'T', path: 'a.b' }]), /doesn't return JSON/);
assert.throws(() => readFields('<p>hello</p>', [{ label: 'T', after: 'goodbye' }]), /aren't on that page/);

// ---------- fetching: public https only, every hop checked ----------
await assert.rejects(fetchPublic('http://example.com/x', { fetch: async () => page('{}'), lookup: publicHost }), /Blocked for safety/, 'plain http is refused');
await assert.rejects(fetchPublic('https://127.0.0.1/x', { fetch: async () => page('{}'), lookup: publicHost }), /Blocked for safety/);
await assert.rejects(fetchPublic('https://example.com/x', { fetch: async () => page('{}'), lookup: async () => [{ address: '192.168.1.10' }] }), /own computer or network/, 'a public name that points at the local network');
await assert.rejects(fetchPublic('https://example.com/x', { fetch: async () => page('', { status: 302, headers: { location: 'http://169.254.169.254/latest' } }), lookup: publicHost }), /Blocked for safety/, 'a redirect to somewhere private');
await assert.rejects(fetchPublic('https://example.com/x', { fetch: async () => page('x'.repeat(LIMITS.bytes + 10)), lookup: publicHost }), /too much/);
await assert.rejects(fetchPublic('https://example.com/x', { fetch: async () => page('no', { status: 500 }), lookup: publicHost }), /answered 500/);
{
  const seen = [];
  const hop = async (url, o) => { seen.push([url, o.redirect]); return seen.length === 1 ? page('', { status: 301, headers: { location: '/v2/data' } }) : page('{"ok":true}'); };
  assert.equal(await fetchPublic('https://example.com/data', { fetch: hop, lookup: publicHost }), '{"ok":true}');
  assert.deepEqual(seen, [['https://example.com/data', 'manual'], ['https://example.com/v2/data', 'manual']], 'redirects are followed by hand');
}

// ---------- the widgets ----------
const sent = [], rang = [];
const net = { fetch: async () => page(weather), lookup: publicHost };
const make = () => createWidgets({ file, now, net, onChange: (list) => sent.push(list), onTimer: (w) => rang.push(w.id), reminders: () => ({ today: [{ id: 'c1', text: 'Call mum', done: false }], later: [] }) });
let W = make();
assert.equal(W.describe(), '', 'nothing on the desktop: nothing in the live state');

assert.match(await W.run({ do: 'add', kind: 'clock', zone: 'Asia/Tokyo', title: 'Tokyo' }), /Made w1 \(clock "Tokyo"\)/);
await assert.rejects(W.run({ do: 'add', kind: 'clock', zone: 'Mars/Olympus' }), /isn't a time zone/);
await assert.rejects(W.run({ do: 'add', kind: 'timer' }), /needs seconds/);
await assert.rejects(W.run({ do: 'add', kind: 'timer', seconds: 0 }), /1 second to 24 hours/);
await assert.rejects(W.run({ do: 'add' }), /Give kind/);
await assert.rejects(W.run({ do: 'add', kind: 'note' }), /needs text or items/);
await assert.rejects(W.run({ do: 'add', kind: 'table', columns: ['a'], rows: [['1', '2']] }), /more cells/);
assert.equal(W.count, 1, 'a refused widget is not kept');

await W.run({ do: 'add', kind: 'timer', seconds: 300, title: 'Tea' });
await W.run({ do: 'add', kind: 'todo', title: 'Shop', items: ['milk', 'eggs'] });
await W.run({ do: 'add', kind: 'reminders' });
await assert.rejects(W.run({ do: 'add', kind: 'reminders' }), /already on the desktop/);
assert.deepEqual(sent.at(-1).find((w) => w.kind === 'reminders').today, [{ id: 'c1', text: 'Call mum', done: false }], 'the reminders widget carries the list');
assert.ok(sent.at(-1).every((w) => !('made' in w)), 'the overlay gets only what it shows');

// A timer: pausing keeps what is left, starting carries on, the buttons do the same.
clock += 60_000;
await W.run({ do: 'change', id: 'w2', run: 'pause' });
assert.match(W.describe(), /w2: timer "Tea", 4:00 left, paused/);
clock += 600_000;
await W.act('w2', 'toggle');
assert.match(W.describe(), /w2: timer "Tea", 4:00 left, running/);
await W.act('w2', 'reset');
assert.match(W.describe(), /w2: timer "Tea", 5:00 left, paused/);
await W.act('w2', 'nonsense'); await W.act('w1', 'toggle'); await W.act('nope', 'toggle');

// A to-do: ticked by clicking or by number; new items keep the ticks of the ones that stay.
await W.tick('w3', 1);
assert.match(W.describe(), /1\. milk, 2\. eggs \[done\]/);
await W.run({ do: 'change', id: 'w3', items: ['eggs', 'bread'] });
assert.match(W.describe(), /1\. eggs \[done\], 2\. bread/);
await W.run({ do: 'change', id: 'W3', done: [2] });
assert.match(W.describe(), /1\. eggs, 2\. bread \[done\]/, 'done names exactly the ticked ones; ids are not case-sensitive');
await assert.rejects(W.run({ do: 'change', id: 'w3', done: [5] }), /no item 5/);
await W.tick('w3', 99); await W.tick('w1', 0);
await assert.rejects(W.run({ do: 'change', id: 'w3', kind: 'note' }), /w3 is a todo/);
await assert.rejects(W.run({ do: 'change', id: 'w9', title: 'x' }), /No widget w9\. On the desktop: w1 \(clock\)/);

// Live: kept only if the first read works; a failed change leaves it as it was.
assert.match(await W.run({ do: 'add', kind: 'live', title: 'London', url: 'https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.13&current=temperature_2m', fields: [{ label: 'Now', path: 'current.temperature_2m', unit: '°C' }] }),
  /Made w5 \(live "London"\), showing Now: 11\.4°C; it reads again every 15 minutes/);
await assert.rejects(W.run({ do: 'add', kind: 'live', url: 'https://example.com/a', fields: [{ label: 'X', path: 'nope' }] }), /Nothing at "nope"/);
await assert.rejects(W.run({ do: 'add', kind: 'live', url: 'http://example.com/a', fields: [{ label: 'X', path: 'note' }] }), /Blocked for safety/);
await assert.rejects(W.run({ do: 'add', kind: 'live', url: 'https://example.com/a?api_key=abc', fields: [{ label: 'X', path: 'note' }] }), /key or token/);
await assert.rejects(W.run({ do: 'add', kind: 'live', url: 'https://localhost/a', fields: [{ label: 'X', path: 'note' }] }), /Blocked for safety/);
await assert.rejects(W.run({ do: 'add', kind: 'live', url: 'https://example.com/a', fields: [{ label: 'X', path: 'note', after: 'x' }] }), /one of them/);
await assert.rejects(W.run({ do: 'change', id: 'w5', fields: [{ label: 'Now', path: 'current.nope' }] }), /Nothing at/);
assert.match(W.describe(), /w5: live "London": Now 11\.4°C/, 'still showing what it read before');
await W.run({ do: 'change', id: 'w5', every: 1 });
assert.equal(sent.at(-1).find((w) => w.id === 'w5').every, LIMITS.minEvery, 'never read more often than every few minutes');
assert.equal(W.count, 5);

// Dragged somewhere: saved, and not sent back to the overlay (it already knows).
{
  const n = sent.length;
  await W.move('w1', 412.6, 96.2); await W.move('w1', NaN, 3); await W.move('nope', 1, 1);
  assert.equal(sent.length, n);
}

// After a restart they are all back, where they were left; a timer that ran out meanwhile shows as done, unsaid.
await W.run({ do: 'change', id: 'w2', run: 'start' });
await flushWrites();
W.stop();
clock += 3600_000;
W = make();
assert.equal(W.count, 5);
W.sync(true);
assert.deepEqual([sent.at(-1)[0].x, sent.at(-1)[0].y], [413, 96]);
assert.match(W.describe(), /w2: timer "Tea", finished/);
assert.deepEqual(rang, []);
assert.match(await W.run({ do: 'add', kind: 'stopwatch' }), /Made w6/, 'ids are never reused');

// Closed with its x, removed by voice, all removed; the limit.
await W.close('w6');
assert.match(await W.run({ do: 'remove', id: 'w1' }), /Removed w1 \(clock "Tokyo"\)/);
await assert.rejects(W.run({ do: 'remove' }), /Give the id/);
for (let i = W.count; i < LIMITS.widgets; i++) await W.run({ do: 'add', kind: 'note', text: `n${i}` });
await assert.rejects(W.run({ do: 'add', kind: 'note', text: 'one too many' }), /Only 12 widgets/);
assert.match(await W.run({ do: 'remove', id: 'all' }), /Removed all 12 widgets/);
assert.deepEqual(sent.at(-1), []);
await assert.rejects(W.run({ do: 'change', id: 'w2', title: 'x' }), /no widgets on the desktop/);

// A timer that runs out while the app is open is said once.
await W.run({ do: 'add', kind: 'timer', seconds: 1 });
clock += 1000;
await new Promise((r) => setTimeout(r, 1100)); // the real second it was set for
assert.equal(rang.length, 1);
assert.match(W.describe(), /finished/);
await flushWrites();
W.stop();

// A countdown to a date, in the user's own time: a day means its start; nonsense and past dates are refused.
{
  assert.equal(parseUntil('2030-12-25'), new Date(2030, 11, 25).getTime());
  assert.equal(parseUntil('2030-12-25T18:30'), new Date(2030, 11, 25, 18, 30).getTime());
  assert.equal(parseUntil('2030-12-25 18:30:15'), new Date(2030, 11, 25, 18, 30, 15).getTime());
  for (const bad of ['Christmas', '25/12/2030', '2030-02-31', '2030-13-01', '2030-12-25T25:00', '', '2030-12-25T18:30Z']) assert.equal(parseUntil(bad), null, bad);
  const f2 = path.join(dir, 'countdown.json'), said = [];
  const at = new Date(2030, 11, 25).getTime();
  clock = at - (40 * 864e5 + 3 * 3600e3);
  let C = createWidgets({ file: f2, now, onTimer: (w) => said.push(w.id) });
  await assert.rejects(C.run({ do: 'add', kind: 'countdown' }), /needs until/);
  await assert.rejects(C.run({ do: 'add', kind: 'countdown', until: 'next Friday' }), /isn't a date I can count down to/);
  await assert.rejects(C.run({ do: 'add', kind: 'countdown', until: '2020-01-01' }), /already past/);
  assert.match(await C.run({ do: 'add', kind: 'countdown', until: '2030-12-25', title: 'Christmas' }), /Made w1 \(countdown "Christmas"\)/);
  assert.match(C.describe(), /w1: countdown "Christmas", to .*2030.*, 40 days left/);
  assert.equal(C.view()[0].at, at, 'the overlay gets the moment and counts down itself');
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(said, [], '40 days away: nothing is said yet (a wait that long is taken in steps)');
  // Moved to a moment about to come: it is reached and said once.
  clock = at - 5 * 3600e3;
  const soon = new Date(clock + 2000), p = (n) => String(n).padStart(2, '0');
  await C.run({ do: 'change', id: 'w1', until: `${soon.getFullYear()}-${p(soon.getMonth() + 1)}-${p(soon.getDate())}T${p(soon.getHours())}:${p(soon.getMinutes())}:${p(soon.getSeconds())}` });
  clock += 3000;
  await new Promise((r) => setTimeout(r, 2200)); // the real seconds it was set for
  assert.deepEqual(said, ['w1']);
  assert.match(C.describe(), /reached/);
  // One that passed while the app was closed shows as reached, unsaid.
  await C.run({ do: 'add', kind: 'countdown', until: '2030-12-25' });
  await flushWrites(); C.stop();
  clock = at + 1000;
  C = createWidgets({ file: f2, now, onTimer: (w) => said.push(w.id) });
  assert.equal(C.view()[1].done, true);
  assert.deepEqual(said, ['w1']);
  C.stop();
}

// Behind other windows or in front: said with every list, kept across restarts, set by the tool or a widget's button.
{
  const f3 = path.join(dir, 'layer.json'), got = [];
  let L = createWidgets({ file: f3, now, onChange: (list, layer) => got.push([list.length, layer]) });
  await L.run({ do: 'add', kind: 'clock' });
  assert.deepEqual(got.at(-1), [1, 'front'], 'in front unless asked');
  assert.match(await L.run({ do: 'layer', layer: 'back' }), /behind other windows/);
  assert.deepEqual(got.at(-1), [1, 'back']);
  assert.match(L.describe(), /^\(kept behind other windows/);
  await assert.rejects(L.run({ do: 'layer' }), /Give layer/);
  await L.setLayer('sideways');
  assert.equal(L.layer, 'back');
  await flushWrites(); L.stop();
  L = createWidgets({ file: f3, now, onChange: (list, layer) => got.push([list.length, layer]) });
  L.sync(true);
  assert.deepEqual(got.at(-1), [1, 'back'], 'still behind after a restart');
  await L.setLayer('front');
  assert.deepEqual(got.at(-1), [1, 'front']);
  assert.doesNotMatch(L.describe(), /behind/);
  await flushWrites(); L.stop();
}

// A widgets.json that was edited into nonsense starts empty instead of breaking the app.
fs.writeFileSync(file, JSON.stringify({ next: 'x', list: [{ kind: 'virus' }, null, { id: 'w1', kind: 'clock' }] }));
W = make();
assert.equal(W.count, 1);
fs.rmSync(dir, { recursive: true, force: true });
console.log('widgets ok');
