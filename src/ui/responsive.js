export function initResponsiveUI({ chat, main, sidebar, practice, sideButton, practiceButton, overlay, composer }) {
  const sideCompact = () => document.documentElement.dataset.sidePanel === 'drawer';
  const practiceCompact = () => document.documentElement.dataset.practicePanel === 'drawer';
  let opened = null;

  function sync() {
    if (chat.classList.contains('hidden') || (opened === 'side' && !sideCompact()) || (opened === 'practice' && !practiceCompact())) opened = null;
    chat.classList.toggle('side-open', opened === 'side');
    chat.classList.toggle('practice-open', opened === 'practice');
    overlay.hidden = !opened;
    main.inert = Boolean(opened);
    sidebar.inert = opened === 'practice' || (sideCompact() && opened !== 'side');
    practice.inert = practiceCompact() && opened !== 'practice';
    sideButton.setAttribute('aria-expanded', String(opened === 'side'));
    practiceButton.setAttribute('aria-expanded', String(opened === 'practice'));
    sideButton.textContent = opened === 'side' ? '收起列表' : '对话列表';
    practiceButton.textContent = opened === 'practice' ? '收起练习' : '小练习';
  }

  function closePanels({ restoreFocus = false } = {}) {
    const button = opened === 'side' ? sideButton : opened === 'practice' ? practiceButton : null;
    opened = null;
    sync();
    if (restoreFocus) button?.focus({ preventScroll: true });
  }

  function toggle(kind) {
    if (opened === kind) { closePanels({ restoreFocus: true }); return; }
    document.activeElement?.blur();
    opened = kind;
    sync();
    (kind === 'side' ? sidebar : practice).focus({ preventScroll: true });
  }

  sideButton.addEventListener('click', () => toggle('side'));
  practiceButton.addEventListener('click', () => toggle('practice'));
  overlay.addEventListener('click', () => closePanels({ restoreFocus: true }));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && opened) { event.preventDefault(); closePanels({ restoreFocus: true }); }
  });
  window.addEventListener('layoutchange', sync);

  function sizeComposer() {
    composer.style.height = 'auto';
    composer.style.height = `${Math.min(composer.scrollHeight + 2, 144)}px`;
  }
  function syncViewport() {
    const viewport = window.visualViewport;
    const unzoomed = !viewport || viewport.scale <= 1.05;
    const height = unzoomed ? viewport?.height || window.innerHeight : window.innerHeight;
    document.documentElement.style.setProperty('--visual-height', `${Math.round(height)}px`);
    const editing = document.activeElement?.matches('input, textarea, [contenteditable="true"]');
    document.body.classList.toggle('keyboard-open', Boolean(unzoomed && editing && window.innerHeight - height > 120));
  }
  composer.addEventListener('input', sizeComposer);
  window.addEventListener('resize', syncViewport);
  window.visualViewport?.addEventListener('resize', syncViewport);
  document.addEventListener('focusin', syncViewport);
  document.addEventListener('focusout', () => requestAnimationFrame(syncViewport));
  syncViewport();
  sync();
  return { sync, closePanels, sizeComposer };
}
