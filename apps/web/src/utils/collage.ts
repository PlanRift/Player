const collageCache = new Map<string, string>();

export function createMonochromePlaceholderDataUrl(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
    <rect width="200" height="200" fill="#18181b"/>
    <rect x="0.5" y="0.5" width="199" height="199" fill="none" stroke="#3f3f46" stroke-width="1"/>
    <rect x="75" y="75" width="50" height="50" fill="none" stroke="#71717a" stroke-width="1.5"/>
    <line x1="100" y1="88" x2="100" y2="112" stroke="#71717a" stroke-width="1.5"/>
    <line x1="88" y1="100" x2="112" y2="100" stroke="#71717a" stroke-width="1.5"/>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/**
 * Generates a sharp 2x2 cover collage rendered at 2x resolution (default 400x400)
 * using HTML5 Canvas with zero dependencies.
 * Caches generated data URLs in memory by cacheKey.
 */
export async function getCollageDataUrl(
  coverUrls: string[],
  cacheKey: string,
  size = 400
): Promise<string> {
  const validUrls = coverUrls.filter(Boolean);

  if (validUrls.length === 0) {
    return createMonochromePlaceholderDataUrl();
  }

  if (validUrls.length === 1) {
    return validUrls[0];
  }

  const existing = collageCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  // Normalize slots to exactly 4
  let slots: string[];
  if (validUrls.length >= 4) {
    slots = validUrls.slice(0, 4);
  } else if (validUrls.length === 3) {
    slots = [validUrls[0], validUrls[1], validUrls[2], validUrls[0]];
  } else {
    // 2 urls
    slots = [validUrls[0], validUrls[1], validUrls[1], validUrls[0]];
  }

  if (typeof document === 'undefined') {
    return validUrls[0];
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return validUrls[0];
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Base background in zinc-900 (#18181b)
  ctx.fillStyle = '#18181b';
  ctx.fillRect(0, 0, size, size);

  const half = size / 2;
  const positions = [
    { x: 0, y: 0 },
    { x: half, y: 0 },
    { x: 0, y: half },
    { x: half, y: half },
  ];

  const loadedImages = await Promise.allSettled(slots.map((url) => loadImage(url)));

  loadedImages.forEach((result, idx) => {
    const { x, y } = positions[idx];
    if (result.status === 'fulfilled') {
      ctx.drawImage(result.value, x, y, half, half);
    } else {
      // Fallback quadrant with zinc tones
      ctx.fillStyle = idx % 2 === 0 ? '#18181b' : '#27272a';
      ctx.fillRect(x, y, half, half);
      ctx.strokeStyle = '#3f3f46';
      ctx.strokeRect(x + 0.5, y + 0.5, half - 1, half - 1);
    }
  });

  // 1px hairline center dividers
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(half, 0);
  ctx.lineTo(half, size);
  ctx.moveTo(0, half);
  ctx.lineTo(size, half);
  ctx.stroke();

  // Outer hairline border matching zinc-700
  ctx.strokeStyle = 'rgba(63, 63, 70, 0.8)';
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);

  try {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    collageCache.set(cacheKey, dataUrl);
    return dataUrl;
  } catch {
    return validUrls[0];
  }
}
