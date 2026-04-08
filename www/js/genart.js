/**
 * Generative artwork for tracks without cover art
 * @module genart
 */

let animationId = null;
let currentCanvas = null;

/**
 * Simple string hash → number
 */
function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Derive HSL color from hash with constrained saturation/lightness
 */
function hashColor(seed, offset) {
  const hue = (seed + offset * 137) % 360;
  const sat = 30 + (seed + offset * 53) % 40; // 30-70%
  const lit = 15 + (seed + offset * 29) % 25;  // 15-40% — keep dark
  return `hsl(${hue}, ${sat}%, ${lit}%)`;
}

/**
 * Start generative art animation on a canvas
 * @param {HTMLCanvasElement} canvas
 * @param {Object} track - Track object with title, artist, album
 */
export function startGenArt(canvas, track) {
  stopGenArt();
  currentCanvas = canvas;

  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const seed = hash(`${track.title || ''}${track.artist || ''}${track.album || ''}`);

  // Derive 3 colors and blob parameters from seed
  const colors = [hashColor(seed, 0), hashColor(seed, 1), hashColor(seed, 2)];
  const blobCount = 3 + (seed % 3); // 3-5 blobs
  const blobs = [];

  for (let i = 0; i < blobCount; i++) {
    const s = seed + i * 1000;
    blobs.push({
      cx: (s % 100) / 100,           // center x (0-1)
      cy: ((s >> 3) % 100) / 100,    // center y (0-1)
      rx: 0.15 + ((s >> 6) % 30) / 100,  // radius x
      ry: 0.15 + ((s >> 9) % 30) / 100,  // radius y
      speed: 0.0003 + ((s >> 12) % 10) / 30000, // animation speed
      phase: ((s >> 15) % 100) / 100 * Math.PI * 2,
      color: colors[i % colors.length]
    });
  }

  function draw(time) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);

    for (const blob of blobs) {
      const t = time * blob.speed + blob.phase;
      const x = (blob.cx + Math.sin(t) * 0.15) * size;
      const y = (blob.cy + Math.cos(t * 0.7) * 0.15) * size;
      const rx = blob.rx * size * (0.8 + Math.sin(t * 1.3) * 0.2);
      const ry = blob.ry * size * (0.8 + Math.cos(t * 0.9) * 0.2);

      const gradient = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
      gradient.addColorStop(0, blob.color);
      gradient.addColorStop(1, 'transparent');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, t * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    animationId = requestAnimationFrame(draw);
  }

  animationId = requestAnimationFrame(draw);
}

/**
 * Stop generative art animation
 */
export function stopGenArt() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  currentCanvas = null;
}
