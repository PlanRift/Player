// Plenrip Audio — Off-Main-Thread Palette Extraction Worker (MMCQ)
// Extracts an 8-color RGB palette from album cover art off the UI thread.
// Falls back cleanly via { id, colors: null, error } if fetch/CORS/OffscreenCanvas fails.

const SIGBITS = 5;
const RSHIFT = 8 - SIGBITS;
const HISTO_SIZE = 1 << (3 * SIGBITS);
const MAX_ITERATIONS = 1000;
const FRACT_BY_POPULATION = 0.75;
const QUALITY = 5;
const COLOR_COUNT = 8;

function colorIndex(r, g, b) {
  return (r << (2 * SIGBITS)) + (g << SIGBITS) + b;
}

function naturalOrder(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function vboxVolume(vbox) {
  if (vbox._volume === undefined) {
    vbox._volume =
      (vbox.r2 - vbox.r1 + 1) * (vbox.g2 - vbox.g1 + 1) * (vbox.b2 - vbox.b1 + 1);
  }
  return vbox._volume;
}

function vboxCount(vbox) {
  if (vbox._count === undefined) {
    const histo = vbox.histo;
    let count = 0;
    for (let r = vbox.r1; r <= vbox.r2; r++) {
      for (let g = vbox.g1; g <= vbox.g2; g++) {
        for (let b = vbox.b1; b <= vbox.b2; b++) {
          count += histo[colorIndex(r, g, b)] || 0;
        }
      }
    }
    vbox._count = count;
  }
  return vbox._count;
}

function vboxCopy(vbox) {
  return {
    r1: vbox.r1,
    r2: vbox.r2,
    g1: vbox.g1,
    g2: vbox.g2,
    b1: vbox.b1,
    b2: vbox.b2,
    histo: vbox.histo,
    _volume: undefined,
    _count: undefined,
    _avg: undefined,
  };
}

function vboxAvg(vbox) {
  if (!vbox._avg) {
    const histo = vbox.histo;
    const mult = 1 << (8 - SIGBITS);
    let ntot = 0;
    let rsum = 0;
    let gsum = 0;
    let bsum = 0;
    for (let r = vbox.r1; r <= vbox.r2; r++) {
      for (let g = vbox.g1; g <= vbox.g2; g++) {
        for (let b = vbox.b1; b <= vbox.b2; b++) {
          const hval = histo[colorIndex(r, g, b)] || 0;
          ntot += hval;
          rsum += hval * (r + 0.5) * mult;
          gsum += hval * (g + 0.5) * mult;
          bsum += hval * (b + 0.5) * mult;
        }
      }
    }
    if (ntot) {
      vbox._avg = [
        Math.floor(rsum / ntot),
        Math.floor(gsum / ntot),
        Math.floor(bsum / ntot),
      ];
    } else {
      vbox._avg = [
        Math.floor((mult * (vbox.r1 + vbox.r2 + 1)) / 2),
        Math.floor((mult * (vbox.g1 + vbox.g2 + 1)) / 2),
        Math.floor((mult * (vbox.b1 + vbox.b2 + 1)) / 2),
      ];
    }
  }
  return vbox._avg;
}

class PQueue {
  constructor(comparator) {
    this.comparator = comparator;
    this.items = [];
    this.sorted = false;
  }
  sort() {
    this.items.sort(this.comparator);
    this.sorted = true;
  }
  push(vbox) {
    this.items.push(vbox);
    this.sorted = false;
  }
  pop() {
    if (!this.sorted) this.sort();
    return this.items.pop();
  }
  size() {
    return this.items.length;
  }
}

function medianCutApply(histo, vbox) {
  if (!vboxCount(vbox)) return null;
  if (vboxCount(vbox) === 1) return [vboxCopy(vbox)];
  const rw = vbox.r2 - vbox.r1 + 1;
  const gw = vbox.g2 - vbox.g1 + 1;
  const bw = vbox.b2 - vbox.b1 + 1;
  const maxw = Math.max(rw, gw, bw);
  let total = 0;
  const partialsum = {};
  const lookaheadsum = {};

  if (maxw === rw) {
    for (let i = vbox.r1; i <= vbox.r2; i++) {
      let sum = 0;
      for (let j = vbox.g1; j <= vbox.g2; j++) {
        for (let k = vbox.b1; k <= vbox.b2; k++) {
          sum += histo[colorIndex(i, j, k)] || 0;
        }
      }
      total += sum;
      partialsum[i] = total;
    }
  } else if (maxw === gw) {
    for (let i = vbox.g1; i <= vbox.g2; i++) {
      let sum = 0;
      for (let j = vbox.r1; j <= vbox.r2; j++) {
        for (let k = vbox.b1; k <= vbox.b2; k++) {
          sum += histo[colorIndex(j, i, k)] || 0;
        }
      }
      total += sum;
      partialsum[i] = total;
    }
  } else {
    for (let i = vbox.b1; i <= vbox.b2; i++) {
      let sum = 0;
      for (let j = vbox.r1; j <= vbox.r2; j++) {
        for (let k = vbox.g1; k <= vbox.g2; k++) {
          sum += histo[colorIndex(j, k, i)] || 0;
        }
      }
      total += sum;
      partialsum[i] = total;
    }
  }

  for (const key of Object.keys(partialsum)) {
    const k = Number(key);
    lookaheadsum[k] = total - partialsum[k];
  }

  const doCut = (axis) => {
    const dim1 = `${axis}1`;
    const dim2 = `${axis}2`;
    for (let i = vbox[dim1]; i <= vbox[dim2]; i++) {
      if ((partialsum[i] ?? 0) > total / 2) {
        const vbox1 = vboxCopy(vbox);
        const vbox2 = vboxCopy(vbox);
        const left = i - vbox[dim1];
        const right = vbox[dim2] - i;
        let d2;
        if (left <= right) {
          d2 = Math.min(vbox[dim2] - 1, Math.floor(i + right / 2));
        } else {
          d2 = Math.max(vbox[dim1], Math.floor(i - 1 - left / 2));
        }
        while (!partialsum[d2]) d2++;
        let count2 = lookaheadsum[d2];
        while (!count2 && partialsum[d2 - 1]) count2 = lookaheadsum[--d2];
        vbox1[dim2] = d2;
        vbox2[dim1] = vbox1[dim2] + 1;
        return [vbox1, vbox2];
      }
    }
    return null;
  };

  return maxw === rw ? doCut('r') : maxw === gw ? doCut('g') : doCut('b');
}

function iter(pq, target, histo) {
  let ncolors = pq.size();
  let niters = 0;
  while (niters < MAX_ITERATIONS) {
    if (ncolors >= target) return;
    const vbox = pq.pop();
    if (!vbox) return;
    if (!vboxCount(vbox)) {
      pq.push(vbox);
      niters++;
      continue;
    }
    const vboxes = medianCutApply(histo, vbox);
    if (!vboxes || !vboxes[0]) return;
    pq.push(vboxes[0]);
    if (vboxes[1]) {
      pq.push(vboxes[1]);
      ncolors++;
    }
    niters++;
  }
}

function quantize(pixels, maxColorCount) {
  if (!pixels.length || maxColorCount < 2 || maxColorCount > 256) return null;
  const histo = new Int32Array(HISTO_SIZE);
  let rmin = 31;
  let rmax = 0;
  let gmin = 31;
  let gmax = 0;
  let bmin = 31;
  let bmax = 0;

  for (let i = 0; i < pixels.length; i++) {
    const [r, g, b] = pixels[i];
    const rr = r >> RSHIFT;
    const gg = g >> RSHIFT;
    const bb = b >> RSHIFT;
    histo[colorIndex(rr, gg, bb)]++;
    if (rr < rmin) rmin = rr;
    if (rr > rmax) rmax = rr;
    if (gg < gmin) gmin = gg;
    if (gg > gmax) gmax = gg;
    if (bb < bmin) bmin = bb;
    if (bb > bmax) bmax = bb;
  }

  const vbox = { r1: rmin, r2: rmax, g1: gmin, g2: gmax, b1: bmin, b2: bmax, histo };
  const pq = new PQueue((a, b) => naturalOrder(vboxCount(a), vboxCount(b)));
  pq.push(vbox);
  iter(pq, FRACT_BY_POPULATION * maxColorCount, histo);

  const pq2 = new PQueue((a, b) =>
    naturalOrder(vboxCount(a) * vboxVolume(a), vboxCount(b) * vboxVolume(b))
  );
  while (pq.size()) {
    const v = pq.pop();
    if (v) pq2.push(v);
  }
  iter(pq2, maxColorCount, histo);

  const palette = [];
  while (pq2.size()) {
    const v = pq2.pop();
    if (v) palette.push(vboxAvg(v));
  }
  return palette;
}

self.onmessage = async (event) => {
  const { id, url } = event.data || {};
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    try {
      const maxDim = 96;
      const scale = Math.min(1, maxDim / Math.max(1, bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No 2D context');
      ctx.drawImage(bitmap, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      const pixels = [];
      const total = w * h;
      const step = Math.max(1, scale < 1 ? 2 : QUALITY);
      for (let i = 0; i < total; i += step) {
        const o = i * 4;
        const a = data[o + 3];
        const r = data[o];
        const g = data[o + 1];
        const b = data[o + 2];
        if (a !== undefined && a < 125) continue;
        if (r > 250 && g > 250 && b > 250) continue;
        pixels.push([r, g, b]);
      }
      const colors = quantize(pixels, COLOR_COUNT);
      self.postMessage({ id, colors });
    } finally {
      bitmap.close();
    }
  } catch (err) {
    self.postMessage({
      id,
      colors: null,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
