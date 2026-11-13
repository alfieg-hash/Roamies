// The widgets' back window (widgets.html): the page behind other apps' windows that shows the widgets while they are
// kept "behind". The shell calls __roamiePtr(x, y) with the real cursor and __roamieHost(msg) with the sidecar's
// widget list; the page answers through set_hot (clicks reach it only over a widget) and sidecar_send.
(() => {
  const invoke = window.__TAURI__?.core?.invoke, R = window.Roamie;
  if (!invoke || !R?.widgets) return;
  const send = (msg) => invoke('sidecar_send', { msg }).catch(() => {});
  R.widgets.send = send;
  let hot = null;
  window.__roamiePtr = (x, y) => { const h = !!R.widgetHit(x, y); if (h !== hot) { hot = h; invoke('set_hot', { hot: h }).catch(() => {}); } };
  // The taskbar's side of the screen: widgets keep clear of it.
  window.__roamieSafe = (s) => { R.safe = s; dispatchEvent(new Event('resize')); };
  window.__roamieHost = (m) => { if (m?.kind === 'widgets') R.widgets.set(m.layer === 'back' ? m.list : [], m.layer); };
  // Loaded: ask the sidecar for the list (the one that opened this window came before the page was there).
  send({ type: 'widgets_ready' });
})();
