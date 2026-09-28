/* Shared helpers for host, player and admin pages. */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

const SHAPES = [
  '<svg viewBox="0 0 100 100"><polygon points="50,8 94,88 6,88" fill="currentColor" stroke="currentColor" stroke-width="8" stroke-linejoin="round"/></svg>',
  '<svg viewBox="0 0 100 100"><polygon points="50,6 94,50 50,94 6,50" fill="currentColor" stroke="currentColor" stroke-width="8" stroke-linejoin="round"/></svg>',
  '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="currentColor"/></svg>',
  '<svg viewBox="0 0 100 100"><rect x="10" y="10" width="80" height="80" rx="10" fill="currentColor"/></svg>',
];
const ANSWER_CLASSES = ['a-red', 'a-blue', 'a-yellow', 'a-green'];

function answerStyle(type, i) {
  if (type === 'truefalse') return i === 0 ? { cls: 'a-blue', shape: SHAPES[1] } : { cls: 'a-red', shape: SHAPES[0] };
  return { cls: ANSWER_CLASSES[i], shape: SHAPES[i] };
}

const AVATARS = ['🦉', '🐶', '🐱', '🐼', '🦊', '🐸', '🐵', '🦁', '🐯', '🐨', '🐰', '🐷', '🐙', '🦄', '🐢', '🐧', '🦖', '🐳', '🐝', '🦋', '🐻', '🐮', '🐤', '🦕'];
const CHIP_COLORS = ['#ff4d6d', '#3a86ff', '#ffbe0b', '#2ec4b6', '#8338ec', '#fb5607', '#06d6a0', '#ff006e'];

function colorFor(str) {
  let h = 0;
  for (const c of String(str)) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return CHIP_COLORS[h % CHIP_COLORS.length];
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function logoHtml(cls = '') {
  return `<div class="logo ${cls}">${[...'Quizzle'].map((c, i) => `<span style="--i:${i}">${c}</span>`).join('')}</div>`;
}

function bump(el, cls = 'bump') {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

function countUp(el, from, to, ms = 1200) {
  if (!el) return;
  const start = performance.now();
  const step = now => {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + (to - from) * eased).toLocaleString();
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function toast(msg, ms = 3200) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

/* Floating shapes in the background. */
function bgBubbles(n = 16) {
  const bg = document.createElement('div');
  bg.className = 'bg';
  const kinds = ['circle', 'square', 'triangle', 'diamond'];
  for (let i = 0; i < n; i++) {
    const s = document.createElement('span');
    const size = 30 + Math.random() * 90;
    s.className = 'bg-' + kinds[i % kinds.length];
    s.style.cssText = `left:${Math.random() * 100}%;width:${size}px;height:${size}px;` +
      `animation-duration:${16 + Math.random() * 18}s;animation-delay:-${Math.random() * 34}s`;
    bg.append(s);
  }
  document.body.prepend(bg);
}

/* Confetti: mode 'rain' falls from the top, 'cannon' shoots up from the bottom corners. */
const confetti = (() => {
  let canvas, ctx, parts = [], running = false;
  const COLORS = ['#ff4d6d', '#3a86ff', '#ffbe0b', '#2ec4b6', '#8338ec', '#fb5607', '#06d6a0', '#ff70a6'];

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'confetti';
    document.body.append(canvas);
    ctx = canvas.getContext('2d');
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    addEventListener('resize', resize);
    resize();
  }

  function tick() {
    const H = innerHeight;
    ctx.clearRect(0, 0, innerWidth, H);
    parts = parts.filter(p => p.y < H + 30);
    for (const p of parts) {
      p.vy = Math.min(p.vy + 0.18, 4.2);
      p.vx *= 0.985;
      p.x += p.vx + Math.sin(p.wob += 0.08) * 0.8;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.wob * 1.3));
      ctx.fillStyle = p.c;
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.r / 2, 0, Math.PI * 2); ctx.fill(); }
      else ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
      ctx.restore();
    }
    if (parts.length) requestAnimationFrame(tick);
    else { running = false; ctx.clearRect(0, 0, innerWidth, H); }
  }

  return function confetti({ count = 150, mode = 'rain' } = {}) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    ensureCanvas();
    const W = innerWidth, H = innerHeight;
    for (let i = 0; i < count; i++) {
      const p = { r: 7 + Math.random() * 7, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: pick(COLORS), wob: Math.random() * 10, round: Math.random() < 0.3 };
      if (mode === 'cannon') {
        const left = i % 2 === 0;
        Object.assign(p, { x: left ? 0 : W, y: H, vx: (left ? 1 : -1) * (3 + Math.random() * 9), vy: -(10 + Math.random() * 12) });
      } else {
        Object.assign(p, { x: Math.random() * W, y: -20 - Math.random() * H * 0.5, vx: (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 3 });
      }
      parts.push(p);
    }
    if (!running) { running = true; requestAnimationFrame(tick); }
  };
})();
