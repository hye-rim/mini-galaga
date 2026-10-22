'use strict';
// 갤러그 규칙 시험. 실행: node test/logic.test.js
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

function rng(seed) {                                   // mulberry32 (시험용 고정 난수)
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const DT = 1 / 60;
const run = (st, sec, input = {}) => { for (let t = 0; t < sec && st.state === 'play'; t += DT) L.update(st, DT, input); };
const enemy = (over) => ({ type: 0, row: 3, col: 1, state: 'form', hp: 1, x: 100, y: 200, ang: Math.PI / 2, carry: false, ...over });

test('a normal stage has 4 bosses, 16 butterflies and 20 bees; challenge stages are 3, 7, 11 ...', () => {
  const st = L.newGame(rng(1));
  const count = (t) => st.enemies.filter((e) => e.type === t).length;
  assert.deepStrictEqual([count(2), count(1), count(0)], [4, 16, 20]);
  assert.ok(st.enemies.every((e) => !e.shoot), 'nobody shoots while flying in on stage 1');
  assert.deepStrictEqual([1, 2, 3, 4, 7, 11, 12].map(L.isChallenge), [false, false, true, false, true, true, false]);
  L.startStage(st, 3);
  assert.strictEqual(st.enemies.length, 40);
  assert.ok(st.challenge && st.enemies.every((e) => !e.shoot));
});

test('everyone flies in and settles into the formation', () => {
  const st = L.newGame(rng(2));
  st.player.inv = 1e9;                                   // 시험 동안 맞지 않게
  run(st, 20);
  assert.ok(st.entryDone);
  const home = st.enemies.filter((e) => e.state === 'form');
  assert.ok(home.length >= 30, 'in formation: ' + home.length);
  const cells = new Set(st.enemies.map((e) => e.row + ',' + e.col));
  assert.strictEqual(cells.size, st.enemies.length, 'each has its own spot');
});

test('scores: formation, diving (double), boss with escorts, challenge', () => {
  const st = L.newGame(rng(3));
  const pts = (e) => { st.events.length = 0; st.enemies.push(e); L.killEnemy(st, e); return st.events.find((x) => x.type === 'kill').pts; };
  assert.strictEqual(pts(enemy({ type: 0 })), 50);
  assert.strictEqual(pts(enemy({ type: 1 })), 80);
  assert.strictEqual(pts(enemy({ type: 2 })), 150);
  assert.strictEqual(pts(enemy({ type: 0, state: 'dive' })), 100);
  assert.strictEqual(pts(enemy({ type: 1, state: 'dive' })), 160);
  const boss = enemy({ type: 2, state: 'dive' });
  st.enemies.push(enemy({ type: 1, state: 'escort', leader: boss }), enemy({ type: 1, state: 'escort', leader: boss }));
  assert.strictEqual(pts(boss), 1600);
  st.challenge = true;
  assert.strictEqual(pts(enemy({ type: 2 })), 100);
});

test('the boss takes two hits', () => {
  const st = L.newGame(rng(4));
  const boss = enemy({ type: 2, hp: 2, x: 240, y: 300, state: 'hold' });   // 제자리에 멈춰 있는 보스
  st.enemies = [boss, enemy({ x: 20, y: 20 })];
  st.bullets = [{ x: 240, y: 310 }];                    // 한 프레임에 13px 올라가며 맞는다
  L.update(st, DT);
  assert.strictEqual(boss.hp, 1);
  assert.ok(st.enemies.includes(boss));
  st.bullets = [{ x: boss.x, y: boss.y + 10 }];
  L.update(st, DT);
  assert.ok(!st.enemies.includes(boss));
});

test('extra lives at 20,000 and then every 70,000', () => {
  const st = L.newGame(rng(5));
  L.addScore(st, 19990); assert.strictEqual(st.lives, 3);
  L.addScore(st, 10); assert.strictEqual(st.lives, 4);
  L.addScore(st, 70000); assert.strictEqual(st.lives, 5);
  L.addScore(st, 70000); assert.strictEqual(st.lives, 6);
});

test('getting shot costs a life; you come back blinking; the last life ends the game', () => {
  const st = L.newGame(rng(6));
  st.ebullets = [{ x: st.player.x, y: st.player.y, vx: 0, vy: 0 }];
  L.update(st, DT);
  assert.strictEqual(st.lives, 2);
  assert.ok(!st.player.alive);
  assert.strictEqual(st.ebullets.length, 0);
  run(st, 2.5);
  assert.ok(st.player.alive && st.player.inv > 0);
  st.lives = 1; st.player.inv = 0;
  st.ebullets = [{ x: st.player.x, y: st.player.y, vx: 0, vy: 0 }];
  L.update(st, DT);
  run(st, 3);
  assert.strictEqual(st.state, 'over');
  assert.ok(st.events.some((e) => e.type === 'over'));
});

test('firing: at most three shots in the air (six with the dual fighter)', () => {
  const st = L.newGame(rng(7));
  st.enemies = [];
  st.phase = 'hold';                                     // 스테이지가 넘어가지 않게
  for (let k = 0; k < 10; k++) L.update(st, 0.13, { fire: true });
  assert.ok(st.bullets.length <= 3);
  st.bullets = []; st.player.dual = true;
  for (let k = 0; k < 10; k++) L.update(st, 0.13, { fire: true });
  assert.ok(st.bullets.length <= 6 && st.bullets.length > 3);
});

test('captured fighter: a beam takes it away, killing that boss while it dives brings it back as a dual fighter', () => {
  const st = L.newGame(rng(8));
  L.startStage(st, 2);
  const boss = enemy({ type: 2, hp: 2, state: 'beam', bt: 1, x: st.player.x, y: 330 });
  st.enemies = [boss, enemy({ x: 20, y: 20 })];
  L.update(st, DT);
  assert.strictEqual(boss.state, 'hold');
  assert.ok(st.player.cap);
  run(st, 1.7);
  assert.ok(boss.carry, 'the boss carries the fighter');
  assert.strictEqual(st.lives, 2);
  run(st, 3);                                            // 내 다음 비행기가 나올 때까지
  assert.ok(st.player.alive);
  // 보스가 다시 급강하할 때 잡는다
  boss.state = 'dive'; boss.phase = 1; boss.x = 240; boss.y = 300;
  st.player.inv = 1e9;
  L.killEnemy(st, boss);
  st.enemies = st.enemies.filter((e) => !e.dead);
  assert.strictEqual(st.rescues.length, 1);
  for (let t = 0; t < 5 && !st.player.dual; t += DT) { st.rescues.forEach((r) => { r.x = st.player.x; }); L.update(st, DT); }
  assert.ok(st.player.dual, 'dual fighter');
  st.player.inv = 0;
  st.ebullets = [{ x: st.player.x, y: st.player.y, vx: 0, vy: 0 }];
  L.update(st, DT);
  assert.ok(st.player.alive && !st.player.dual, 'a hit only loses one of the two ships');
  assert.strictEqual(st.lives, 2);
});

test('a perfect challenge stage pays 10,000; then the next stage starts', () => {
  const st = L.newGame(rng(9));
  L.startStage(st, 3);
  for (const e of st.enemies) L.killEnemy(st, e);
  st.enemies = st.enemies.filter((e) => !e.dead);
  const before = st.score;
  L.update(st, DT);
  assert.strictEqual(st.phase, 'result');
  assert.strictEqual(st.score - before, 10000);
  run(st, 5);
  assert.strictEqual(st.stage, 4);
});

test('an autopilot that sits under the nearest enemy, fires and dodges clears the first stages', () => {
  for (const seed of [1, 2, 3]) {
    const st = L.newGame(rng(seed));
    for (let t = 0; t < 400 && st.state === 'play' && st.stage < 4; t += DT) {
      const P = st.player;
      // 내려오는 총알·적이 있으면 옆으로 피하고, 없으면 가장 가까운 적 밑으로
      const threat = [...st.ebullets, ...st.enemies.filter((e) => e.state === 'dive')].find((b) => b.y > P.y - 140 && b.y < P.y + 10 && Math.abs(b.x - P.x) < 40);
      let target = P.x;
      if (threat) target = threat.x > P.x ? P.x - 60 : P.x + 60;
      else {
        const e = st.enemies.filter((x) => x.state !== 'wait').sort((a, b) => Math.abs(a.x - P.x) - Math.abs(b.x - P.x))[0];
        if (e) target = e.x;
      }
      L.update(st, DT, { left: target < P.x - 4, right: target > P.x + 4, fire: true });
      st.events.length = 0;
    }
    assert.strictEqual(st.stage, 4, `seed ${seed}: reached stage ${st.stage} (${st.state})`);
    assert.ok(st.lives >= 1);
    assert.ok(st.hits > 60);
  }
});
