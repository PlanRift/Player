import { useEffect, useRef } from 'react';

interface GenerativeThumbnailProps {
  seed: string;
  className?: string;
  size?: number;
}

function stringToSeed(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function GenerativeThumbnail({
  seed,
  className = '',
  size = 240,
}: GenerativeThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const seedNum = stringToSeed(seed);

    // Deep matte monochrome background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, size);
    bgGrad.addColorStop(0, '#16161a');
    bgGrad.addColorStop(1, '#0c0c0e');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, size, size);

    // Subtle framing border
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);

    // Subtle inner corner accents
    ctx.strokeStyle = '#3f3f46';
    ctx.lineWidth = 1;
    const cornerSize = 10;
    // Top-left
    ctx.beginPath();
    ctx.moveTo(12, 12 + cornerSize);
    ctx.lineTo(12, 12);
    ctx.lineTo(12 + cornerSize, 12);
    ctx.stroke();
    // Bottom-right
    ctx.beginPath();
    ctx.moveTo(size - 12 - cornerSize, size - 12);
    ctx.lineTo(size - 12, size - 12);
    ctx.lineTo(size - 12, size - 12 - cornerSize);
    ctx.stroke();

    // Technical header stamps
    ctx.font = '600 9px monospace';
    ctx.fillStyle = '#71717a';
    ctx.textAlign = 'left';
    ctx.fillText('DISCOVERY', 18, 24);

    ctx.textAlign = 'right';
    const seriesNum = (seedNum % 9) + 1;
    ctx.fillText(`SERIES // 0${seriesNum}`, size - 18, 24);

    // Center geometry: minimalist monochrome with subtle emerald green touch
    const cx = size / 2;
    const cy = size / 2 - 4;

    if (seed.includes('daylist')) {
      // Minimalist eclipse / horizon discs
      ctx.beginPath();
      ctx.arc(cx, cy, 46, 0, Math.PI * 2);
      ctx.fillStyle = '#1c1c21';
      ctx.fill();
      ctx.strokeStyle = '#3f3f46';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Shaded crescent
      ctx.beginPath();
      ctx.arc(cx - 14, cy, 38, 0, Math.PI * 2);
      ctx.fillStyle = '#121215';
      ctx.fill();

      // Delicate emerald accent ring
      ctx.beginPath();
      ctx.arc(cx, cy, 54, -0.6 * Math.PI, 0.4 * Math.PI);
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Emerald center focal point
      ctx.beginPath();
      ctx.arc(cx + 8, cy - 8, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#34d399';
      ctx.fill();
    } else if (seed.includes('discover-weekly')) {
      // Minimalist concentric orbital rings
      [22, 38, 54].forEach((radius, i) => {
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = i === 1 ? '#3f3f46' : '#27272a';
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      // Axis lines
      ctx.strokeStyle = '#27272a';
      ctx.beginPath();
      ctx.moveTo(cx - 60, cy);
      ctx.lineTo(cx + 60, cy);
      ctx.moveTo(cx, cy - 60);
      ctx.lineTo(cx, cy + 60);
      ctx.stroke();

      // Emerald orbit node
      const angle = (seedNum % 6) * 1.05;
      const nodeX = cx + Math.cos(angle) * 38;
      const nodeY = cy + Math.sin(angle) * 38;

      ctx.beginPath();
      ctx.arc(nodeX, nodeY, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#34d399';
      ctx.fill();
    } else if (seed.includes('release-radar')) {
      // Minimalist radar / soundwave arcs
      for (let r = 1; r <= 3; r++) {
        ctx.beginPath();
        ctx.arc(cx, cy + 18, r * 22, -0.85 * Math.PI, -0.15 * Math.PI);
        ctx.strokeStyle = r === 2 ? '#34d399' : '#3f3f46';
        ctx.lineWidth = r === 2 ? 1.5 : 1;
        ctx.stroke();
      }

      // Base transmitter line
      ctx.beginPath();
      ctx.moveTo(cx - 40, cy + 18);
      ctx.lineTo(cx + 40, cy + 18);
      ctx.strokeStyle = '#3f3f46';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Emerald transmitter point
      ctx.beginPath();
      ctx.arc(cx, cy + 18, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#34d399';
      ctx.fill();
    } else if (seed.includes('daily-mix')) {
      // 3x3 Bauhaus minimalist tile grid
      const tileSize = 20;
      const gap = 6;
      const startX = cx - (tileSize * 1.5 + gap);
      const startY = cy - (tileSize * 1.5 + gap);

      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const x = startX + c * (tileSize + gap);
          const y = startY + r * (tileSize + gap);
          const isAccent = r === 1 && c === 2;

          ctx.fillStyle = isAccent ? '#34d399' : (r + c) % 2 === 0 ? '#1f1f24' : '#141418';
          ctx.fillRect(x, y, tileSize, tileSize);

          ctx.strokeStyle = isAccent ? '#34d399' : '#27272a';
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, tileSize, tileSize);
        }
      }
    } else {
      // Minimalist vinyl groove record (On This Day / Default)
      ctx.beginPath();
      ctx.arc(cx, cy, 48, 0, Math.PI * 2);
      ctx.fillStyle = '#16161b';
      ctx.fill();
      ctx.strokeStyle = '#3f3f46';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Groove rings
      [22, 32, 42].forEach((radius) => {
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = '#27272a';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      });

      // Center spindle with subtle emerald dot
      ctx.beginPath();
      ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#222228';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#34d399';
      ctx.fill();
    }

    // Title label at bottom
    ctx.textAlign = 'center';
    ctx.font = '600 10px monospace';
    ctx.fillStyle = '#d4d4d8';

    let displayTitle = 'DISCOVERY';
    if (seed.includes('daylist')) displayTitle = 'DAYLIST';
    else if (seed.includes('discover-weekly')) displayTitle = 'DISCOVER WEEKLY';
    else if (seed.includes('release-radar')) displayTitle = 'RELEASE RADAR';
    else if (seed.includes('daily-mix')) displayTitle = 'DAILY MIX';
    else if (seed.includes('on-this-day')) displayTitle = 'ON THIS DAY';

    ctx.fillText(displayTitle, cx, size - 22);

    // Subtle emerald accent indicator dot
    ctx.beginPath();
    ctx.arc(cx, size - 12, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#34d399';
    ctx.fill();
  }, [seed, size]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%' }}
      className={`block object-cover ${className}`}
      aria-hidden="true"
    />
  );
}
