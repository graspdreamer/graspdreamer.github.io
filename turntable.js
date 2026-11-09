import {
  CanvasTexture, ImageLoader, LinearFilter, MathUtils, Mesh, NoColorSpace,
  OrthographicCamera, PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial,
  SRGBColorSpace, Vector4, WebGLRenderer,
} from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { loadAtlas } from './atlas-loader.js';

const detailSize = 1536;
const defaultDistance = 0.9;
const readyHint = 'Drag to rotate · Scroll to zoom';
export const renderUrl = path => `${path}?v=rounded-v1`;

export function createTurntable(stage, canvas, poster, guide, { slider, angleOutput } = {}) {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0xf9fbfc);
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  camera.position.z = 2;
  const orbitCamera = new PerspectiveCamera();
  orbitCamera.position.z = defaultDistance;
  const controls = new OrbitControls(orbitCamera, canvas);
  controls.enablePan = false;
  controls.minDistance = 0.55;
  controls.maxDistance = 1.45;
  controls.minPolarAngle = MathUtils.degToRad(40);
  controls.maxPolarAngle = MathUtils.degToRad(140);

  function tile(size) {
    const source = document.createElement('canvas');
    source.width = source.height = size;
    const context = source.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas rendering is unavailable.');
    const texture = new CanvasTexture(source);
    texture.colorSpace = NoColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = texture.magFilter = LinearFilter;
    return { source, context, texture, frame: -1 };
  }
  const previews = Array.from({ length: 4 }, () => tile(512));
  const detail = tile(detailSize);
  const uniforms = {
    map0: { value: previews[0].texture }, map1: { value: previews[1].texture },
    map2: { value: previews[2].texture }, map3: { value: previews[3].texture },
    detailed: { value: detail.texture }, weights: { value: new Vector4(1, 0, 0, 0) },
    detailMix: { value: 0 },
  };
  const material = new ShaderMaterial({
    uniforms, toneMapped: false,
    vertexShader: 'varying vec2 imageUv; void main(){ imageUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `
      varying vec2 imageUv;
      uniform sampler2D map0, map1, map2, map3, detailed;
      uniform vec4 weights;
      uniform float detailMix;
      vec3 imageLinear(vec3 c) {
        return mix(c/12.92,pow((c+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),c));
      }
      void main(){
        vec3 preview = imageLinear(texture2D(map0,imageUv).rgb)*weights.x
          + imageLinear(texture2D(map1,imageUv).rgb)*weights.y
          + imageLinear(texture2D(map2,imageUv).rgb)*weights.z
          + imageLinear(texture2D(map3,imageUv).rgb)*weights.w;
        vec3 high = imageLinear(texture2D(detailed,imageUv).rgb);
        gl_FragColor=vec4(mix(preview,high,detailMix),1.0);
        #include <colorspace_fragment>
      }`,
  });
  const image = new Mesh(new PlaneGeometry(2, 2), material);
  scene.add(image);
  const loader = new ImageLoader();
  const constrained = Boolean(navigator.connection?.saveData) || (navigator.deviceMemory > 0 && navigator.deviceMemory <= 2);
  const maximumCachedSheets = constrained || window.matchMedia('(max-width: 739px)').matches ? 1 : 2;
  const detailCache = new Map();
  const detailJobs = new Map();
  let request = 0, selectedExample, preview, previewSize = 512;
  let previewAbort, detailTimer, preloadTimer, animationFrame = 0;
  let detailFrame = '', previewGeneration = 0, touched = false, interacting = false;
  let idleAt = 0, lastAngle = 0, direction = 1, detailFailed = false, initializing = false;
  let lastPaint = 0;

  function view() {
    const a = MathUtils.euclideanModulo((MathUtils.radToDeg(controls.getAzimuthalAngle()) + 180) / 15, 24);
    const e = MathUtils.clamp((90 - MathUtils.radToDeg(controls.getPolarAngle()) + 50) / 25, 0, 4);
    const angle = Math.round(a) % 24;
    const level = Math.round(e);
    const part = Math.floor(angle / 6);
    return { a, e, angle, level, part, key: `${level}:${part}` };
  }
  function invalidate() {
    if (!animationFrame) animationFrame = requestAnimationFrame(draw);
  }
  function setGuide(text) { if (guide.textContent !== text) guide.textContent = text; }
  function syncAngle(target) {
    if (!slider) return;
    slider.min = '0'; slider.max = '24'; slider.step = 'any';
    if (document.activeElement !== slider || !interacting) slider.value = String(target.a);
    const degrees = -180 + target.a * 15;
    slider.setAttribute('aria-valuetext', `${Math.round(degrees)} degrees`);
    slider.style.setProperty('--angle-progress', `${target.a / 24 * 100}%`);
    slider.disabled = !preview && !detailCache.size;
    if (angleOutput) angleOutput.textContent = `${Math.round(degrees)}°`;
  }
  function preparePreviews(target) {
    if (!preview) return;
    const a0 = Math.floor(target.a), a1 = (a0 + 1) % 24;
    const e0 = Math.floor(target.e), e1 = Math.min(4, e0 + 1);
    const frames = [e0 * 24 + a0, e0 * 24 + a1, e1 * 24 + a0, e1 * 24 + a1];
    const x = target.a - a0, y = target.e - e0;
    uniforms.weights.value.set((1 - x) * (1 - y), x * (1 - y), (1 - x) * y, x * y);
    previews.forEach((targetTile, index) => {
      const frame = frames[index];
      const identity = `${previewGeneration}:${frame}`;
      if (targetTile.frame === identity) return;
      if (targetTile.source.width !== previewSize) targetTile.source.width = targetTile.source.height = previewSize;
      targetTile.context.drawImage(preview, frame % 12 * previewSize, Math.floor(frame / 12) * previewSize,
        previewSize, previewSize, 0, 0, previewSize, previewSize);
      targetTile.texture.needsUpdate = true;
      targetTile.frame = identity;
    });
  }
  function draw(now) {
    animationFrame = 0;
    const target = view();
    syncAngle(target);
    const sheet = detailCache.get(target.key);
    if (!preview && !sheet && !detailFrame) return;
    preparePreviews(target);
    const resting = !interacting && now >= idleAt;
    if (sheet && resting) {
      const identity = `${request}:${target.level}:${target.angle}`;
      if (detailFrame !== identity) {
        const index = target.angle % 6;
        detail.context.drawImage(sheet, index % 3 * detailSize, Math.floor(index / 3) * detailSize,
          detailSize, detailSize, 0, 0, detailSize, detailSize);
        detail.texture.needsUpdate = true;
        detailFrame = identity;
        detailCache.delete(target.key); detailCache.set(target.key, sheet);
      }
    }
    const exactDetail = sheet && resting && detailFrame === `${request}:${target.level}:${target.angle}`;
    const desiredMix = exactDetail || !preview ? 1 : 0;
    const elapsed = Math.min(50, lastPaint ? now - lastPaint : 16);
    lastPaint = now;
    if (!touched && exactDetail) uniforms.detailMix.value = 1;
    else {
      const step = elapsed / (desiredMix ? 120 : 60);
      const current = uniforms.detailMix.value;
      uniforms.detailMix.value = desiredMix ? Math.min(1, current + step) : Math.max(0, current - step);
    }
    image.scale.setScalar(1 / orbitCamera.position.length());
    renderer.render(scene, camera);
    canvas.hidden = false;
    const visible = touched || exactDetail || detailFailed;
    canvas.style.opacity = visible ? '1' : '0';
    poster.hidden = visible;
    canvas.dataset.viewQuality = uniforms.detailMix.value === 1 && exactDetail ? 'detail' : 'preview';
    canvas.dataset.viewPixels = String(canvas.dataset.viewQuality === 'detail' ? detailSize : previewSize);
    canvas.dataset.viewFrame = `${target.level}:${target.angle}`;
    canvas.dataset.viewAngle = target.a.toFixed(4);
    setGuide(readyHint);
    if (uniforms.detailMix.value !== desiredMix) invalidate();
  }
  function cancelPreload() { clearTimeout(preloadTimer); preloadTimer = undefined; }
  function trimCache() {
    const current = view().key;
    while (detailCache.size > maximumCachedSheets) {
      const stale = [...detailCache.keys()].find(key => key !== current);
      if (!stale) break;
      detailCache.delete(stale);
    }
  }
  async function loadDetail(target, prefetch = false) {
    if (!selectedExample || detailCache.has(target.key)) { invalidate(); return; }
    if (detailJobs.has(target.key)) return;
    if (!prefetch) {
      for (const [key, job] of detailJobs) if (key !== target.key) job.controller.abort();
    } else if (detailJobs.size || maximumCachedSheets < 2) return;
    const generation = request, id = selectedExample.id;
    const controller = new AbortController();
    const job = { controller };
    detailJobs.set(target.key, job);
    try {
      const sheet = await loadAtlas(loader, renderUrl(`views/detail/${id}-${target.level}-${target.part}.webp`),
        { signal: controller.signal, priority: prefetch ? 'low' : 'high' });
      if (generation !== request || controller.signal.aborted) return;
      if (sheet.naturalWidth !== 4608 || sheet.naturalHeight !== 3072) throw new Error('Invalid detailed view sheet.');
      if (maximumCachedSheets === 1 && target.key !== view().key && detailCache.has(view().key)) return;
      detailCache.set(target.key, sheet);
      trimCache();
      detailFailed = false;
      invalidate();
      if (!prefetch) {
        cancelPreload();
        preloadTimer = setTimeout(() => {
          if (generation !== request || document.hidden || interacting || constrained || maximumCachedSheets < 2) return;
          const current = view();
          const part = (current.part + direction + 4) % 4;
          loadDetail({ ...current, part, key: `${current.level}:${part}` }, true);
        }, 350);
      }
    } catch (error) {
      if (generation === request && error.name !== 'AbortError' && !prefetch) {
        detailFailed = true;
        invalidate();
        if (!preview && !detailCache.size) setGuide('Showing a still view.');
      }
    } finally {
      if (detailJobs.get(target.key) === job) detailJobs.delete(target.key);
    }
  }
  function scheduleDetail(delay = 150) {
    clearTimeout(detailTimer);
    cancelPreload();
    if (!selectedExample) return;
    detailTimer = setTimeout(() => { invalidate(); loadDetail(view()); }, delay);
  }
  function changed() {
    if (initializing) return;
    const target = view();
    const difference = MathUtils.euclideanModulo(target.a - lastAngle + 12, 24) - 12;
    if (Math.abs(difference) > 0.0001) direction = difference > 0 ? 1 : -1;
    lastAngle = target.a;
    idleAt = performance.now() + 150;
    invalidate(); scheduleDetail();
  }
  function resize() {
    const width = stage.clientWidth, height = stage.clientHeight;
    if (!width || !height) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const aspect = width / height;
    camera.right = Math.max(1, aspect); camera.left = -camera.right;
    camera.top = Math.max(1, 1 / aspect); camera.bottom = -camera.top;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    invalidate();
  }
  function start() { touched = interacting = true; cancelPreload(); clearTimeout(detailTimer); invalidate(); }
  function end() { interacting = false; idleAt = performance.now(); scheduleDetail(0); invalidate(); }
  controls.addEventListener('change', changed);
  controls.addEventListener('start', start);
  controls.addEventListener('end', end);
  if (typeof ResizeObserver === 'function') new ResizeObserver(resize).observe(stage);
  window.addEventListener('resize', resize);
  slider?.addEventListener('input', () => {
    touched = true;
    const angle = MathUtils.clamp(Number(slider.value), 0, 24);
    orbitCamera.position.setFromSphericalCoords(orbitCamera.position.length(), controls.getPolarAngle(), MathUtils.degToRad(-180 + angle * 15));
    controls.update(); changed();
  });
  slider?.addEventListener('pointerdown', start);
  slider?.addEventListener('pointerup', end);
  slider?.addEventListener('pointercancel', end);
  slider?.addEventListener('change', end);
  const steps = { ArrowLeft: [-15, 0], ArrowRight: [15, 0], ArrowUp: [0, 25], ArrowDown: [0, -25] };
  canvas.addEventListener('keydown', event => {
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault(); touched = true;
    orbitCamera.position.setFromSphericalCoords(orbitCamera.position.length(),
      MathUtils.clamp(controls.getPolarAngle() - MathUtils.degToRad(step[1]), controls.minPolarAngle, controls.maxPolarAngle),
      controls.getAzimuthalAngle() + MathUtils.degToRad(step[0]));
    controls.update(); idleAt = performance.now(); scheduleDetail(0); invalidate();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelPreload();
    else { invalidate(); scheduleDetail(0); }
  });

  return async example => {
    const generation = ++request;
    previewAbort?.abort();
    for (const job of detailJobs.values()) job.controller.abort();
    detailJobs.clear(); detailCache.clear();
    clearTimeout(detailTimer); cancelPreload();
    selectedExample = example; preview = null; detailFrame = ''; previewGeneration++;
    touched = interacting = detailFailed = false; idleAt = 0; lastPaint = 0;
    uniforms.detailMix.value = 0;
    canvas.hidden = true; canvas.style.opacity = '1'; poster.hidden = false;
    canvas.dataset.viewQuality = 'poster'; canvas.dataset.viewPixels = String(detailSize);
    setGuide('Loading views…');
    initializing = true;
    orbitCamera.position.setFromSphericalCoords(defaultDistance, MathUtils.degToRad(90 - (example.elevation ?? 25)), MathUtils.degToRad(example.azimuth));
    controls.update(); initializing = false; lastAngle = view().a;
    syncAngle(view()); resize();
    previewAbort = new AbortController();
    const signal = previewAbort.signal;
    const source = constrained ? `views/${example.id}.webp` : `views/preview/${example.id}.webp`;
    const previewPromise = loadAtlas(loader, renderUrl(source), { signal, priority: 'high' });
    scheduleDetail(0);
    try {
      let sheet;
      try { sheet = await previewPromise; }
      catch (error) {
        if (constrained || signal.aborted || generation !== request) throw error;
        sheet = await loadAtlas(loader, renderUrl(`views/${example.id}.webp`), { signal, priority: 'high' });
      }
      if (generation !== request || signal.aborted) return;
      const size = sheet.naturalWidth / 12;
      if (![256, 512].includes(size) || sheet.naturalHeight !== size * 10) throw new Error('Invalid preview sheet.');
      previewSize = size; preview = sheet; previewGeneration++;
      invalidate();
    } catch (error) {
      if (generation === request && error.name !== 'AbortError' && !detailCache.size) setGuide('Showing a still view.');
    }
  };
}
