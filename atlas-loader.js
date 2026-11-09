// Classic script requests work in an opaque sandbox without CORS image access.
const pending = new Map();
const decoding = new Map();

globalThis.__graspAtlasReceive = (path, dataUrl) => {
  const request = pending.get(path);
  if (!request) return;
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/webp;base64,')) {
    request.reject(new Error('Invalid recorded view data.'));
    return;
  }
  request.received = true;
  request.resolve(dataUrl);
};

function scriptData(source) {
  const separator = source.indexOf('?');
  const path = separator < 0 ? source : source.slice(0, separator);
  const query = separator < 0 ? '' : source.slice(separator);
  if (!/^views\/(?:preview\/|detail\/)?[a-z0-9-]+\.webp$/.test(path)) {
    return Promise.reject(new Error('Invalid recorded view path.'));
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const request = { resolve, reject, received: false };
    pending.set(path, request);
    const cleanup = () => {
      clearTimeout(timeout);
      pending.delete(path);
      script.remove();
    };
    script.async = true;
    // Deliberately omit crossorigin: this is a classic no-CORS script request.
    script.src = `${path}.js${query}`;
    script.onload = () => {
      if (!request.received) reject(new Error('Recorded view payload is unavailable.'));
      cleanup();
    };
    script.onerror = () => { cleanup(); reject(new Error('Recorded view could not be loaded.')); };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Recorded view request timed out.'));
    }, 45000);
    document.head.append(script);
  });
}

export function loadAtlas(loader, source) {
  if (decoding.has(source)) return decoding.get(source);
  const result = scriptData(source).then(dataUrl => loader.loadAsync(dataUrl))
    .finally(() => decoding.delete(source));
  decoding.set(source, result);
  return result;
}
