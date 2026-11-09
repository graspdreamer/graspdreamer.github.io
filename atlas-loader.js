// Classic no-CORS scripts supply origin-clean image data to shared subscribers.
const pending = new Map();
const abortError = () => Object.assign(new Error('Recorded view request cancelled.'), { name: 'AbortError' });

function finish(entry, error, image) {
  if (entry.done) return;
  entry.done = true;
  clearTimeout(entry.timeout);
  entry.script.onload = entry.script.onerror = null;
  entry.script.remove();
  if (pending.get(entry.path) === entry) pending.delete(entry.path);
  for (const subscriber of entry.subscribers) {
    subscriber.signal?.removeEventListener('abort', subscriber.abort);
    if (error) subscriber.reject(error);
    else subscriber.resolve(image);
  }
  entry.subscribers.clear();
}

globalThis.__graspAtlasReceive = (path, dataUrl) => {
  const entry = pending.get(path);
  if (!entry || entry.done || entry.received) return;
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/webp;base64,')) {
    finish(entry, new Error('Invalid recorded view data.'));
    return;
  }
  entry.received = true;
  entry.loader.loadAsync(dataUrl).then(
    image => finish(entry, null, image),
    () => finish(entry, new Error('Recorded view could not be decoded.')),
  );
};

export function loadAtlas(loader, source, { signal, priority = 'auto' } = {}) {
  if (signal?.aborted) return Promise.reject(abortError());
  const separator = source.indexOf('?');
  const path = separator < 0 ? source : source.slice(0, separator);
  const query = separator < 0 ? '' : source.slice(separator);
  if (!/^views\/(?:preview\/|detail\/)?[a-z0-9-]+\.webp$/.test(path)) {
    return Promise.reject(new Error('Invalid recorded view path.'));
  }
  let entry = pending.get(path);
  const fresh = !entry;
  if (fresh) {
    entry = { path, loader, script: document.createElement('script'), subscribers: new Set(), received: false, done: false };
    pending.set(path, entry);
  }
  const result = new Promise((resolve, reject) => {
    const subscriber = { resolve, reject, signal, abort: null };
    subscriber.abort = () => {
      if (!entry.subscribers.delete(subscriber)) return;
      signal?.removeEventListener('abort', subscriber.abort);
      reject(abortError());
      if (!entry.subscribers.size) finish(entry, abortError());
    };
    entry.subscribers.add(subscriber);
    signal?.addEventListener('abort', subscriber.abort, { once: true });
  });
  if (fresh) {
    const script = entry.script;
    script.async = true;
    script.fetchPriority = priority;
    script.src = `${path}.js${query}`;
    script.onload = () => {
      script.remove();
      if (!entry.received) finish(entry, new Error('Recorded view payload is unavailable.'));
    };
    script.onerror = () => finish(entry, new Error('Recorded view could not be loaded.'));
    entry.timeout = setTimeout(() => finish(entry, new Error('Recorded view request timed out.')), 45000);
    document.head.append(script);
  }
  return result;
}
