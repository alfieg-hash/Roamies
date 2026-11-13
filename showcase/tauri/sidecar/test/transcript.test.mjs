// A video's transcript picked out of a page's text (transcript.mjs). Run: npm test
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractTranscript, formatTranscript, safeFileName, videoTitle } from '../transcript.mjs';

// A YouTube page as the helper reads it: page furniture, the transcript panel, then suggested videos and comments.
const page = [
  'Skip navigation', 'Search', 'How to bake bread', 'Baking Channel', '1.2M subscribers', 'Subscribe', '48K', 'Share',
  '312,400 views 2 years ago', 'In this video we bake a simple loaf.', 'Transcript', 'Search in video',
  '0:00', 'Hi everyone and welcome back.', '0:04', 'Today we are baking bread.', '0:09', 'You will need flour, water,',
  '0:12', 'salt and yeast.', 'Mixing the dough', '0:15', 'First, mix it all together.', '0:15', 'First, mix it all together.',
  '1:02', '[Music]', '1:10', '[Music]', '1:15', 'Now let it rest for an hour.', '1:02:30', 'And that is the finished loaf!',
  'English (auto-generated)',
  '12:34', 'Sourdough for beginners', 'Baking Channel', '2M views', '4:20', 'Ten bread mistakes', 'Other Channel', '8:15', 'Pizza dough', 'Third Channel',
  'Comments', 'the bit at 0:15 is great', 'Reply',
];
const t = extractTranscript(page);
assert.deepEqual(t.map((s) => s.at), ['0:00', '0:04', '0:09', '0:12', '0:15', '1:02', '1:10', '1:15', '1:02:30']);
assert.equal(t[0].text, 'Hi everyone and welcome back.');
assert.equal(t[3].text, 'salt and yeast. Mixing the dough', 'a chapter title between two lines stays with the text');
assert.equal(t.at(-1).seconds, 3750);
assert.equal(t.filter((s) => s.text === '[Music]').length, 2, 'the same words at different times are both kept');
assert.equal(t.filter((s) => s.at === '0:15').length, 1, 'a line read twice at the same time is kept once');
assert.ok(!t.some((s) => /Sourdough|Pizza|great/.test(s.text)), 'suggested videos and comments are not the transcript');

// Timestamp and words on one line; and nothing that looks like a transcript.
assert.deepEqual(extractTranscript(['0:01 one two', '0:05 three four', '0:09   five six', 'More']).map((s) => `${s.at}|${s.text}`), ['0:01|one two', '0:05|three four', '0:09|five six More']);
assert.deepEqual(extractTranscript(page.slice(0, 10)), [], 'no panel open: nothing');
assert.deepEqual(extractTranscript(['12:34', 'A video', '4:20', 'Another', '8:15', 'A third']), [], 'video lengths going up and down are not a transcript');
assert.deepEqual(extractTranscript(['0:00', 'a', '0:05', 'b']), [], 'two lines are too few to be sure');
assert.deepEqual(extractTranscript([]), []); assert.deepEqual(extractTranscript(null), []);
assert.deepEqual(extractTranscript(['0:00', '0:01', '0:02', '0:03']), [], 'timestamps with no words');

// As text for the file.
assert.equal(formatTranscript(t.slice(0, 2), { timestamps: true }), '[0:00] Hi everyone and welcome back.\n[0:04] Today we are baking bread.');
assert.equal(formatTranscript(t.slice(0, 3)), 'Hi everyone and welcome back. Today we are baking bread. You will need flour, water,');
{
  const long = Array.from({ length: 60 }, (_, i) => ({ at: `0:${String(i).padStart(2, '0')}`, seconds: i, text: `This is sentence number ${i} of the talk.` }));
  const paras = formatTranscript(long).split('\n\n');
  assert.ok(paras.length >= 3 && paras.every((p) => p.length < 1000 && /\.$/.test(p)), 'long talks break into paragraphs at sentence ends');
  const noStops = formatTranscript(long.map((s) => ({ ...s, text: s.text.slice(0, -1) }))).split('\n\n');
  assert.ok(noStops.length >= 2 && noStops.every((p) => p.length < 1000), 'captions without full stops still break');
}

// Names.
assert.equal(videoTitle('(3) How to bake bread - YouTube - Google Chrome'), 'How to bake bread');
assert.equal(videoTitle('How to bake bread - YouTube — Mozilla Firefox'), 'How to bake bread');
assert.equal(videoTitle('Bread - a history - YouTube - Personal - Microsoft​ Edge'), 'Bread - a history');
assert.equal(videoTitle(''), 'Video');
assert.equal(safeFileName('What is 2/3 of "x"? <Part 1>: a|b*c\\d'), 'What is 2 3 of x Part 1 a b c d');
assert.equal(safeFileName('..\\..\\Windows\\System32\\evil'), 'Windows System32 evil', 'no path can be made from a title');
assert.equal(safeFileName('con'), 'Video'); assert.equal(safeFileName('  ...  '), 'Video'); assert.equal(safeFileName('trailing dots...'), 'trailing dots');
assert.equal(safeFileName('x'.repeat(300)).length, 80);

// The save_transcript tool, with a stand-in for the hands helper: the transcript goes to a new file under
// Documents (never over an earlier one), nothing is written when no transcript shows or actions are off.
{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'roamies-transcript-'));
  const helper = path.join(home, 'fake-hands.mjs');
  fs.writeFileSync(helper, `
    const [cmd] = process.argv.slice(2);
    const lines = process.env.FAKE_LINES ? JSON.parse(process.env.FAKE_LINES) : [];
    if (cmd === 'text') console.log(JSON.stringify({ ok: true, window: { id: 1, app: 'chrome', title: '(2) How to: bake/bread? - YouTube - Google Chrome' }, lines }));
    else console.log(JSON.stringify({ ok: false, error: 'not in this test: ' + cmd }));`);
  const tools = new URL('../tools.mjs', import.meta.url).href;
  const call = (lines, { actions = true, args = {} } = {}) => execFileSync(process.execPath, ['--input-type=module', '-e', `
    const { createTools } = await import(${JSON.stringify(tools)});
    const noop = async () => {};
    const { tools } = createTools({ allowActions: () => ${actions}, ui: () => {}, ask: noop, openUrl: noop, onCommitments: noop, showList: noop, fmtWhen: String, commitmentsText: () => '', userName: 'T' });
    const t = tools.find((x) => x.name === 'save_transcript');
    try { console.log('OK ' + await t.execute(${JSON.stringify(args)})); } catch (e) { console.log('ERR ' + e.message); }
    process.exit(0);`], { env: { ...process.env, HOME: home, USERPROFILE: home, ROAMIES_HANDS: helper, FAKE_LINES: JSON.stringify(lines), PATH: '' }, encoding: 'utf8' }).trim();
  const dir = path.join(home, 'Documents', 'Roamies transcripts');

  assert.match(call(page.slice(0, 10)), /^ERR No transcript is showing in chrome .*click_text "Show transcript"/s);
  assert.match(call(page, { actions: false }), /^ERR /, 'nothing is saved while actions are off');
  assert.ok(!fs.existsSync(dir), 'nothing was written');

  const first = call(page);
  assert.match(first, /^OK Saved the transcript of "How to: bake\/bread\?" \(9 lines, about \d+ words, up to 1:02:30\) to .*How to bake bread\.txt/);
  const saved = fs.readFileSync(path.join(dir, 'How to bake bread.txt'), 'utf8');
  assert.match(saved, /^How to: bake\/bread\?\n=+\n\nHi everyone and welcome back\. Today we are baking bread\./);
  assert.ok(!/\d:\d\d/.test(saved.split('\n').slice(2).join('\n')), 'no timestamps unless asked');

  assert.match(call(page, { args: { timestamps: true } }), /How to bake bread \(2\)\.txt/, 'a second save makes a second file');
  assert.match(fs.readFileSync(path.join(dir, 'How to bake bread (2).txt'), 'utf8'), /\n\[0:00\] Hi everyone and welcome back\.\n\[0:04\] Today/);
  assert.equal(fs.readFileSync(path.join(dir, 'How to bake bread.txt'), 'utf8'), saved, 'the first file is untouched');
  fs.rmSync(home, { recursive: true, force: true });
}

console.log('transcript ok');
