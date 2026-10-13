// Pruebas del núcleo: invariantes matemáticas (GDD §15.1) y justicia física (§5.1, §15.2)
const FM = require('../src/core.js');
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; if (fails < 30) console.error('FAIL:', msg); } };

// ---------- 15.1 Pruebas matemáticas ----------
const N = 100000;
for (const diff of Object.keys(FM.DIFFS)) {
  const c = FM.DIFFS[diff];
  let upperCorrect = 0, types = {}, maxTarget = 0, prev = null, consecutiveSame = 0, games = 0;
  let produced = 0;
  for (let seed = 1; produced < N; seed++) {
    games++;
    const g = FM.createGenerator(diff, seed * 7919);
    prev = null;
    for (let i = 0; i < 50 && produced < N; i++, produced++) {
      const ch = g.next();
      const u = FM.evalExpr(ch.upper.expr), l = FM.evalExpr(ch.lower.expr);
      ok(Number.isInteger(u) && Number.isInteger(l), `${diff} entero`);
      ok(u >= 0 && l >= 0, `${diff} no negativo ${ch.upper.text} | ${ch.lower.text}`);
      ok((u === ch.target) !== (l === ch.target), `${diff} unicidad ${ch.target}: ${ch.upper.text} | ${ch.lower.text}`);
      const correct = ch.correctLane === 0 ? u : l;
      ok(correct === ch.target, `${diff} carril correcto`);
      ok(ch.upper.text !== ch.lower.text, `${diff} textos distintos`);
      ok(!/[*/]/.test(ch.upper.text + ch.lower.text), `${diff} usa × y ÷`);
      ok(FM.exprValid(ch.upper.expr, c) && FM.exprValid(ch.lower.expr, c), `${diff} rangos de literales`);
      if (diff === 'easy') ok(ch.target <= 9, `easy objetivo 0–9: ${ch.target}`);
      if (diff === 'easy') ok(ch.type === 'add' || ch.type === 'sub', 'easy solo +/−');
      if (diff === 'normal') ok(ch.type !== 'div' && ch.type !== 'combo', 'normal sin ÷');
      if (prev) { const cs = ch.correctLane === 0 ? ch.upper.text : ch.lower.text; if (cs === prev) consecutiveSame++; }
      prev = ch.correctLane === 0 ? ch.upper.text : ch.lower.text;
      if (ch.correctLane === 0) upperCorrect++;
      types[ch.type] = (types[ch.type] || 0) + 1;
      maxTarget = Math.max(maxTarget, ch.target);
    }
  }
  const ratio = upperCorrect / N;
  ok(ratio > 0.47 && ratio < 0.53, `${diff} balance arriba/abajo ${ratio}`);
  ok(consecutiveSame === 0, `${diff} repeticiones consecutivas ${consecutiveSame}`);
  // Reproducibilidad por semilla
  const a = FM.createGenerator(diff, 42), b = FM.createGenerator(diff, 42);
  for (let i = 0; i < 200; i++) ok(JSON.stringify(a.next()) === JSON.stringify(b.next()), `${diff} semilla reproducible`);
  console.log(`${diff.padEnd(6)} ${N} desafíos · arriba ${(ratio * 100).toFixed(1)}% · objetivo máx ${maxTarget} · tipos ${JSON.stringify(types)}`);
}

// Casos límite de evaluación
ok(FM.evalExpr({ k: 'b', op: '/', a: { k: 'n', v: 0 }, b: { k: 'n', v: 5 } }) === 0, '0 ÷ 5 = 0');
let threw = false; try { FM.evalExpr({ k: 'b', op: '/', a: { k: 'n', v: 5 }, b: { k: 'n', v: 0 } }); } catch (_) { threw = true; }
ok(threw, '5 ÷ 0 prohibido');
threw = false; try { FM.evalExpr({ k: 'b', op: '/', a: { k: 'n', v: 0 }, b: { k: 'n', v: 0 } }); } catch (_) { threw = true; }
ok(threw, '0 ÷ 0 prohibido');
const prec = { k: 'b', op: '+', a: { k: 'b', op: '*', a: { k: 'n', v: 5 }, b: { k: 'n', v: 3 } }, b: { k: 'n', v: 2 } };
ok(FM.evalExpr(prec) === 17 && FM.formatExpr(prec) === '5 × 3 + 2', 'precedencia 5 × 3 + 2 = 17');

// ---------- Jugabilidad: bot que sigue la ruta correcta ----------
function botTarget(game) {
  const s = game.s, bx0 = FM.BIRD.x - FM.BIRD.hw - 6, bx1 = FM.BIRD.x + FM.BIRD.hw + 6;
  for (const o of s.obstacles) if (bx1 > o.x && bx0 < o.x + FM.OBST.w) return game.laneCenter(o.c, o.ch.correctLane);
  const cur = game.current();
  return game.laneCenter(cur.c, cur.ch.correctLane);
}
for (const diff of Object.keys(FM.DIFFS)) {
  let deaths = 0, totalScore = 0, doubles = 0;
  const RUNS = 60, GOAL = 150;
  for (let seed = 1; seed <= RUNS; seed++) {
    const g = FM.createGame(diff, seed * 1013);
    let steps = 0, last = 0;
    while (g.s.status !== 'over' && g.s.score < GOAL && steps < 60 * 60 * 20) {
      const target = botTarget(g);
      const b = g.s.bird;
      const flap = g.s.status === 'playing' && b.y > target + 2 && b.vy > -40;
      g.step(FM.PHYS.dt, flap);
      if (g.s.score - last > 1) doubles++;
      last = g.s.score; steps++;
    }
    if (g.s.score < GOAL) { deaths++; if (deaths <= 3) console.error(`  bot murió ${diff} semilla ${seed * 1013} score ${g.s.score} causa ${g.s.cause}`); }
    totalScore += g.s.score;
  }
  ok(deaths === 0, `${diff}: el bot no debería morir con rutas alcanzables (${deaths}/${RUNS})`);
  ok(doubles === 0, `${diff}: doble puntuación`);
  console.log(`${diff.padEnd(6)} bot: ${RUNS} partidas, ${deaths} muertes, puntaje medio ${(totalScore / RUNS).toFixed(0)}`);
}

// Ruta incorrecta termina la partida aunque no choque; pausa congela
{
  const g = FM.createGame('easy', 99);
  let wrongSeen = false;
  for (let i = 0; i < 60 * 60 && g.s.status !== 'over'; i++) {
    const s = g.s, cur = g.current();
    const t = g.laneCenter(cur.c, 1 - cur.ch.correctLane);
    let target = t;
    for (const o of s.obstacles) if (FM.BIRD.x + 17 > o.x && FM.BIRD.x - 17 < o.x + FM.OBST.w) target = g.laneCenter(o.c, 1 - o.ch.correctLane);
    g.step(FM.PHYS.dt, s.status === 'playing' && s.bird.y > target + 2 && s.bird.vy > -40);
    if (g.s.cause === 'wrong') wrongSeen = true;
  }
  ok(wrongSeen && g.s.score === 0, 'ruta incorrecta termina partida');
}
{
  const g = FM.createGame('normal', 5);
  for (let i = 0; i < 300; i++) g.step(FM.PHYS.dt, i % 20 === 0);
  g.pause();
  const snap = JSON.stringify({ y: g.s.bird.y, x: g.s.obstacles.map((o) => o.x), sc: g.s.scroll });
  for (let i = 0; i < 300; i++) g.step(FM.PHYS.dt, true);
  ok(snap === JSON.stringify({ y: g.s.bird.y, x: g.s.obstacles.map((o) => o.x), sc: g.s.scroll }), 'pausa congela simulación');
}

console.log(fails ? `\n${fails} fallos` : '\nTodas las pruebas pasaron');
process.exit(fails ? 1 : 0);
