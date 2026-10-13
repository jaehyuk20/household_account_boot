/*
 * 움직임: 스프링 이징, 오도미터, 타자기, 픽셀 파티클, 섬 풍경
 */
(function (global) {
  'use strict';

  const S = global.Sprites;
  const mqReduce = global.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => mqReduce.matches;

  /* ───────── 스프링 이징 ─────────
   * 감쇠 스프링을 시뮬레이션해서 CSS linear() 곡선으로 만듭니다. */
  function springCurve(stiffness, damping) {
    const dt = 1 / 240;
    let x = 0;
    let v = 0;
    let t = 0;
    const samples = [0];
    while (t < 3) {
      const a = -stiffness * (x - 1) - damping * v;
      v += a * dt;
      x += v * dt;
      t += dt;
      samples.push(x);
      if (t > 0.25 && Math.abs(x - 1) < 0.002 && Math.abs(v) < 0.02) break;
    }
    const n = 40;
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(+samples[Math.round((i * (samples.length - 1)) / n)].toFixed(4));
    pts[n] = 1;
    return { easing: `linear(${pts.join(', ')})`, duration: Math.round(t * 1000) };
  }
  const hasLinear = !!(global.CSS && CSS.supports && CSS.supports('animation-timing-function', 'linear(0, 1)'));
  const SPRING = hasLinear ? springCurve(210, 17) : { easing: 'cubic-bezier(.34,1.56,.64,1)', duration: 650 };
  const SPRING_SOFT = hasLinear ? springCurve(150, 19) : { easing: 'cubic-bezier(.22,1,.36,1)', duration: 650 };
  const EASE_OUT = 'cubic-bezier(.22,1,.36,1)';
  const EASE_IN = 'cubic-bezier(.55,0,.75,.2)';

  function animate(el, keyframes, opts) {
    if (!el || !el.animate) return null;
    const o = Object.assign({}, opts);
    if (reduced()) {
      o.duration = 1;
      o.delay = 0;
    }
    return el.animate(keyframes, o);
  }

  /* ───────── 오도미터 ───────── */
  class Odometer {
    constructor(el) {
      this.el = el;
      this.text = '';
    }
    set(value, { instant = false, delay = 0 } = {}) {
      const text = Math.abs(Math.round(value)).toLocaleString('ko-KR');
      const prevDigits = this.text.replace(/\D/g, '');
      const nextDigits = text.replace(/\D/g, '');
      this.text = text;
      const el = this.el;
      el.textContent = '';
      const cols = [];
      let di = 0;
      for (const ch of text) {
        if (ch >= '0' && ch <= '9') {
          const fromRight = nextDigits.length - 1 - di;
          const prevIdx = prevDigits.length - 1 - fromRight;
          const from = prevIdx >= 0 ? +prevDigits[prevIdx] : 0;
          const col = document.createElement('span');
          col.className = 'odo-col';
          const strip = document.createElement('span');
          strip.className = 'odo-strip';
          for (let d = 0; d <= 9; d++) {
            const s = document.createElement('span');
            s.textContent = d;
            strip.appendChild(s);
          }
          strip.style.setProperty('--d', ch);
          col.appendChild(strip);
          el.appendChild(col);
          cols.push({ strip, from, to: +ch });
          di++;
        } else {
          const sep = document.createElement('span');
          sep.className = 'odo-sep';
          sep.textContent = ch;
          el.appendChild(sep);
        }
      }
      if (instant || reduced()) return;
      // CSS 전환은 문서를 처음 읽는 동안 시작되지 않을 수 있어서 Web Animations로 굴립니다
      const n = cols.length;
      cols.forEach((c, i) => {
        if (c.from === c.to) return;
        c.strip.animate(
          [{ transform: `translateY(${(-c.from * 1.2).toFixed(2)}em)` }, { transform: `translateY(${(-c.to * 1.2).toFixed(2)}em)` }],
          { duration: 650 + (n - i) * 45, delay: delay + i * 45, easing: EASE_OUT, fill: 'backwards' }
        );
      });
    }
  }

  /* 작은 숫자는 부드럽게 세어 올립니다 */
  function countUp(el, from, to, { duration = 800, delay = 0, format = (n) => n.toLocaleString('ko-KR') } = {}) {
    if (el._raf) cancelAnimationFrame(el._raf);
    clearTimeout(el._cuTimer);
    if (reduced() || from === to) {
      el.textContent = format(to);
      return;
    }
    const start = () => {
      const t0 = performance.now();
      const tick = (now) => {
        const p = Math.min(1, (now - t0) / duration);
        const e = 1 - Math.pow(1 - p, 3);
        el.textContent = format(Math.round(from + (to - from) * e));
        if (p < 1) el._raf = requestAnimationFrame(tick);
      };
      el._raf = requestAnimationFrame(tick);
    };
    if (delay) el._cuTimer = setTimeout(start, delay);
    else start();
  }

  /* ───────── 타자기 ─────────
   * 전체 문장을 먼저 배치해 두고 글자를 하나씩 드러내서, 줄바꿈이 중간에 튀지 않게 합니다. */
  function typewriter(el, text, { speed = 32, onDone } = {}) {
    if (el._tw) el._tw.cancel();
    el.textContent = '';
    const chars = [];
    for (const token of text.split(/(\s+)/)) {
      if (!token) continue;
      if (/^\s+$/.test(token)) {
        el.appendChild(document.createTextNode(' '));
        continue;
      }
      const w = document.createElement('span');
      w.className = 'w';
      for (const ch of Array.from(token)) {
        const s = document.createElement('span');
        s.className = 'ch';
        s.textContent = ch;
        w.appendChild(s);
        chars.push(s);
      }
      el.appendChild(w);
    }
    let i = 0;
    let timer = 0;
    let done = false;
    const finish = () => {
      done = true;
      if (onDone) onDone();
    };
    const revealAll = () => {
      for (; i < chars.length; i++) {
        chars[i].style.animation = 'none';
        chars[i].classList.add('on');
      }
    };
    const step = () => {
      if (i >= chars.length) return finish();
      const s = chars[i++];
      s.classList.add('on');
      timer = setTimeout(step, /[.!?,~…]/.test(s.textContent) ? speed * 6 : speed);
    };
    const ctrl = {
      get done() {
        return done;
      },
      skip() {
        if (done) return;
        clearTimeout(timer);
        revealAll();
        finish();
      },
      cancel() {
        clearTimeout(timer);
        done = true;
      },
    };
    el._tw = ctrl;
    if (reduced()) {
      revealAll();
      finish();
    } else step();
    return ctrl;
  }

  /* ───────── 픽셀 파티클 ─────────
   * 화면의 1/3 해상도 캔버스에 그린 뒤 3배로 키워서 진짜 픽셀처럼 보이게 합니다. */
  const PX = 3;
  const layers = {};
  const bmpCache = new Map();

  function bitmap(name, frame = 0, pal = null) {
    const key = name + '|' + frame + '|' + (pal ? JSON.stringify(pal) : '');
    let c = bmpCache.get(key);
    if (c) return c;
    const g = S.grid(name, frame);
    c = document.createElement('canvas');
    c.width = g[0].length;
    c.height = g.length;
    const x = c.getContext('2d');
    for (const [px, py, len, col] of S.pixels(name, frame, pal)) {
      x.fillStyle = col;
      x.fillRect(px, py, len, 1);
    }
    bmpCache.set(key, c);
    return c;
  }

  function setupLayer(id) {
    const canvas = document.getElementById(id);
    if (!canvas) return null;
    const layer = { canvas, ctx: canvas.getContext('2d'), parts: [], w: 0, h: 0 };
    layers[id] = layer;
    resizeLayer(layer);
    return layer;
  }
  function resizeLayer(layer) {
    const w = Math.ceil(global.innerWidth / PX);
    const h = Math.ceil(global.innerHeight / PX);
    if (w === layer.w && h === layer.h) return;
    layer.w = w;
    layer.h = h;
    layer.canvas.width = w;
    layer.canvas.height = h;
    layer.canvas.style.width = w * PX + 'px';
    layer.canvas.style.height = h * PX + 'px';
    layer.ctx.imageSmoothingEnabled = false;
  }

  let rafId = 0;
  let last = 0;
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    let alive = false;
    for (const layer of Object.values(layers)) {
      const { ctx } = layer;
      ctx.clearRect(0, 0, layer.w, layer.h);
      layer.parts = layer.parts.filter((p) => p.update(dt, layer) !== false);
      for (const p of layer.parts) p.draw(ctx, layer);
      if (layer.parts.length) alive = true;
    }
    rafId = alive ? requestAnimationFrame(loop) : 0;
  }
  function kick() {
    if (!rafId) {
      last = performance.now();
      rafId = requestAnimationFrame(loop);
    }
  }
  function add(layerId, part) {
    const layer = layers[layerId];
    if (!layer) return;
    layer.parts.push(part);
    kick();
  }

  function centerOf(target) {
    const r = target.getBoundingClientRect ? target.getBoundingClientRect() : target;
    return { x: (r.left + r.width / 2) / PX, y: (r.top + r.height / 2) / PX, r };
  }

  function pixelCircle(ctx, cx, cy, r, color) {
    ctx.fillStyle = color;
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) {
      const half = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)));
      if (half <= 0 && Math.abs(dy) >= r) continue;
      ctx.fillRect(Math.round(cx - half), Math.round(cy + dy), half * 2 + 1, 1);
    }
  }

  const rand = (a, b) => a + Math.random() * (b - a);

  /* 반짝이: + 모양이 커졌다 작아집니다 */
  function Sparkle(x, y, { delay = 0, color = '#fff6c4', size = 2 } = {}) {
    let t = -delay;
    const life = 0.5;
    return {
      update(dt) {
        t += dt;
        return t < life;
      },
      draw(ctx) {
        if (t < 0) return;
        const k = t / life;
        const s = Math.max(0, Math.round(size * (k < 0.4 ? k / 0.4 : 1 - (k - 0.4) / 0.6)));
        ctx.fillStyle = color;
        const cx = Math.round(x);
        const cy = Math.round(y);
        ctx.fillRect(cx - s, cy, s * 2 + 1, 1);
        ctx.fillRect(cx, cy - s, 1, s * 2 + 1);
      },
    };
  }

  /* 동전이 곡선을 그리며 목표로 날아갑니다 */
  function FlyingCoin(from, to, { delay = 0, dur = 0.75, onArrive } = {}) {
    let t = -delay;
    const lift = rand(18, 42);
    const cx = (from.x + to.x) / 2 + rand(-30, 30);
    const cy = Math.min(from.y, to.y) - lift;
    let arrived = false;
    let spin = rand(0, 4);
    return {
      update(dt) {
        t += dt;
        spin += dt * 14;
        if (t >= dur && !arrived) {
          arrived = true;
          if (onArrive) onArrive();
          add('fx', Sparkle(to.x + rand(-4, 4), to.y + rand(-3, 3), { size: 3 }));
          return false;
        }
        return true;
      },
      draw(ctx) {
        if (t < 0) return;
        const p = Math.min(1, t / dur);
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        const x = (1 - e) * (1 - e) * from.x + 2 * (1 - e) * e * cx + e * e * to.x;
        const y = (1 - e) * (1 - e) * from.y + 2 * (1 - e) * e * cy + e * e * to.y;
        ctx.drawImage(bitmap('coinS', Math.floor(spin) % 4), Math.round(x - 3), Math.round(y - 3));
      },
    };
  }

  /* 튀어 오르고 떨어지는 동전 */
  function PoppingCoin(x, y, { delay = 0 } = {}) {
    let t = -delay;
    let vx = rand(-34, 34);
    let vy = rand(-70, -38);
    let px = x;
    let py = y;
    let spin = rand(0, 4);
    const life = rand(0.9, 1.3);
    return {
      update(dt) {
        t += dt;
        if (t < 0) return true;
        vy += 170 * dt;
        px += vx * dt;
        py += vy * dt;
        spin += dt * 12;
        return t < life;
      },
      draw(ctx) {
        if (t < 0) return;
        if (t > life - 0.25 && Math.floor(t * 20) % 2) return; // 사라지기 전 깜빡
        ctx.drawImage(bitmap('coinS', Math.floor(spin) % 4), Math.round(px - 3), Math.round(py - 3));
      },
    };
  }

  /* 펑! 연기 */
  function Puff(x, y, { delay = 0, r = 4 } = {}) {
    let t = -delay;
    const life = 0.55;
    const dx = rand(-8, 8);
    const dy = rand(-6, 2);
    return {
      update(dt) {
        t += dt;
        return t < life;
      },
      draw(ctx) {
        if (t < 0) return;
        const k = t / life;
        const rr = r * (0.4 + k * 0.9);
        const cx = x + dx * k;
        const cy = y + dy * k;
        if (k < 0.75) pixelCircle(ctx, cx, cy + 1, rr, 'rgba(160,140,120,0.55)');
        pixelCircle(ctx, cx, cy, rr * (k < 0.75 ? 1 : 1 - (k - 0.75) * 3), 'rgba(255,255,255,0.95)');
      },
    };
  }

  const FX = {
    coinsTo(fromEl, toEl, { count = 9, onArrive } = {}) {
      if (reduced()) {
        if (onArrive) onArrive();
        return;
      }
      const a = centerOf(fromEl);
      const b = centerOf(toEl);
      let first = true;
      for (let i = 0; i < count; i++) {
        add(
          'fx',
          FlyingCoin({ x: a.x + rand(-10, 10), y: a.y + rand(-4, 4) }, { x: b.x + rand(-6, 6), y: b.y }, {
            delay: i * 0.05,
            dur: rand(0.6, 0.85),
            onArrive: () => {
              if (first && onArrive) onArrive();
              first = false;
            },
          })
        );
      }
    },
    coinBurst(target, { count = 10 } = {}) {
      if (reduced()) return;
      const c = centerOf(target);
      for (let i = 0; i < count; i++) add('fx', PoppingCoin(c.x + rand(-8, 8), c.y, { delay: i * 0.025 }));
    },
    sparkles(target, { count = 8, spread = 1 } = {}) {
      if (reduced()) return;
      const c = centerOf(target);
      const w = (c.r.width / PX / 2) * spread;
      const h = (c.r.height / PX / 2) * spread;
      for (let i = 0; i < count; i++) {
        add('fx', Sparkle(c.x + rand(-w, w), c.y + rand(-h, h), { delay: rand(0, 0.35), size: Math.round(rand(1, 3)) }));
      }
    },
    poof(target) {
      if (reduced()) return;
      const c = centerOf(target);
      const w = c.r.width / PX / 2;
      for (let i = 0; i < 7; i++) {
        add('fx', Puff(c.x + rand(-w * 0.7, w * 0.7), c.y + rand(-2, 2), { delay: i * 0.03, r: rand(3, 6) }));
      }
    },
  };

  /* ───────── 계절 파티클 (배경) ───────── */
  const SEASON_COLORS = {
    autumn: [
      { a: '#ff9a3c', A: '#c9561f' },
      { a: '#f0643a', A: '#b23d22' },
      { a: '#ffc94a', A: '#d9902a' },
    ],
    spring: [{ p: '#ffc2d8', P: '#f08fb5' }, { p: '#ffd8e6', P: '#f2a2c0' }],
  };

  function seasonOf(month) {
    if (month === 12 || month <= 2) return 'winter';
    if (month <= 5) return 'spring';
    if (month <= 8) return 'summer';
    return 'autumn';
  }

  function AmbientBit(kind, layer, night) {
    const p = { x: rand(0, layer.w), y: rand(-layer.h, layer.h), phase: rand(0, Math.PI * 2), t: 0 };
    let pal = null;
    if (kind === 'autumn') pal = SEASON_COLORS.autumn[Math.floor(rand(0, 3))];
    if (kind === 'spring') pal = SEASON_COLORS.spring[Math.floor(rand(0, 2))];
    const speed = kind === 'firefly' ? rand(2, 5) : kind === 'winter' ? rand(6, 12) : rand(7, 13);
    const sway = rand(4, 10);
    const flip = rand(0.25, 0.5);
    return {
      update(dt, l) {
        p.t += dt;
        if (kind === 'firefly') {
          p.x += Math.cos(p.t * 0.7 + p.phase) * dt * 6;
          p.y += Math.sin(p.t * 0.9 + p.phase) * dt * 5 - dt * speed * 0.2;
          if (p.y < -4) p.y = l.h + 4;
        } else {
          p.y += speed * dt;
          if (p.y > l.h + 8) {
            p.y = -8;
            p.x = rand(0, l.w);
          }
        }
        if (p.x < -8) p.x = l.w + 8;
        if (p.x > l.w + 8) p.x = -8;
        return true;
      },
      draw(ctx) {
        const x = Math.round(p.x + Math.sin(p.t * 1.1 + p.phase) * sway);
        const y = Math.round(p.y);
        ctx.globalAlpha = night ? 0.65 : 1;
        if (kind === 'autumn') {
          const f = Math.floor(p.t / flip + p.phase) % 4;
          ctx.drawImage(bitmap('maple', f === 3 ? 1 : f, pal), x, y);
        } else if (kind === 'spring') {
          const f = Math.floor(p.t / flip + p.phase) % 2;
          ctx.drawImage(bitmap('petal', f, pal), x, y);
        } else if (kind === 'winter') {
          ctx.fillStyle = '#ffffff';
          const s = p.phase > 3 ? 2 : 1;
          ctx.fillRect(x, y, s, s);
        } else if (kind === 'firefly') {
          const glow = (Math.sin(p.t * 3 + p.phase) + 1) / 2;
          ctx.globalAlpha = 0.25 + glow * 0.75;
          ctx.fillStyle = 'rgba(214,255,120,0.35)';
          ctx.fillRect(x - 1, y - 1, 3, 3);
          ctx.fillStyle = '#f4ff9c';
          ctx.fillRect(x, y, 1, 1);
        }
        ctx.globalAlpha = 1;
      },
    };
  }

  const Ambient = {
    kind: null,
    night: false,
    start(month, night) {
      const layer = layers.ambient;
      if (!layer) return;
      let kind = seasonOf(month);
      if (kind === 'summer') kind = night ? 'firefly' : null;
      this.kind = kind;
      this.night = night;
      layer.parts = [];
      if (!kind || reduced()) return;
      const area = global.innerWidth * global.innerHeight;
      const n = Math.max(6, Math.min(24, Math.round(area / 55000)));
      for (let i = 0; i < n; i++) layer.parts.push(AmbientBit(kind, layer, night));
      kick();
    },
  };

  /* ───────── 섬 풍경 만들기 ───────── */
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function svgURL(w, h, body) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="crispEdges">${body}</svg>`;
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
  }

  function hillsImage() {
    const W = 160;
    const H = 22;
    let body = '';
    let prevTop = null;
    for (let x = 0; x < W; x++) {
      const t = (x / W) * Math.PI * 2;
      const h = Math.round(12 + 4 * Math.sin(t * 2) + 3 * Math.sin(t * 3 + 1.3) + 1.4 * Math.sin(t * 7 + 0.5));
      const top = H - h;
      body += `<rect x="${x}" y="${top}" width="1" height="${h}" fill="#9ed97a"/>`;
      body += `<rect x="${x}" y="${top}" width="1" height="1" fill="#c6ef9e"/>`;
      if (prevTop !== null && prevTop < top) body += `<rect x="${x}" y="${prevTop}" width="1" height="${top - prevTop}" fill="#c6ef9e"/>`;
      if (x % 9 === 3) body += `<rect x="${x}" y="${top + 4}" width="1" height="1" fill="#8ccb6a"/>`;
      if (x % 13 === 7) body += `<rect x="${x}" y="${top + 8}" width="2" height="1" fill="#8ccb6a"/>`;
      prevTop = top;
    }
    return svgURL(W, H, body);
  }

  function groundImage(rng) {
    const W = 32;
    const H = 18;
    let body = '';
    const tuft = (x, y) => {
      body += `<rect x="${x}" y="${y}" width="1" height="2" fill="#5fae4c"/><rect x="${x + 2}" y="${y - 1}" width="1" height="3" fill="#5fae4c"/><rect x="${x + 4}" y="${y}" width="1" height="2" fill="#5fae4c"/><rect x="${x}" y="${y + 2}" width="5" height="1" fill="#6dbb56"/>`;
    };
    tuft(3, 3);
    tuft(20, 11);
    tuft(12, 15);
    const dots = ['#ffffff', '#ffe46b', '#ffb3c9'];
    for (let i = 0; i < 4; i++) {
      const x = Math.floor(rng() * (W - 2));
      const y = Math.floor(rng() * (H - 2));
      body += `<rect x="${x}" y="${y}" width="1" height="1" fill="${dots[i % 3]}"/>`;
    }
    body += `<rect x="27" y="5" width="2" height="1" fill="#74c25c"/><rect x="8" y="10" width="2" height="1" fill="#74c25c"/>`;
    return svgURL(W, H, body);
  }

  const CANOPY = {
    spring: { z: '#ffe3ee', a: '#ffc4da', A: '#ef93b8', q: '#ffffff' },
    summer: { z: '#aee68c', a: '#7ccf5f', A: '#4fa845', q: '#ff6b5b' },
    autumn: { z: '#ffc66e', a: '#ff9a3c', A: '#d9672a', q: '#ffe066' },
    winter: { z: '#ffffff', a: '#e1edf3', A: '#86b394', q: '#ffffff' },
  };
  const FLOWERS = ['#ff6b6b', '#ffd84a', '#ff9fbd', '#ffffff', '#b893f2'];

  const Scene = {
    build(month) {
      const scene = document.querySelector('.scene');
      if (!scene) return;
      const rng = mulberry32(20261013);
      const season = seasonOf(month);

      // 별
      const stars = scene.querySelector('.stars');
      const starURL = `url("${S.url('star')}")`;
      for (let i = 0; i < 28; i++) {
        const st = document.createElement('i');
        const big = rng() > 0.7;
        st.style.cssText = `left:${(rng() * 100).toFixed(2)}%;top:${(rng() * 100).toFixed(2)}%;width:${big ? 15 : 10}px;height:${big ? 15 : 10}px;animation-delay:${(-rng() * 3).toFixed(2)}s`;
        st.style.setProperty('--img', starURL);
        stars.appendChild(st);
      }
      // 해와 달
      scene.querySelector('.celestial .sun').style.setProperty('--img', `url("${S.url('sun')}")`);
      scene.querySelector('.celestial .moon').style.setProperty('--img', `url("${S.url('moon')}")`);

      // 구름
      const clouds = scene.querySelector('.clouds');
      const CL = [
        { kind: 'cloudL', top: 7, scale: 4, dur: 130, delay: -20, x: 6 },
        { kind: 'cloudS', top: 15, scale: 3, dur: 95, delay: -70, x: 62 },
        { kind: 'cloudL', top: 25, scale: 3, dur: 150, delay: -95, x: 30 },
        { kind: 'cloudS', top: 4, scale: 2, dur: 85, delay: -30, x: 82 },
        { kind: 'cloudS', top: 33, scale: 2, dur: 120, delay: -50, x: 48 },
      ];
      for (const c of CL) {
        const el = document.createElement('i');
        el.className = 'cloud';
        const { w, h } = S.size(c.kind);
        el.style.cssText = `top:${c.top}%;width:${w * c.scale}px;height:${h * c.scale}px;--dur:${c.dur}s;--delay:${c.delay}s;--x:${c.x}%`;
        el.style.setProperty('--img', `url("${S.url(c.kind)}")`);
        clouds.appendChild(el);
      }

      // 언덕과 풀밭
      scene.querySelector('.hills').style.setProperty('--img', hillsImage());
      scene.querySelector('.ground').style.setProperty('--img', groundImage(rng));

      // 나무와 꽃
      const props = scene.querySelector('.props');
      const canopyURL = `url("${S.url('canopy', { pal: CANOPY[season] })}")`;
      const trunkURL = `url("${S.url('trunk')}")`;
      const TREES = [
        { left: '1%', bottom: 86, scale: 2 },
        { left: '8%', bottom: 46, scale: 3 },
        { left: '17%', bottom: 80, scale: 2 },
        { left: 'calc(100% - 210px)', bottom: 84, scale: 2 },
        { left: 'calc(100% - 140px)', bottom: 40, scale: 3 },
        { left: 'calc(100% - 64px)', bottom: 74, scale: 2 },
      ];
      TREES.forEach((t, i) => {
        const tree = document.createElement('div');
        tree.className = 'prop tree';
        const cw = 26 * t.scale;
        tree.style.cssText = `left:${t.left};bottom:${t.bottom}px;width:${cw}px;height:auto;grid-template-rows:${19 * t.scale}px ${9 * t.scale}px;--delay:${(-i * 0.7).toFixed(1)}s`;
        const can = document.createElement('i');
        can.className = 'canopy';
        can.style.setProperty('--img', canopyURL);
        can.style.marginBottom = `-${2 * t.scale}px`;
        const tr = document.createElement('i');
        tr.className = 'trunk';
        tr.style.setProperty('--img', trunkURL);
        tree.append(can, tr);
        props.appendChild(tree);
      });
      if (season !== 'winter') {
        for (let i = 0; i < 14; i++) {
          const f = document.createElement('i');
          f.className = 'prop flower';
          const color = FLOWERS[Math.floor(rng() * FLOWERS.length)];
          const scale = rng() > 0.5 ? 3 : 2;
          const side = i % 2 === 0 ? rng() * 26 : 74 + rng() * 26;
          f.style.cssText = `left:${side.toFixed(1)}%;bottom:${Math.round(6 + rng() * 60)}px;width:${9 * scale}px;height:${11 * scale}px;--delay:${(-rng() * 1.6).toFixed(2)}s`;
          f.style.setProperty('--img', `url("${S.sheet('flower', { pal: { a: color, y: color === '#ffd84a' ? '#ff9a3c' : '#ffd84a' } })}")`);
          props.appendChild(f);
        }
      }
    },
  };

  /* 창 크기가 바뀌면 캔버스도 맞춥니다 */
  let resizeTimer = 0;
  global.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      for (const layer of Object.values(layers)) resizeLayer(layer);
      if (Ambient.kind) Ambient.start(new Date().getMonth() + 1, Ambient.night);
    }, 150);
  });

  global.Motion = {
    SPRING,
    SPRING_SOFT,
    EASE_OUT,
    EASE_IN,
    reduced,
    animate,
    Odometer,
    countUp,
    typewriter,
    setupLayer,
    FX,
    Ambient,
    Scene,
    seasonOf,
  };
})(window);
