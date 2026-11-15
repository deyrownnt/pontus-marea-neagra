/* PONTUS reveal runtime v6.3.11
 * Local, dependency-free, repeatable viewport reveals. Loaded independently from
 * the Three.js module so content animation still works when external imports fail.
 */
(() => {
  'use strict';
  if (window.PONTUS_REVEAL_RUNTIME?.version === '6.3.11') {
    window.PONTUS_REVEAL_RUNTIME.init();
    return;
  }

  const BUFFER = 112;
  const DURATION = 820;
  const tracked = new Set();
  const generations = new WeakMap();
  const timers = new WeakMap();
  const handlers = new WeakMap();
  let observer = null;
  let mutationObserver = null;
  let started = false;
  let reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const nextGeneration = el => {
    const n = (generations.get(el) || 0) + 1;
    generations.set(el, n);
    return n;
  };
  const clearTimer = el => {
    const timer = timers.get(el);
    if (timer) clearTimeout(timer);
    timers.delete(el);
    const handler = handlers.get(el);
    if (handler) el.removeEventListener('transitionend', handler);
    handlers.delete(el);
  };
  const setVisible = (el, immediate = false) => {
    if (!(el instanceof HTMLElement)) return;
    clearTimer(el);
    nextGeneration(el);
    el.dataset.revealState = 'visible';
    el.classList.add('reveal-enabled', 'is-visible');
    el.classList.remove('reveal-pending');
    if (immediate) el.style.removeProperty('--reveal-delay');
  };
  const setPending = el => {
    if (!(el instanceof HTMLElement) || !el.isConnected) return;
    const state = el.dataset.revealState;
    if (state === 'pending') return;
    clearTimer(el);
    nextGeneration(el);
    el.dataset.revealState = 'pending';
    el.style.removeProperty('--reveal-delay');
    el.classList.add('reveal-enabled', 'reveal-pending');
    el.classList.remove('is-visible');
  };
  const staggerFor = el => {
    const parent = el.parentElement;
    if (!parent) return 0;
    const siblings = [...parent.children].filter(node => node.classList?.contains('reveal'));
    const index = Math.max(0, siblings.indexOf(el));
    return Math.min(132, index * 24);
  };
  const enter = el => {
    if (!(el instanceof HTMLElement) || !el.isConnected) return;
    if (reduced) { setVisible(el, true); return; }
    if (el.dataset.revealState === 'visible' || el.dataset.revealState === 'entering') return;

    clearTimer(el);
    const generation = nextGeneration(el);
    const delay = staggerFor(el);
    el.dataset.revealState = 'entering';
    el.style.setProperty('--reveal-delay', `${delay}ms`);
    el.classList.add('reveal-enabled', 'reveal-pending');
    el.classList.remove('is-visible');

    // Commit the hidden pose before switching to the visible pose. The forced style
    // read is intentional: without it Chromium can merge both states on fast scroll.
    void el.offsetWidth;
    void getComputedStyle(el).opacity;
    requestAnimationFrame(() => {
      if (!el.isConnected || generations.get(el) !== generation || el.dataset.revealState !== 'entering') return;
      el.classList.remove('reveal-pending');
      el.classList.add('is-visible');

      const finish = event => {
        if (event && event.propertyName !== 'opacity') return;
        if (generations.get(el) !== generation || !el.classList.contains('is-visible')) return;
        el.dataset.revealState = 'visible';
        clearTimer(el);
        el.style.removeProperty('--reveal-delay');
      };
      el.addEventListener('transitionend', finish);
      handlers.set(el, finish);
      const timer = setTimeout(() => finish(null), delay + DURATION + 360);
      timers.set(el, timer);
    });
  };
  const register = el => {
    if (!(el instanceof HTMLElement) || tracked.has(el)) return;
    tracked.add(el);
    if (reduced || !observer || document.hidden) {
      setVisible(el, true);
      return;
    }
    el.dataset.revealState = 'pending';
    el.classList.add('reveal-enabled', 'reveal-pending');
    el.classList.remove('is-visible');
    try { observer.observe(el); }
    catch (error) {
      console.warn('PONTUS reveal: observer indisponibil; elementul rămâne vizibil.', error);
      setVisible(el, true);
    }
  };
  const unregisterTree = node => {
    if (!(node instanceof HTMLElement)) return;
    if (node.matches?.('.reveal')) {
      observer?.unobserve(node);
      clearTimer(node);
      tracked.delete(node);
    }
    node.querySelectorAll?.('.reveal').forEach(el => {
      observer?.unobserve(el);
      clearTimer(el);
      tracked.delete(el);
    });
  };
  const reconcile = () => {
    if (reduced) { tracked.forEach(el => setVisible(el, true)); return; }
    for (const el of tracked) {
      if (!el.isConnected) { unregisterTree(el); continue; }
      const rect = el.getBoundingClientRect();
      const nearViewport = rect.bottom >= -BUFFER && rect.top <= innerHeight + BUFFER;
      if (nearViewport) enter(el);
      else setPending(el);
    }
  };
  const showAll = () => {
    observer?.disconnect();
    for (const el of tracked) setVisible(el, true);
  };
  const startObserver = () => {
    observer?.disconnect();
    if (reduced || !('IntersectionObserver' in window)) { showAll(); return; }
    try {
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          const el = entry.target;
          if (!el?.isConnected) continue;
          try {
            if (entry.isIntersecting) enter(el);
            else setPending(el);
          } catch (error) {
            console.warn('PONTUS reveal: tranziția a fost finalizată în siguranță.', error);
            setVisible(el, true);
          }
        }
      }, { root: null, rootMargin: `${BUFFER}px 0px ${BUFFER}px 0px`, threshold: 0 });
      tracked.forEach(el => {
        if (!el.isConnected) return;
        try { observer.observe(el); } catch { setVisible(el, true); }
      });
      reconcile();
    } catch (error) {
      console.warn('PONTUS reveal: IntersectionObserver indisponibil; conținutul rămâne vizibil.', error);
      showAll();
    }
  };
  const init = () => {
    if (started) return;
    started = true;
    // Create the observer first. register() deliberately reveals immediately when
    // no observer exists, so the old order accidentally disabled the first reveal.
    startObserver();
    document.querySelectorAll('.reveal').forEach(register);
    reconcile();

    if ('MutationObserver' in window) {
      mutationObserver = new MutationObserver(records => {
        for (const record of records) {
          record.removedNodes.forEach(unregisterTree);
          record.addedNodes.forEach(node => {
            if (!(node instanceof HTMLElement)) return;
            if (node.matches?.('.reveal')) register(node);
            node.querySelectorAll?.('.reveal').forEach(register);
          });
        }
      });
      mutationObserver.observe(document.querySelector('main') || document.body, { childList: true, subtree: true });
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      for (const el of tracked) {
        if (el.dataset.revealState === 'entering') setVisible(el, true);
      }
    } else reconcile();
  }, { passive: true });
  window.addEventListener('pageshow', reconcile, { passive: true });
  window.addEventListener('pagehide', () => {
    for (const el of tracked) if (el.dataset.revealState === 'entering') setVisible(el, true);
  }, { passive: true });
  const scheduleReconcile = () => {
    if (window.__PONTUS_REVEAL_RECONCILE_RAF__) return;
    window.__PONTUS_REVEAL_RECONCILE_RAF__ = requestAnimationFrame(() => {
      window.__PONTUS_REVEAL_RECONCILE_RAF__ = 0;
      reconcile();
    });
  };
  window.addEventListener('scroll', scheduleReconcile, { passive: true });
  window.addEventListener('resize', scheduleReconcile, { passive: true });
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  media?.addEventListener?.('change', event => {
    reduced = event.matches;
    if (reduced) showAll();
    else {
      tracked.forEach(setPending);
      startObserver();
      reconcile();
    }
  });

  window.PONTUS_REVEAL_RUNTIME = {
    version: '6.3.11',
    init,
    refresh: reconcile,
    stats: () => ({ tracked: tracked.size, visible: [...tracked].filter(el => el.dataset.revealState === 'visible').length, entering: [...tracked].filter(el => el.dataset.revealState === 'entering').length, pending: [...tracked].filter(el => el.dataset.revealState === 'pending').length, reducedMotion: reduced })
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
