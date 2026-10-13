/* Flappy Math — núcleo independiente del renderizado.
   Contiene: RNG con semilla, expresiones (AST + evaluación entera propia),
   generador de desafíos, geometría de obstáculos con validador de alcanzabilidad
   y simulación de partida a paso fijo. Sin dependencias del DOM. */
(function (root) {
  'use strict';

  // ---------- Constantes del mundo (unidades lógicas 360×640) ----------
  const W = 360, H = 640, GROUND = 584;
  const PHYS = { gravity: 900, flap: -300, maxFall: 450, baseSpeed: 140, dt: 1 / 60 };
  const BIRD = { x: 96, hw: 11, hh: 8 };            // hitbox 22×16, menor que el sprite
  const OBST = { w: 72, wall: 64, hudBottom: 112, groundPad: 14 };
  const REACH = { climb: 150, margin: 24 };         // presupuesto conservador de ascenso (u/s)

  const DIFFS = {
    easy: {
      key: 'easy', lane: 134, weights: { add: 1, sub: 1 }, addMax: 9, subMax: 9, literalMax: 9,
      speedCap: 1.25, spacingStart: 4.4, spacingMin: 3.3, delta: [-2, -1, 1, 2], mixP: 0.3
    },
    normal: {
      key: 'normal', lane: 124, weights: { add: 0.8, sub: 0.8, mul: 1.6 }, addMax: 20, subMax: 20, literalMax: 20,
      speedCap: 1.35, spacingStart: 4.2, spacingMin: 3.1, delta: [-2, -1, 1, 2], mixP: 0.35
    },
    hard: {
      key: 'hard', lane: 114, weights: { add: 0.5, sub: 0.5, mul: 1, div: 1.3, combo: 1.1 }, addMax: 50, subMax: 50, literalMax: 81,
      speedCap: 1.4, spacingStart: 4.0, spacingMin: 3.0, delta: [-3, -2, -1, 1, 2, 3], mixP: 0.3
    }
  };

  // ---------- RNG determinista ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const ri = (r, min, max) => min + Math.floor(r() * (max - min + 1));
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

  // ---------- Expresiones ----------
  const N = (v) => ({ k: 'n', v });
  const B = (op, a, b) => ({ k: 'b', op, a, b });

  function evalExpr(e) {
    if (e.k === 'n') return e.v;
    const a = evalExpr(e.a), b = evalExpr(e.b);
    switch (e.op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/':
        if (b === 0) throw new Error('div0');
        if (a % b !== 0) throw new Error('inexact');
        return a / b;
    }
    throw new Error('op');
  }

  const SYM = { '+': '+', '-': '−', '*': '×', '/': '÷' };
  const PREC = { '+': 1, '-': 1, '*': 2, '/': 2 };
  function formatExpr(e, parentPrec = 0, isRight = false) {
    if (e.k === 'n') return String(e.v);
    const p = PREC[e.op];
    const s = formatExpr(e.a, p, false) + ' ' + SYM[e.op] + ' ' + formatExpr(e.b, p, true);
    return (p < parentPrec || (isRight && p === parentPrec)) ? '(' + s + ')' : s;
  }

  function literals(e, out = []) {
    if (e.k === 'n') out.push(e.v); else { literals(e.a, out); literals(e.b, out); }
    return out;
  }
  function exprValid(e, c) {
    let v;
    try { v = evalExpr(e); } catch (_) { return false; }
    if (!Number.isInteger(v) || v < 0) return false;
    return literals(e).every((x) => Number.isInteger(x) && x >= 0 && x <= c.literalMax);
  }

  // Expresión correcta por tipo
  const GEN = {
    add(r, c) { const t = ri(r, 1, c.addMax); const a = ri(r, 0, t); return B('+', N(a), N(t - a)); },
    sub(r, c) { const a = ri(r, 1, c.subMax); const b = ri(r, 0, a); return B('-', N(a), N(b)); },
    mul(r) { return B('*', N(ri(r, 2, 9)), N(ri(r, 2, 9))); },
    div(r) { const d = ri(r, 2, 9), q = r() < 0.06 ? 0 : ri(r, 1, 9); return B('/', N(d * q), N(d)); },
    combo(r) {
      const a = ri(r, 2, 6), b = ri(r, 2, 6), k = ri(r, 1, 9);
      const op = (r() < 0.5 || k > a * b) ? '+' : '-';
      return B(op, B('*', N(a), N(b)), N(k));
    }
  };

  // Distractor del mismo tipo: error típico (±1/±2, tabla vecina)
  function perturb(r, e, type, c) {
    const d = pick(r, c.delta), s = d > 0 ? 1 : -1;
    switch (type) {
      case 'add': return r() < 0.5 ? B('+', e.a, N(e.b.v + d)) : B('+', N(e.a.v + d), e.b);
      case 'sub': return r() < 0.5 ? B('-', e.a, N(e.b.v + d)) : B('-', N(e.a.v + d), e.b);
      case 'mul': return r() < 0.5 ? B('*', e.a, N(e.b.v + s)) : B('*', N(e.a.v + s), e.b);
      case 'div': { const D = e.b.v, q = e.a.v / D; return B('/', N(D * (q + d)), N(D)); }
      case 'combo': {
        const m = e.a;
        if (r() < 0.5) return B(e.op, m, N(e.b.v + d));
        return r() < 0.5 ? B(e.op, B('*', N(m.a.v + s), m.b), e.b) : B(e.op, B('*', m.a, N(m.b.v + s)), e.b);
      }
    }
    return null;
  }

  // Expresión de otro tipo con un valor dado (distractor mixto)
  function withValue(r, type, v, c) {
    if (v < 0) return null;
    switch (type) {
      case 'add': { if (v > c.addMax) return null; const a = ri(r, 0, v); return B('+', N(a), N(v - a)); }
      case 'sub': { const room = Math.min(c.subMax - v, 9); if (room < 0) return null; const b = ri(r, 0, room); return B('-', N(v + b), N(b)); }
      case 'mul': {
        const fs = [];
        for (let a = 2; a <= 9; a++) if (v % a === 0 && v / a >= 2 && v / a <= 9) fs.push(a);
        if (!fs.length) return null;
        const a = pick(r, fs); return B('*', N(a), N(v / a));
      }
      case 'div': { if (v > 9) return null; const D = ri(r, 2, 9); return B('/', N(D * v), N(D)); }
      case 'combo': {
        const opts = [];
        for (let a = 2; a <= 6; a++) for (let b = 2; b <= 6; b++) {
          const m = a * b;
          if (v - m >= 1 && v - m <= 9) opts.push(['+', a, b, v - m]);
          if (m - v >= 1 && m - v <= 9) opts.push(['-', a, b, m - v]);
        }
        if (!opts.length) return null;
        const o = pick(r, opts); return B(o[0], B('*', N(o[1]), N(o[2])), N(o[3]));
      }
    }
    return null;
  }

  function createGenerator(diffKey, seed) {
    const c = DIFFS[diffKey];
    const r = mulberry32(seed >>> 0);
    let bag = [], n = 0;
    const recent = [];
    const WARM = { add: 1, sub: 1 };

    function lane() {
      if (!bag.length) {
        bag = [0, 0, 1, 1];
        for (let i = 3; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      }
      return bag.pop();
    }
    function weightedType(w) {
      let tot = 0; for (const k in w) tot += w[k];
      let x = r() * tot;
      for (const k in w) { x -= w[k]; if (x < 0) return k; }
      return Object.keys(w)[0];
    }

    function next() {
      n++;
      const warm = n <= 2 && diffKey !== 'easy';   // calentamiento: 2 primeros sencillos
      const weights = warm ? WARM : c.weights;
      const types = Object.keys(weights);
      for (let attempt = 0; attempt < 300; attempt++) {
        const type = weightedType(weights);
        const correct = GEN[type](r, c);
        if (!exprValid(correct, c)) continue;
        const cs = formatExpr(correct);
        if (recent.includes(cs)) continue;
        const t = evalExpr(correct);
        let wrong = null;
        for (let k = 0; k < 40 && !wrong; k++) {
          let cand;
          if (types.length > 1 && r() < c.mixP) {
            cand = withValue(r, pick(r, types.filter((x) => x !== type)), t + pick(r, c.delta), c);
          } else {
            cand = perturb(r, correct, type, c);
          }
          if (cand && exprValid(cand, c) && evalExpr(cand) !== t && formatExpr(cand) !== cs) wrong = cand;
        }
        if (!wrong) continue;
        recent.push(cs); if (recent.length > 8) recent.shift();
        const ln = lane();
        const up = ln === 0 ? correct : wrong, lo = ln === 0 ? wrong : correct;
        return {
          id: n, target: t, type, correctLane: ln, difficulty: diffKey, seed,
          upper: { expr: up, text: formatExpr(up), value: evalExpr(up) },
          lower: { expr: lo, text: formatExpr(lo), value: evalExpr(lo) }
        };
      }
      throw new Error('generator exhausted');
    }
    return { next };
  }

  // ---------- Partida ----------
  function createGame(diffKey, seed) {
    const c = DIFFS[diffKey];
    const gen = createGenerator(diffKey, seed);
    const geo = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    const L = c.lane, half = OBST.wall / 2;
    const cMin = OBST.hudBottom + L + half;
    const cMax = GROUND - OBST.groundPad - L - half;

    const s = {
      diff: diffKey, seed, status: 'countdown', countdown: 3, time: 0, score: 0, streak: 0, bestStreak: 0,
      speedMul: 1, scroll: 0, toNext: 0, cause: null, wrong: null, killer: null, dyingT: 0,
      bird: { y: 300, vy: 0, hoverY: 300, alive: true, flapT: 1 },
      obstacles: [], pending: null, events: [], lane: L
    };

    const laneCenter = (cc, ln) => (ln === 0 ? cc - half - L / 2 : cc + half + L / 2);
    const speed = () => PHYS.baseSpeed * s.speedMul;
    const spacingTime = () => Math.max(c.spacingMin, c.spacingStart - 0.12 * Math.floor(s.score / 5));

    function reachable(fromY, toY, dist) {
      const t = (dist - OBST.w - 2 * BIRD.hw) / (PHYS.baseSpeed * c.speedCap);
      if (t <= 0) return false;
      const dy = toY - fromY;
      if (dy < 0) return -dy <= REACH.climb * t - REACH.margin;           // subir
      const fall = Math.min(0.5 * PHYS.gravity * t * t, PHYS.maxFall * t);
      return dy <= fall - REACH.margin;                                     // bajar
    }

    function makePending(fromY, dist) {
      const ch = gen.next();
      let cc = null;
      for (let i = 0; i < 40; i++) {
        const cand = cMin + geo() * (cMax - cMin);
        if (reachable(fromY, laneCenter(cand, ch.correctLane), dist)) { cc = cand; break; }
      }
      if (cc === null) { // la opción más cercana posible
        const want = ch.correctLane === 0 ? fromY + half + L / 2 : fromY - half - L / 2;
        cc = Math.min(cMax, Math.max(cMin, want));
      }
      return { ch, c: Math.round(cc), dist };
    }

    s.pending = makePending(s.bird.y, W + 40 - BIRD.x + OBST.w + 2 * BIRD.hw);

    function spawn() {
      const p = s.pending;
      const o = { id: p.ch.id, x: W + 40 + s.toNext, c: p.c, ch: p.ch, resolved: false, chosen: null };
      s.obstacles.push(o);
      const dist = speed() * spacingTime();
      s.pending = makePending(laneCenter(o.c, o.ch.correctLane), dist);
      s.toNext += dist;
    }

    function die(cause, o) {
      s.status = 'dying'; s.cause = cause; s.killer = o || null; s.bird.alive = false; s.dyingT = 0;
      s.events.push(cause === 'wrong' ? 'wrong' : 'hit');
    }

    function current() {
      for (const o of s.obstacles) if (!o.resolved) return { ch: o.ch, c: o.c, obstacle: o };
      return s.pending ? { ch: s.pending.ch, c: s.pending.c, obstacle: null } : null;
    }

    function step(dt, flap) {
      s.events.length = 0;
      s.time += dt;
      const b = s.bird;
      b.flapT += dt;

      if (s.status === 'countdown') {
        s.countdown -= dt;
        b.y = b.hoverY + Math.sin(s.time * 6) * 4;
        if (s.countdown <= 0) { s.status = 'playing'; b.y = b.hoverY; b.vy = -160; b.flapT = 0; s.events.push('go'); }
        return;
      }
      if (s.status === 'paused' || s.status === 'over') return;

      if (s.status === 'dying') {
        s.dyingT += dt;
        b.vy = Math.min(PHYS.maxFall, b.vy + PHYS.gravity * dt);
        b.y = Math.min(GROUND - BIRD.hh, b.y + b.vy * dt);
        if ((b.y >= GROUND - BIRD.hh && s.dyingT > 0.35) || s.dyingT > 1.2) { s.status = 'over'; s.events.push('over'); }
        return;
      }

      // --- playing ---
      if (flap) { b.vy = PHYS.flap; b.flapT = 0; s.events.push('flap'); }
      b.vy = Math.min(PHYS.maxFall, b.vy + PHYS.gravity * dt);
      b.y += b.vy * dt;
      if (b.y - BIRD.hh < 0) { b.y = BIRD.hh; if (b.vy < 0) b.vy = 0; }

      const dx = speed() * dt;
      s.scroll += dx;
      for (const o of s.obstacles) o.x -= dx;
      s.toNext -= dx;
      if (s.toNext <= 0) spawn();
      while (s.obstacles.length && s.obstacles[0].x + OBST.w < -120) s.obstacles.shift();

      const bx0 = BIRD.x - BIRD.hw, bx1 = BIRD.x + BIRD.hw, by0 = b.y - BIRD.hh, by1 = b.y + BIRD.hh;
      if (by1 >= GROUND) { b.y = GROUND - BIRD.hh; die('ground'); return; }

      for (const o of s.obstacles) {
        if (bx1 > o.x && bx0 < o.x + OBST.w) {
          const upTop = o.c - half - L, loBot = o.c + half + L;
          if (by0 < upTop || by1 > loBot || (by1 > o.c - half && by0 < o.c + half)) { die('hit', o); return; }
        }
        if (!o.resolved && o.x + OBST.w / 2 <= BIRD.x) {
          o.resolved = true;
          o.chosen = b.y < o.c ? 0 : 1;
          if (o.chosen === o.ch.correctLane) {
            s.score++; s.streak++; s.bestStreak = Math.max(s.bestStreak, s.streak);
            s.events.push('point');
            if (s.score % 5 === 0) {
              const m = Math.min(c.speedCap, 1 + 0.05 * (s.score / 5));
              if (m > s.speedMul) { s.speedMul = m; s.events.push('speedup'); }
            }
          } else {
            const picked = o.chosen === 0 ? o.ch.upper : o.ch.lower;
            s.wrong = { text: picked.text, value: picked.value, target: o.ch.target };
            die('wrong', o); return;
          }
        }
      }
    }

    function pause() { if (s.status === 'playing') { s.status = 'paused'; return true; } return false; }
    function resume() { if (s.status === 'paused') { s.status = 'countdown'; s.countdown = 3; s.bird.hoverY = s.bird.y; s.bird.vy = 0; } }

    return { s, step, pause, resume, current, laneCenter, cfg: c };
  }

  const FM = { W, H, GROUND, PHYS, BIRD, OBST, DIFFS, mulberry32, evalExpr, formatExpr, exprValid, createGenerator, createGame };
  if (typeof module !== 'undefined' && module.exports) module.exports = FM;
  root.FM = FM;
})(typeof globalThis !== 'undefined' ? globalThis : this);
