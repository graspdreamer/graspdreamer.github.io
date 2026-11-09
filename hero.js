import { graspPairs } from './grasp-pairs.js';

// Twelve recorded poses; repeats share the same high-density poster derivatives.
const selections = [
  [['banana', 0], ['hammer', 1], ['binoculars', 0], ['stamp', 1]],
  [['mug', 0], ['airplane', 1], ['ring', 0], ['eyeglasses', 1]],
  [['toothpaste', 1], ['elephant', 0], ['flute', 1], ['mouse', 0]],
];
const speeds = [13, 10, 12];
const phases = [0.08, 0.38, 0.2];
const mounted = new WeakMap();

export function createHeroCanopy(container, {
  motionButton = null,
} = {}) {
  if (!container) return null;
  if (mounted.has(container)) return mounted.get(container);

  const objects = new Map(graspPairs.map(object => [object.id, object]));
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const supportsMotion = typeof container.animate === 'function';
  const rows = [];
  let pausedByUser = false;
  let inView = !('IntersectionObserver' in window);
  let resizeFrame = 0;
  let destroyed = false;

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
      if (!example) throw new Error(`Missing canopy example: ${objectId}`);
      const card = document.createElement('div');
      card.className = 'canopy-card';
      card.dataset.case = example.id;
      const image = document.createElement('img');
      image.src = `assets/canopy/${example.id}.webp?v=canopy-hd-v2`;
      image.alt = '';
      image.width = image.height = 768;
      image.decoding = 'async';
      image.loading = 'eager';
      image.fetchPriority = 'low';
      card.append(image);
      set.append(card);
    });
    track.append(set);
    row.append(track);
    fragment.append(row);
    rows.push({ row, track, set, index, animation: null, period: 0, duration: 0 });
  });
  container.replaceChildren(fragment);

  function syncMotion() {
    const reduced = preference.matches || !supportsMotion;
    const playing = !reduced && !pausedByUser && inView && !document.hidden;
    rows.forEach(({ animation }) => {
      if (!animation) return;
      if (playing && animation.playState !== 'running') animation.play();
      if (!playing && animation.playState !== 'paused') animation.pause();
    });
    container.dataset.motion = reduced ? 'static' : playing ? 'playing' : 'paused';
    if (motionButton) {
      motionButton.hidden = reduced;
      motionButton.textContent = pausedByUser ? 'Resume motion' : 'Pause motion';
      motionButton.dataset.paused = String(pausedByUser);
    }
  }

  function measure() {
    resizeFrame = 0;
    if (destroyed) return;
    rows.forEach(state => {
      const { row, track, set, index } = state;
      // offsetWidth stays correct when a parent row is tilted in CSS.
      const period = set.offsetWidth;
      if (!period) return;
      const copies = Math.max(2, Math.ceil(row.clientWidth / period) + 1);
      while (track.children.length < copies) {
        const clone = set.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        clone.setAttribute('inert', '');
        track.append(clone);
      }
      while (track.children.length > copies) track.lastElementChild.remove();

      if (preference.matches || !supportsMotion) {
        state.animation?.cancel();
        state.animation = null;
        track.style.transform = `translate3d(${-period * phases[index]}px,0,0)`;
      } else if (!state.animation || state.period !== period) {
        const progress = state.animation && state.duration
          ? Number(state.animation.currentTime || 0) % state.duration / state.duration
          : phases[index];
        state.animation?.cancel();
        track.style.transform = '';
        const from = index === 1 ? -period : 0;
        const to = index === 1 ? 0 : -period;
        state.duration = period / speeds[index] * 1000;
        state.animation = track.animate([
          { transform: `translate3d(${from}px,0,0)` },
          { transform: `translate3d(${to}px,0,0)` },
        ], { duration: state.duration, iterations: Infinity, easing: 'linear' });
        state.animation.currentTime = progress * state.duration;
      }
      state.period = period;
    });
    syncMotion();
  }

  function queueMeasure() {
    if (!resizeFrame && !destroyed) resizeFrame = requestAnimationFrame(measure);
  }

  function toggle() {
    pausedByUser = !pausedByUser;
    syncMotion();
  }

  const onPreference = () => { syncMotion(); queueMeasure(); };
  preference.addEventListener('change', onPreference);
  document.addEventListener('visibilitychange', syncMotion);
  motionButton?.addEventListener('click', toggle);
  if (motionButton && container.id) motionButton.setAttribute('aria-controls', container.id);

  let intersection;
  if ('IntersectionObserver' in window) {
    intersection = new IntersectionObserver(entries => {
      inView = entries[0].isIntersecting;
      syncMotion();
    }, { threshold: 0 });
    intersection.observe(container.closest('.hero') || container);
  }

  let resize;
  if ('ResizeObserver' in window) {
    resize = new ResizeObserver(queueMeasure);
    resize.observe(container);
    rows.forEach(({ set }) => resize.observe(set));
  } else {
    window.addEventListener('resize', queueMeasure, { passive: true });
  }
  syncMotion();
  queueMeasure();

  const controller = {
    toggle,
    setPaused(value) { pausedByUser = Boolean(value); syncMotion(); },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(resizeFrame);
      intersection?.disconnect();
      resize?.disconnect();
      window.removeEventListener('resize', queueMeasure);
      preference.removeEventListener('change', onPreference);
      document.removeEventListener('visibilitychange', syncMotion);
      motionButton?.removeEventListener('click', toggle);
      rows.forEach(({ animation }) => animation?.cancel());
      container.replaceChildren();
      if (motionButton) motionButton.hidden = true;
      mounted.delete(container);
    },
  };
  mounted.set(container, controller);
  return controller;
}
