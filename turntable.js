import {
  CanvasTexture, ImageLoader, LinearFilter, LinearMipmapLinearFilter, MathUtils, Mesh, MeshBasicMaterial,
  OrthographicCamera, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { loadAtlas } from './atlas-loader.js';

const detailSize = 1536;
const detailColumns = 3;
const viewsPerSheet = 6;
const previewColumns = 12;
const previewRows = 10;
// Matches the still poster's 1 / 0.9 display scale, within every recorded view's frame.
const defaultDistance = 0.9;
const readyHint = 'Static pose · Drag to rotate the camera · Scroll or pinch to zoom';
export const renderUrl = path => `${path}?v=rounded-v1`;

export function createTurntable(stage, canvas, poster, guide, { slider, angleOutput } = {}) {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0xf9fbfc);
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  camera.position.z = 2;
  const material = new MeshBasicMaterial({ toneMapped: false });
  const image = new Mesh(new PlaneGeometry(2, 2), material);
  scene.add(image);

  const orbitCamera = new PerspectiveCamera();
  orbitCamera.position.z = defaultDistance;
  const controls = new OrbitControls(orbitCamera, canvas);
  controls.enablePan = false;
  controls.minDistance = 0.55;
  controls.maxDistance = 1.45;
  controls.minPolarAngle = MathUtils.degToRad(40);
  controls.maxPolarAngle = MathUtils.degToRad(140);
  const loader = new ImageLoader();
  const previewCanvas = document.createElement('canvas');
  const detailCanvas = document.createElement('canvas');
  detailCanvas.width = detailCanvas.height = detailSize;
  const previewContext = previewCanvas.getContext('2d', { alpha: false });
  const detailContext = detailCanvas.getContext('2d', { alpha: false });
  if (!previewContext || !detailContext) throw new Error('Canvas rendering is unavailable.');
  let previewTexture = textureFor(previewCanvas);
  const detailTexture = textureFor(detailCanvas);
  const detailCache = new Map();
  const maximumCachedSheets = window.matchMedia('(min-width: 740px)').matches ? 2 : 1;

  let request = 0;
  let selectedExample;
  let preview;
  let previewSize = 256;
  let previewFrame = -1;
  let detailFrame = '';
  let detailTimer;
  let queuedDetail;
  let loadingDetail = false;
  let interacted = false;
  let detailFailed = false;

  function textureFor(source) {
    const texture = new CanvasTexture(source);
    texture.colorSpace = SRGBColorSpace;
    texture.generateMipmaps = renderer.capabilities.isWebGL2 ||
      (MathUtils.isPowerOfTwo(source.width) && MathUtils.isPowerOfTwo(source.height));
    texture.minFilter = texture.generateMipmaps ? LinearMipmapLinearFilter : LinearFilter;
    texture.magFilter = LinearFilter;
    return texture;
  }

  function view() {
    const azimuth = MathUtils.radToDeg(controls.getAzimuthalAngle());
    const angle = MathUtils.euclideanModulo(Math.round((azimuth + 180) / 15), 24);
    const elevation = 90 - MathUtils.radToDeg(controls.getPolarAngle());
    const level = MathUtils.clamp(Math.round((elevation + 50) / 25), 0, 4);
    const part = Math.floor(angle / viewsPerSheet);
    return { angle, level, part, key: `${level}:${part}` };
  }

  function syncAngle(target = view()) {
    if (!slider) return;
    const degrees = -180 + target.angle * 15;
    slider.value = String(target.angle);
    slider.setAttribute('aria-valuetext', `${degrees} degrees`);
    slider.style.setProperty('--angle-progress', `${target.angle / 23 * 100}%`);
    slider.disabled = !preview && !detailCache.size;
    const angleLabel = `${degrees < 0 ? '−' : ''}${Math.abs(degrees)}°`;
    if (angleOutput && angleOutput.textContent !== angleLabel) angleOutput.textContent = angleLabel;
  }

  function setGuide(text) {
    if (guide.textContent !== text) guide.textContent = text;
  }

  function draw() {
    const target = view();
    syncAngle(target);
    const sheet = detailCache.get(target.key);
    if (sheet) {
      // Keep only the selected 1536px frame on the GPU, never a whole sheet.
      const frameKey = `${target.key}:${target.angle}`;
      if (detailFrame !== frameKey) {
        const index = target.angle % viewsPerSheet;
        detailContext.drawImage(sheet, (index % detailColumns) * detailSize,
          Math.floor(index / detailColumns) * detailSize, detailSize, detailSize,
          0, 0, detailSize, detailSize);
        detailTexture.needsUpdate = true;
        detailFrame = frameKey;
      }
      material.map = detailTexture;
      detailCache.delete(target.key);
      detailCache.set(target.key, sheet);
      canvas.dataset.viewQuality = 'detail';
      canvas.dataset.viewPixels = String(detailSize);
    } else if (preview) {
      const frame = target.level * 24 + target.angle;
      if (previewFrame !== frame) {
        previewContext.drawImage(preview, (frame % previewColumns) * previewSize,
          Math.floor(frame / previewColumns) * previewSize, previewSize, previewSize,
          0, 0, previewSize, previewSize);
        previewTexture.needsUpdate = true;
        previewFrame = frame;
      }
      material.map = previewTexture;
      canvas.dataset.viewQuality = 'preview';
      canvas.dataset.viewPixels = String(previewSize);
    } else return;

    canvas.dataset.viewFrame = `${target.level}:${target.angle}`;
    material.needsUpdate = true;
    image.scale.setScalar(1 / orbitCamera.position.length());
    renderer.render(scene, camera);
    // The crisp poster stays visible while the first detailed frame loads.
    if (sheet || interacted || detailFailed) {
      canvas.hidden = false;
      poster.hidden = true;
      setGuide(detailFailed && !sheet
        ? 'Preview views · Drag to rotate · Detailed view unavailable'
        : readyHint);
    }
  }

  function cancelDetailQueue() {
    clearTimeout(detailTimer);
    queuedDetail = null;
  }

  function scheduleDetail(delay = 80) {
    clearTimeout(detailTimer);
    if (!selectedExample) return;
    const target = view();
    if (detailCache.has(target.key)) {
      queuedDetail = null;
      return;
    }
    detailTimer = setTimeout(() => {
      queuedDetail = { ...view(), request, id: selectedExample.id };
      loadQueuedDetail();
    }, delay);
  }

  async function loadQueuedDetail() {
    if (loadingDetail || !queuedDetail) return;
    const target = queuedDetail;
    queuedDetail = null;
    if (target.request !== request || detailCache.has(target.key)) return;
    loadingDetail = true;
    try {
      const sheet = await loadAtlas(loader, renderUrl(`views/detail/${target.id}-${target.level}-${target.part}.webp`));
      if (target.request !== request) return;
      if (sheet.naturalWidth !== detailSize * detailColumns || sheet.naturalHeight !== detailSize * 2) {
        throw new Error('Invalid detailed view sheet.');
      }
      const currentKey = view().key;
      if (target.key !== currentKey && maximumCachedSheets === 1 && detailCache.has(currentKey)) return;
      detailCache.set(target.key, sheet);
      while (detailCache.size > maximumCachedSheets) detailCache.delete(detailCache.keys().next().value);
      detailFailed = false;
      draw();
      if (!detailCache.has(view().key)) scheduleDetail(0);
    } catch {
      if (target.request === request) {
        detailFailed = true;
        draw();
      }
    } finally {
      loadingDetail = false;
      loadQueuedDetail();
    }
  }

  function resize() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
    const aspect = width / height;
    camera.right = Math.max(1, aspect);
    camera.left = -camera.right;
    camera.top = Math.max(1, 1 / aspect);
    camera.bottom = -camera.top;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    draw();
  }

  controls.addEventListener('change', () => { draw(); scheduleDetail(); });
  controls.addEventListener('start', () => { interacted = true; cancelDetailQueue(); });
  controls.addEventListener('end', () => scheduleDetail(0));
  new ResizeObserver(resize).observe(stage);
  window.addEventListener('resize', resize);
  slider?.addEventListener('input', () => {
    interacted = true;
    const angle = MathUtils.clamp(Number(slider.value), 0, 23);
    orbitCamera.position.setFromSphericalCoords(orbitCamera.position.length(),
      controls.getPolarAngle(), MathUtils.degToRad(-180 + angle * 15));
    controls.update();
    scheduleDetail(0);
  });
  const steps = { ArrowLeft: [-15, 0], ArrowRight: [15, 0], ArrowUp: [0, 25], ArrowDown: [0, -25] };
  canvas.addEventListener('keydown', event => {
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    interacted = true;
    orbitCamera.position.setFromSphericalCoords(orbitCamera.position.length(),
      MathUtils.clamp(controls.getPolarAngle() - MathUtils.degToRad(step[1]), controls.minPolarAngle, controls.maxPolarAngle),
      controls.getAzimuthalAngle() + MathUtils.degToRad(step[0]));
    controls.update();
    scheduleDetail(0);
  });

  return async example => {
    const currentRequest = ++request;
    selectedExample = example;
    cancelDetailQueue();
    detailCache.clear();
    preview = null;
    previewFrame = -1;
    detailFrame = '';
    interacted = detailFailed = false;
    canvas.hidden = true;
    poster.hidden = false;
    canvas.dataset.viewQuality = 'poster';
    canvas.dataset.viewPixels = String(detailSize);
    setGuide('Loading detailed views…');
    orbitCamera.position.setFromSphericalCoords(defaultDistance, MathUtils.degToRad(90 - (example.elevation ?? 25)), MathUtils.degToRad(example.azimuth));
    controls.update();
    syncAngle();
    scheduleDetail(0);
    // Large preview sheets stay in CPU memory and only one cropped tile is uploaded.
    const desktop = window.matchMedia('(min-width: 740px)').matches;
    const source = desktop ? `views/preview/${example.id}.webp` : `views/${example.id}.webp`;
    try {
      let sheet;
      try {
        sheet = await loadAtlas(loader, renderUrl(source));
      } catch (error) {
        if (!desktop || currentRequest !== request) throw error;
        sheet = await loadAtlas(loader, renderUrl(`views/${example.id}.webp`));
      }
      if (currentRequest !== request) return;
      const size = sheet.naturalWidth / previewColumns;
      if (![256, 512].includes(size) || sheet.naturalHeight !== previewRows * size) throw new Error('Invalid preview sheet.');
      previewSize = size;
      if (previewCanvas.width !== size) {
        previewTexture.dispose();
        previewCanvas.width = previewCanvas.height = size;
        previewTexture = textureFor(previewCanvas);
      }
      previewTexture.needsUpdate = true;
      preview = sheet;
      resize();
    } catch {
      if (currentRequest === request && !detailCache.size) setGuide('Showing a still view.');
    }
  };
}
