import { graspPairs } from './grasp-pairs.js';

const selections = [
  [['banana', 0], ['hammer', 1], ['binoculars', 0], ['stamp', 1]],
  [['mug', 0], ['airplane', 1], ['ring', 0], ['cylinder', 0]],
  [['toothpaste', 1], ['elephant', 0], ['flute', 1], ['mouse', 0]],
];
const speeds = [13, 10, 12];
const phases = [0.08, 0.38, 0.2];
const mounted = new WeakMap();

export function createHeroCanopy(container, { motionButton = null } = {}) {
  if (!container) return null;
  if (mounted.has(container)) return mounted.get(container);
  const objects = new Map(graspPairs.map(object => [object.id, object]));
  const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)') || { matches: false };
  const visibilityTarget = container.closest('.hero') || container;
  const rows = [];
  let motionOverride = null, resizeFrame = 0, fallbackFrame = 0, previousTime = 0, destroyed = false;
  const requested = () => motionOverride === null ? !preference.matches : motionOverride;
  const visible = () => {
    const rectangle = visibilityTarget.getBoundingClientRect();
    return rectangle.bottom > 0 && rectangle.top < window.innerHeight && rectangle.right > 0 && rectangle.left < window.innerWidth;
  };
  container.setAttribute('aria-hidden', 'true');
  const fragment = document.createDocumentFragment();
  selections.forEach((selection, index) => {
    const row = document.createElement('div');
    row.className = 'canopy-row';
    row.dataset.direction = index === 1 ? 'right' : 'left';
    const track = document.createElement('div');
    track.className = 'canopy-track';
    const set = document.createElement('div');
    set.className = 'canopy-set';
    selection.forEach(([objectId, caseIndex]) => {
      const example = objects.get(objectId)?.cases[caseIndex];
      if (!example) return;
      const card = document.createElement('div');
      card.className = 'canopy-card';
      card.dataset.case = example.id;
      const image = document.createElement('img');
      image.src = objectId === 'cylinder' ? `${example.poster}?v=rounded-v1` : `assets/canopy/${example.id}.webp?v=canopy-hd-v2`;
      image.alt = '';
      image.width = image.height = objectId === 'cylinder' ? 1536 : 768;
      image.decoding = 'async'; image.loading = 'eager'; image.fetchPriority = 'low';
      card.append(image); set.append(card);
    });
    track.append(set); row.append(track); fragment.append(row);
    rows.push({ row, track, set, index, animation: null, period: 0, duration: 0, phase: phases[index], fallback: false });
  });
  container.replaceChildren(fragment);

  function positionFallback(state) {
    const x = state.index === 1 ? (state.phase - 1) * state.period : -state.phase * state.period;
    state.track.style.transform = `translate3d(${x}px,0,0)`;
  }
  function fallbackTick(now) {
    fallbackFrame = 0;
    if (destroyed || !requested() || !visible() || document.hidden) { previousTime = 0; return; }
    const elapsed = previousTime ? Math.min(100, now - previousTime) : 0;
    previousTime = now;
    rows.forEach(state => {
      if (!state.fallback || !state.period) return;
      state.phase = (state.phase + elapsed / state.duration) % 1;
      positionFallback(state);
    });
    fallbackFrame = requestAnimationFrame(fallbackTick);
  }
  function syncMotion() {
    const want = requested();
    const playing = want && visible() && !document.hidden;
    rows.forEach(({ animation }) => {
      if (!animation) return;
      if (playing && animation.playState !== 'running') animation.play();
      if (!playing && animation.playState !== 'paused') animation.pause();
    });
    if (playing && rows.some(state => state.fallback) && !fallbackFrame) fallbackFrame = requestAnimationFrame(fallbackTick);
    if (!playing) { cancelAnimationFrame(fallbackFrame); fallbackFrame = previousTime = 0; }
    container.dataset.motion = playing ? 'playing' : preference.matches && motionOverride === null ? 'static' : 'paused';
    if (motionButton) {
      motionButton.hidden = false;
      motionButton.textContent = want ? 'Pause motion' : 'Play motion';
      motionButton.setAttribute('aria-label', motionButton.textContent);
      motionButton.dataset.paused = String(!want);
    }
  }
  function measure() {
    resizeFrame = 0;
    if (destroyed) return;
    rows.forEach(state => {
      const { row, track, set, index } = state;
      const period = set.offsetWidth;
      if (!period) return;
      const copies = Math.max(2, Math.ceil(row.clientWidth / period) + 1);
      while (track.children.length < copies) {
        const clone = set.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true'); clone.setAttribute('inert', ''); track.append(clone);
      }
      while (track.children.length > copies) track.lastElementChild.remove();
      if (state.period !== period || (!state.animation && !state.fallback)) {
        if (state.animation && state.duration) state.phase = Number(state.animation.currentTime || 0) % state.duration / state.duration;
        state.animation?.cancel(); state.animation = null;
        state.period = period; state.duration = period / speeds[index] * 1000;
        try {
          if (typeof track.animate !== 'function') throw new Error('Animation fallback');
          const from = index === 1 ? -period : 0, to = index === 1 ? 0 : -period;
          track.style.transform = '';
          state.animation = track.animate([
            { transform: `translate3d(${from}px,0,0)` }, { transform: `translate3d(${to}px,0,0)` },
          ], { duration: state.duration, iterations: Infinity, easing: 'linear' });
          state.animation.currentTime = state.phase * state.duration;
          state.fallback = false;
        } catch {
          state.fallback = true; positionFallback(state);
        }
      }
    });
    syncMotion();
  }
  function queueMeasure() { if (!resizeFrame && !destroyed) resizeFrame = requestAnimationFrame(measure); }
  function toggle() { motionOverride = !requested(); syncMotion(); queueMeasure(); }
  const onPreference = () => { motionOverride = null; syncMotion(); queueMeasure(); };
  const onScroll = () => syncMotion();
  if (preference.addEventListener) preference.addEventListener('change', onPreference);
  else preference.addListener?.(onPreference);
  document.addEventListener('visibilitychange', syncMotion);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', queueMeasure, { passive: true });
  motionButton?.addEventListener('click', toggle);
  if (motionButton && container.id) motionButton.setAttribute('aria-controls', container.id);
  let intersection, resize;
  try {
    if ('IntersectionObserver' in window) {
      intersection = new IntersectionObserver(syncMotion, { threshold: 0 });
      intersection.observe(visibilityTarget);
    }
  } catch { /* Visibility still follows scroll, resize and page visibility. */ }
  try {
    if ('ResizeObserver' in window) {
      resize = new ResizeObserver(queueMeasure); resize.observe(container);
      rows.forEach(({ set }) => resize.observe(set));
    }
  } catch { /* Window resize remains sufficient for fixed-size cards. */ }
  syncMotion(); queueMeasure();
  const controller = {
    toggle,
    setPaused(value) { motionOverride = !Boolean(value); syncMotion(); queueMeasure(); },
    destroy() {
      destroyed = true; cancelAnimationFrame(resizeFrame); cancelAnimationFrame(fallbackFrame);
      intersection?.disconnect(); resize?.disconnect();
      window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', queueMeasure);
      if (preference.removeEventListener) preference.removeEventListener('change', onPreference);
      else preference.removeListener?.(onPreference);
      document.removeEventListener('visibilitychange', syncMotion);
      motionButton?.removeEventListener('click', toggle);
      rows.forEach(({ animation }) => animation?.cancel());
      container.replaceChildren(); mounted.delete(container);
      if (motionButton) motionButton.hidden = true;
    },
  };
  mounted.set(container, controller);
  return controller;
}
