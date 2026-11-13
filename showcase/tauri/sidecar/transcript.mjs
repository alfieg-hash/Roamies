// A video's transcript, read from the page the user has open. YouTube shows a video's captions as a transcript
// panel ("Show transcript" under the description); the hands helper reads the page's text in its own order
// (hands `text`), and this picks the transcript out of it: the long run of rising timestamps, each followed by what
// was said. Nothing is fetched from YouTube by Roamies itself: it only reads what the user's browser is showing.
// Pure functions, so they are tested without a browser (test/transcript.test.mjs).

const STAMP = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const seconds = (s) => { const m = STAMP.exec(s); return !m ? null : m[3] !== undefined ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2]; };

/** The transcript in a page's lines of text: [{ at: '0:15', seconds: 15, text }]; empty when none is showing.
 *  A line can be a timestamp alone or "0:15 words…"; a few lines between timestamps (a chapter title) are allowed. */
export function extractTranscript(lines) {
  const flat = [];
  for (const raw of lines ?? []) {
    const line = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const m = /^(\d{1,2}:\d{2}(?::\d{2})?)\s+(\S.*)$/.exec(line);
    if (m) flat.push(m[1], m[2]); else flat.push(line);
  }
  // Every run of timestamps that never go back, each with words before the next one; the longest is the transcript
  // (the suggested videos' lengths and timestamps in comments make short runs at most).
  let best = [];
  for (let i = 0; i < flat.length; i++) {
    if (seconds(flat[i]) === null) continue;
    const run = [];
    let at = i;
    while (at < flat.length) {
      const t = seconds(flat[at]);
      const words = [];
      let j = at + 1;
      while (j < flat.length && seconds(flat[j]) === null && words.length < 4) words.push(flat[j++]);
      if (!words.length) break;
      run.push({ at: flat[at], seconds: t, text: words.join(' ') });
      if (j >= flat.length || seconds(flat[j]) === null || seconds(flat[j]) < t) { at = j; break; }
      at = j;
    }
    if (run.length > best.length) best = run;
    i = Math.max(i, at - 1);
  }
  if (best.length < 3) return [];
  // The panel repeats each line for screen readers on some layouts ("15 seconds words…"): drop exact repeats in a row.
  return best.filter((s, k) => k === 0 || s.text !== best[k - 1].text || s.seconds !== best[k - 1].seconds);
}

/** The transcript as text for a file: with timestamps one line each, or without as paragraphs that read like prose. */
export function formatTranscript(segments, { timestamps = false } = {}) {
  if (timestamps) return segments.map((s) => `[${s.at}] ${s.text}`).join('\n');
  const paras = [];
  let cur = '';
  for (const s of segments) {
    cur += (cur ? ' ' : '') + s.text;
    if ((cur.length > 500 && /[.?!]["')\]]?$/.test(s.text)) || cur.length > 900) { paras.push(cur); cur = ''; }
  }
  if (cur) paras.push(cur);
  return paras.join('\n\n');
}

/** The video's name from the browser window's title ("(3) My video - YouTube - Google Chrome" → "My video"). */
export function videoTitle(windowTitle) {
  // Everything from " - YouTube" on is the site's and the browser's own (profile name, browser name).
  const t = String(windowTitle ?? '').replace(/\s+[-–—]\s+YouTube(\s+[-–—]\s.*)?$/i, '').replace(/^\(\d+\+?\)\s*/, '').trim();
  return t || 'Video';
}

/** A file name that every system takes: no path characters, no trailing dots, not too long, never a reserved name. */
export function safeFileName(title) {
  let n = String(title ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/(^|\s)\.+(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[. ]+/, '').slice(0, 80).replace(/[. ]+$/, '');
  if (!n || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n)) n = 'Video';
  return n;
}
