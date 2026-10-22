'use strict';

// 갤러그: 규칙만 모아 둔 파일 (그리기·입력·소리 없음). 브라우저와 테스트(Node)가 같이 쓴다.
//
// - 적은 다섯 무리로 나뉘어 곡선을 그리며 들어와 편대를 이룬다. 다 모이면 한두 마리씩 급강하하며 총을 쏜다
// - 보스 갤러가는 두 번 맞아야 하고, 나비 둘을 호위로 데리고 내려오기도 한다(호위째 잡으면 보너스)
// - 보스가 견인 광선으로 내 비행기를 붙잡아 갈 수 있다. 그 보스를 급강하 중에 잡으면 비행기가 돌아와 듀얼 파이터가 된다
// - 3스테이지부터 4판마다 챌린지 스테이지: 적이 쏘지 않고 지나가기만 하고, 40마리 다 잡으면 10000점
// - 20000점, 그 뒤 70000점마다 목숨 하나 더
// 소리·폭발·점수 글씨는 index.html 이 st.events 를 보고 만든다.
const LOGIC_GALAGA = (() => {
const W = 480, H = 640, PI = Math.PI;
const SX = 38, SY = 34, TOP = 100;     // 편대 간격
const PLAYER_Y = H - 52;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const normAng = (a) => { while (a > PI) a -= 2 * PI; while (a < -PI) a += 2 * PI; return a; };
const turnToward = (a, t, m) => a + clamp(normAng(t - a), -m, m);
const diff = (st) => Math.min(st.stage, 30);
const isChallenge = (n) => n >= 3 && (n - 3) % 4 === 0;

function newGame(rand = Math.random) {
  const st = {
    rand, state: 'play', stage: 1, score: 0, lives: 3, nextLife: 20000, shots: 0, hits: 0, events: [],
    player: { x: W / 2, y: PLAYER_Y, alive: true, inv: 0, dual: false, cap: null, respawn: 0, cd: 0 },
    bullets: [], ebullets: [], enemies: [], rescues: [],
  };
  st.events.push({ type: 'start' });
  startStage(st, 1);
  return st;
}

// ---------- 입장 경로 (거북이 방식) ----------
function buildPath(x, y, h, segs, mirror) {
  if (mirror) { x = W - x; h = PI - h; }
  const pts = [{ x, y }], STEP = 4;
  for (const s of segs) {
    if (s[0] === 'f') {
      for (let d = 0; d < s[1]; d += STEP) { x += Math.cos(h) * STEP; y += Math.sin(h) * STEP; pts.push({ x, y }); }
    } else {
      const ang = s[1] * (mirror ? -1 : 1), n = Math.ceil(Math.abs(ang) * s[2] / STEP), dh = ang / n;
      for (let i = 0; i < n; i++) { h += dh; x += Math.cos(h) * STEP; y += Math.sin(h) * STEP; pts.push({ x, y }); }
    }
  }
  return pts;
}

function groupPath(g, tail) {
  const t = tail || [];
  switch (g) {
    case 0: return buildPath(W * 0.30, -20, PI / 2, [['f', 240], ['t', 2 * PI, 46], ...t], false);
    case 1: return buildPath(W * 0.30, -20, PI / 2, [['f', 240], ['t', 2 * PI, 46], ...t], true);
    case 2: return buildPath(-20, 470, -0.4, [['f', 170], ['t', 2 * PI, 42], ...t], false);
    case 3: return buildPath(-20, 470, -0.4, [['f', 170], ['t', 2 * PI, 42], ...t], true);
    default: return buildPath(W * 0.5, -20, PI / 2, [['f', 200], ['t', -2 * PI, 55], ...t], false);
  }
}

function startStage(st, n) {
  st.stage = n; st.t = 0; st.phase = 'play'; st.phaseT = 0;
  st.entryDone = false; st.diveT = n === 1 ? 4 : 2.5; st.chHits = 0;
  st.challenge = isChallenge(n);
  st.enemies = []; st.ebullets = []; st.rescues = [];
  const mk = (type, row, col) => ({ type, row, col });
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  let groups;
  if (st.challenge) {
    const ty = [1, 0, 1, 0, 1];
    groups = ty.map((t) => Array.from({ length: 8 }, () => mk(t, 0, 0)));
  } else {
    const bosses = range(3, 6).map((c) => mk(2, 0, c));
    const b1 = range(2, 9).map((c) => mk(1, 1, c)), b2 = range(2, 9).map((c) => mk(1, 2, c));
    const bees = [...range(1, 10).map((c) => mk(0, 3, c)), ...range(1, 10).map((c) => mk(0, 4, c))];
    groups = [
      [...bosses, ...b1.slice(0, 4)],
      [...b1.slice(4), ...b2.slice(4)],
      [...b2.slice(0, 4), ...bees.slice(0, 4)],
      bees.slice(4, 12),
      bees.slice(12),
    ];
  }
  const v = st.challenge ? Math.floor((n - 3) / 4) % 3 : 0;
  const tail = st.challenge ? [[['f', 900]], [['t', PI / 2, 90], ['f', 900]], [['t', -PI / 2, 90], ['f', 900]]][v] : null;
  const gs = [0.6, 0.6, 4.8, 4.8, 9.0];
  groups.forEach((list, g) => {
    const path = groupPath(g, tail);
    list.forEach((m, i) => {
      st.enemies.push({
        ...m, x: -50, y: -50, ang: PI / 2, state: 'wait', hp: m.type === 2 ? 2 : 1,
        startT: gs[g] + i * 0.14, path, d: 0, carry: false,
        shoot: !st.challenge && n >= 2 && st.rand() < 0.25 + 0.02 * diff(st), fired: false,
      });
    });
  });
  st.banner = st.challenge ? 'CHALLENGING STAGE' : 'STAGE ' + n;
  if (n > 1) st.events.push({ type: 'stage', challenge: st.challenge });
}

const home = (st, e) => {
  const br = 1 + 0.07 * Math.sin(st.t * 1.2);
  return { x: W / 2 + (e.col - 4.5) * SX * br, y: TOP + e.row * SY };
};

function addScore(st, n) {
  st.score += n;
  while (st.score >= st.nextLife) {
    st.lives++;
    st.nextLife = st.nextLife === 20000 ? 70000 : st.nextLife + 70000;
    st.events.push({ type: 'extraLife' });
  }
}

// ---------- 적 ----------
const maxEB = (st) => Math.min(3 + Math.floor(diff(st) / 4), 8);
function fire(st, e) {
  if (st.ebullets.length >= maxEB(st)) return;
  const P = st.player;
  let a = Math.atan2(P.y - e.y, P.x - e.x) + (st.rand() - 0.5) * 0.16;
  a = clamp(a, 0.35, PI - 0.35);
  const sp = Math.min(300, 170 + 6 * diff(st));
  st.ebullets.push({ x: e.x, y: e.y + 8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp });
  st.events.push({ type: 'enemyShot' });
}

function launchDive(st, e, beam) {
  e.state = 'dive'; e.phase = 0; e.turned = 0;
  e.turn = e.x < W / 2 ? -1 : 1;
  e.ang = -PI / 2;
  e.shotsLeft = e.type === 0 ? 1 : 2;
  e.fireY = 150 + st.rand() * 90;
  e.beam = !!beam;
}

function holding(st) {
  return !!st.player.cap || st.enemies.some((b) => b.carry || b.state === 'hold' || b.state === 'beam');
}

function tryDive(st) {
  const form = st.enemies.filter((e) => e.state === 'form');
  if (!form.length) return;
  const rush = st.enemies.length <= 6;
  const maxDiv = st.stage === 1 ? 1 : rush ? 6 : Math.min(2 + Math.floor(diff(st) / 3), 6);
  const active = st.enemies.filter((e) => e.state === 'dive' || e.state === 'beam' || e.state === 'hold' || e.state === 'home').length;
  if (active >= maxDiv) return;
  const bosses = form.filter((e) => e.type === 2);
  if (bosses.length && st.rand() < 0.4) {
    const b = bosses[Math.floor(st.rand() * bosses.length)];
    const P = st.player;
    const beam = st.stage > 1 && !holding(st) && !b.carry && P.alive && !P.dual && st.lives >= 2 && st.rand() < 0.6;
    launchDive(st, b, beam);
    if (!beam) {
      const esc = form.filter((e) => e.type === 1 && Math.abs(e.col - b.col) <= 1 && e.row === 1).slice(0, 2);
      esc.forEach((c, i) => { c.state = 'escort'; c.leader = b; c.off = i ? 26 : -26; });
    }
    return;
  }
  const n = diff(st) >= 4 && st.rand() < 0.5 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const pool = st.enemies.filter((e) => e.state === 'form' && e.type !== 2);
    if (pool.length) launchDive(st, pool[Math.floor(st.rand() * pool.length)], false);
  }
}

function updateEnemy(st, e, dt) {
  const P = st.player;
  switch (e.state) {
    case 'wait':
      if (st.t >= e.startT) { e.state = 'path'; e.d = 0; e.x = e.path[0].x; e.y = e.path[0].y; }
      break;
    case 'path': {
      e.d += (st.challenge ? 300 : 250 + st.stage * 3) * dt;
      const i = e.d / 4, i0 = Math.floor(i);
      if (i0 >= e.path.length - 1) {
        if (st.challenge) { e.dead = true; e.gone = true; } else e.state = 'home';
        break;
      }
      const a = e.path[i0], b = e.path[i0 + 1], f = i - i0;
      e.x = a.x + (b.x - a.x) * f; e.y = a.y + (b.y - a.y) * f;
      e.ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (e.shoot && !e.fired && e.y > 140 && P.alive) { e.fired = true; fire(st, e); }
      break;
    }
    case 'home': {
      const h = home(st, e), dx = h.x - e.x, dy = h.y - e.y, dist = Math.hypot(dx, dy), step = 340 * dt;
      if (dist <= step) { e.x = h.x; e.y = h.y; e.state = 'form'; e.ang = PI / 2; }
      else {
        const ta = Math.atan2(dy, dx);
        e.ang = turnToward(e.ang, ta, 9 * dt);
        e.x += Math.cos(ta) * step; e.y += Math.sin(ta) * step;
      }
      break;
    }
    case 'form': {
      const h = home(st, e); e.x = h.x; e.y = h.y;
      e.ang = turnToward(e.ang, PI / 2, 8 * dt);
      break;
    }
    case 'escort': {
      const lead = e.leader;
      if (!lead || lead.dead) { e.state = 'dive'; e.phase = 1; e.shotsLeft = 1; e.fireY = e.y + 60; e.beam = false; break; }
      if (lead.state === 'home') { e.state = 'home'; break; }
      e.x = lead.x + e.off; e.y = lead.y - 20; e.ang = lead.ang;
      break;
    }
    case 'dive': {
      const sp = (st.stage === 1 ? 0.7 : 1) * Math.min(340, 210 + st.stage * 7);
      if (e.phase === 0) {
        const w = sp / 45;
        e.ang += e.turn * w * dt; e.turned += w * dt;
        if (e.turned >= PI) { e.phase = 1; e.ang = PI / 2; }
      } else {
        if (e.y < P.y - 110) {
          const want = clamp(Math.atan2(P.y - e.y, P.x - e.x), 0.6, PI - 0.6);
          e.ang = turnToward(e.ang, want, 1.8 * dt);
        }
        if (e.shotsLeft > 0 && e.y >= e.fireY && e.y < P.y - 80 && P.alive && !P.cap) {
          fire(st, e); e.shotsLeft--; e.fireY += 110;
        }
      }
      e.x += Math.cos(e.ang) * sp * dt; e.y += Math.sin(e.ang) * sp * dt;
      if (e.beam && e.phase === 1 && e.y >= 330) { e.state = 'beam'; e.bt = 0; e.ang = PI / 2; st.events.push({ type: 'beam' }); }
      if (e.y > H + 30 || e.x < -60 || e.x > W + 60) {
        const h = home(st, e); e.x = h.x; e.y = -30; e.ang = PI / 2; e.state = 'home';
      }
      break;
    }
    case 'beam': {
      e.bt += dt;
      if (Math.floor(e.bt * 8) !== Math.floor((e.bt - dt) * 8)) st.events.push({ type: 'beamHum' });
      const hw = 8 + (P.y - (e.y + 12)) * 0.16;
      if (e.bt > 0.5 && e.bt < 2.4 && P.alive && !P.cap && !P.dual && st.lives >= 2 && Math.abs(P.x - e.x) < hw) {
        P.cap = { boss: e, t: 0, x0: P.x }; e.state = 'hold';
        st.events.push({ type: 'captureStart' });
        break;
      }
      if (e.bt >= 2.6) { e.state = 'dive'; e.phase = 1; e.beam = false; e.ang = PI / 2; e.shotsLeft = 0; }
      break;
    }
    case 'hold': break;
  }
}

// ---------- 맞히기 ----------
// 점수: 편대 안의 벌 50·나비 80·보스 150, 급강하 중이면 벌·나비 두 배, 보스는 400 × 2^(살아 있는 호위 수). 챌린지는 모두 100
function killEnemy(st, e) {
  e.dead = true;
  const inForm = e.state === 'form' || e.state === 'path' || e.state === 'wait';
  let pts;
  if (st.challenge) { pts = 100; st.chHits++; }
  else if (e.type === 2) {
    if (inForm) pts = 150;
    else { const n = st.enemies.filter((c) => c.state === 'escort' && c.leader === e && !c.dead).length; pts = 400 * (1 << n); }
  } else pts = [50, 80][e.type] * (inForm ? 1 : 2);
  addScore(st, pts);
  st.events.push({ type: 'kill', x: e.x, y: e.y, pts, kind: e.type });
  if (e.carry && e.state === 'dive') st.rescues.push({ x: e.x, y: e.y, t: 0 });
  if (st.player.cap && st.player.cap.boss === e) st.player.cap = null;
}

function hitPlayer(st) {
  const P = st.player;
  if (P.dual) {
    P.dual = false; P.inv = 1.5;
    st.events.push({ type: 'dualLost', x: P.x + 14, y: P.y });
    return;
  }
  st.events.push({ type: 'playerHit', x: P.x, y: P.y });
  P.alive = false; st.lives--;
  P.respawn = st.lives > 0 ? 2.4 : 2.8;
  st.ebullets = [];
}

// ---------- 내 비행기 ----------
// input: { left, right, fire, touchX(손가락 위치, 없으면 null — 누르고 있으면 계속 쏜다) }
function updatePlayer(st, dt, input) {
  const P = st.player;
  if (P.cap) {
    P.cap.t += dt;
    const b = P.cap.boss, k = Math.min(1, P.cap.t / 1.6);
    P.cx = P.cap.x0 + (b.x - P.cap.x0) * k; P.cy = P.y + (b.y + 24 - P.y) * k; P.spin = k * 6 * PI;
    if (P.cap.t >= 1.6) {
      b.carry = true; b.state = 'home';
      P.cap = null; P.alive = false; st.lives--; P.respawn = 2.6;
      st.banner2 = 'FIGHTER CAPTURED'; st.banner2T = 2.4;
    }
    return;
  }
  if (!P.alive) {
    P.respawn -= dt;
    if (P.respawn <= 0) {
      if (st.lives > 0) { P.alive = true; P.x = W / 2; P.inv = 2; P.dual = false; }
      else { st.state = 'over'; st.events.push({ type: 'over' }); }
    }
    return;
  }
  const sp = 560, m = P.dual ? 34 : 16;
  const touching = input.touchX !== null && input.touchX !== undefined;
  if (input.left) P.x -= sp * dt;
  if (input.right) P.x += sp * dt;
  if (touching) P.x = input.touchX; // 드래그는 손가락 위치를 즉시 따라감
  P.x = clamp(P.x, m, W - m);
  P.inv = Math.max(0, P.inv - dt);
  P.cd = (P.cd || 0) - dt;
  const cap = P.dual ? 6 : 3;
  if ((input.fire || touching) && P.cd <= 0 && st.bullets.length <= cap - (P.dual ? 2 : 1)) {
    if (P.dual) { st.bullets.push({ x: P.x - 14, y: P.y - 18 }, { x: P.x + 14, y: P.y - 18 }); st.shots += 2; }
    else { st.bullets.push({ x: P.x, y: P.y - 18 }); st.shots++; }
    P.cd = 0.12;
    st.events.push({ type: 'shoot' });
  }
}

// ---------- 한 프레임 ----------
function update(st, dt, input = {}) {
  if (st.state !== 'play') return;
  st.t += dt; st.phaseT += dt;
  if (st.banner2T > 0) st.banner2T -= dt;
  const P = st.player;
  updatePlayer(st, dt, input);
  if (st.state !== 'play') return;

  // 적 이동
  for (const e of st.enemies) updateEnemy(st, e, dt);

  // 편대 완성 → 공격 시작
  if (!st.entryDone && !st.challenge && st.enemies.every((e) => (e.state !== 'wait' && e.state !== 'path' && e.state !== 'home') || e.dead)) {
    st.entryDone = true;
  }
  if (st.entryDone && !st.challenge && st.phase === 'play' && P.alive && !P.cap) {
    st.diveT -= dt;
    if (st.diveT <= 0) {
      tryDive(st);
      st.diveT = st.stage === 1 ? 2.2 : st.enemies.length <= 6 ? 0.5 : Math.max(0.6, 2.0 - 0.06 * diff(st));
    }
  }

  // 총알 이동
  for (const b of st.bullets) b.y -= 800 * dt;
  st.bullets = st.bullets.filter((b) => b.y > -20);
  for (const b of st.ebullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
  st.ebullets = st.ebullets.filter((b) => b.y < H + 10 && b.x > -10 && b.x < W + 10);

  // 구출된 파이터
  for (const r of st.rescues) {
    r.t += dt; r.y += 130 * dt;
    if (P.alive && !P.cap) r.x += clamp(P.x - r.x, -170 * dt, 170 * dt);
    if (P.alive && !P.cap && !P.dual && Math.abs(r.x - P.x) < 20 && Math.abs(r.y - P.y) < 22) {
      P.dual = true; r.dead = true;
      st.banner2 = 'DUAL FIGHTER'; st.banner2T = 2.0;
      st.events.push({ type: 'dual' });
    }
    if (r.y > H + 20) r.dead = true;
  }
  st.rescues = st.rescues.filter((r) => !r.dead);

  // 내 총알 vs 적
  for (const b of st.bullets) {
    for (const e of st.enemies) {
      if (e.dead || e.state === 'wait') continue;
      if (Math.abs(b.x - e.x) < 12 && Math.abs(b.y - e.y) < 12) {
        b.y = -100; st.hits++;
        if (e.type === 2 && e.hp > 1) { e.hp--; st.events.push({ type: 'bossHurt', x: e.x, y: e.y }); }
        else killEnemy(st, e);
        break;
      }
    }
  }
  st.enemies = st.enemies.filter((e) => !e.dead);
  for (const e of st.enemies) if (e.state === 'escort' && (!e.leader || e.leader.dead)) { e.state = 'dive'; e.phase = 1; e.shotsLeft = 1; e.fireY = e.y + 60; e.beam = false; }

  // 적/적 총알 vs 플레이어
  if (P.alive && !P.cap && P.inv <= 0 && st.phase !== 'result') {
    const hw = P.dual ? 26 : 11;
    let hit = st.ebullets.some((b) => Math.abs(b.x - P.x) < hw && Math.abs(b.y - P.y) < 12);
    if (!hit) for (const e of st.enemies) {
      if (e.state === 'wait' || e.state === 'form') continue;
      if (Math.abs(e.x - P.x) < hw + 6 && Math.abs(e.y - P.y) < 16) { hit = true; killEnemy(st, e); break; }
    }
    if (hit) hitPlayer(st);
  }
  st.enemies = st.enemies.filter((e) => !e.dead);

  // 스테이지 진행
  if (st.phase === 'play' && st.enemies.length === 0) {
    st.phase = st.challenge ? 'result' : 'clear'; st.phaseT = 0;
    if (st.challenge && st.chHits >= 40) { addScore(st, 10000); st.events.push({ type: 'perfect' }); }
  }
  if (st.phase === 'clear' && st.phaseT > 1.8) startStage(st, st.stage + 1);
  if (st.phase === 'result' && st.phaseT > 4.5) startStage(st, st.stage + 1);
}

return {
  W, H, PI, SX, SY, TOP, PLAYER_Y, clamp, normAng, turnToward, diff, isChallenge,
  newGame, buildPath, groupPath, startStage, home, addScore, maxEB, fire, launchDive, holding, tryDive, updateEnemy, killEnemy, hitPlayer, updatePlayer, update,
};
})();
if (typeof module !== 'undefined') module.exports = LOGIC_GALAGA;
