import { economy } from './economy.js';
import { pick } from './rng.js';

export const BUY_SECONDS = 10;
export const ROUND_SECONDS = 100;
export const END_SECONDS = 4;
export const WIN_ROUNDS = 8;
const FUSE_SECONDS = 40;
const PLANT_SECONDS = 3.5;
const DEFUSE_SECONDS = 5;
const POINTS = { kills: 100, damage: 1, plants: 150, defuses: 200, mvps: 0 };
const PLANS = [
  { name: 'A execute', atk: ['A', 'A', 'mid', 'B'], def: ['A', 'A', 'B', 'B', 'mid'] },
  { name: 'B execute', atk: ['B', 'B', 'A', 'mid'], def: ['B', 'B', 'A', 'A', 'mid'] },
  { name: 'split', atk: ['A', 'B', 'mid', 'mid'], def: ['A', 'B', 'mid', 'mid', 'A'] },
  { name: 'mid hold', atk: ['mid', 'A', 'B', 'A'], def: ['mid', 'mid', 'A', 'B', 'B'] },
];

function freshBomb() {
  return {
    phase: 'carried',
    site: null,
    x: 0,
    z: 0,
    fuseLeft: FUSE_SECONDS,
    plantProgress: 0,
    defuseProgress: 0,
    carrier: null,
  };
}

function freshStats() {
  return { kills: 0, damage: 0, plants: 0, defuses: 0, mvps: 0, points: 0 };
}

export function createRounds(hooks) {
  let matchReported = false;
  let payoutRound = 0;
  const state = {
    stats: {},
    roundStats: {},
    mvp: '',
    phase: 'buy',
    round: 1,
    score: { atk: 0, def: 0 },
    timeLeft: BUY_SECONDS,
    get money() { return economy.account('You').money; },
    set money(value) { economy.account('You').money = Math.max(0, Math.min(16000, value)); },
    lossStreak: 0,
    endReason: '',
    endWinner: null,
    plan: PLANS[0],
    bomb: freshBomb(),
    retake: { active: false, clutch: false, attackers: 0, defenders: 0, urgent: false },
    matchOver: false,
    matchResult: '',
  };

  function record(name, key, amount = 1) {
    if (!(key in POINTS) || !Number.isFinite(amount) || amount < 0) return;
    for (const table of [state.stats, state.roundStats]) {
      const entry = table[name] ||= freshStats();
      entry[key] += amount;
      entry.points += amount * POINTS[key];
    }
  }

  function drawPlan(random) {
    const selected = pick(random, PLANS);
    const saving = economy.teamDecision('atk') === 'eco';
    state.plan = {
      name: saving ? 'save' : selected.name,
      atk: saving ? ['mid', 'A', 'mid', 'B'] : [...selected.atk],
      def: [...selected.def],
    };
    return state.plan;
  }

  function startRound(random = hooks.random) {
    if (state.matchOver) return false;
    economy.beginRound();
    state.roundStats = {};
    state.phase = 'buy';
    state.timeLeft = BUY_SECONDS;
    state.endReason = '';
    state.endWinner = null;
    Object.assign(state.bomb, freshBomb());
    Object.assign(state.retake, {
      active: false, clutch: false, attackers: 0, defenders: 0, urgent: false,
    });
    drawPlan(random);
    hooks.onRoundStart(state.round, state.plan);
    return true;
  }

  function endRound(winner, reason) {
    if (!['atk', 'def'].includes(winner)) return false;
    if (state.phase === 'end' || state.matchOver || payoutRound === state.round) return false;
    payoutRound = state.round;
    state.phase = 'end';
    state.endWinner = winner;
    state.endReason = reason;
    state.timeLeft = END_SECONDS;
    state.score[winner]++;
    state.lossStreak = winner === 'atk' ? 0 : state.lossStreak + 1;
    state.retake.active = false;
    economy.settle(winner);
    const ranked = Object.entries(state.roundStats).sort((a, b) => b[1].points - a[1].points);
    state.mvp = ranked[0]?.[0] || 'Team effort';
    if (ranked.length) record(state.mvp, 'mvps');
    if (state.score.atk >= WIN_ROUNDS || state.score.def >= WIN_ROUNDS) {
      state.matchOver = true;
      state.matchResult = winner === 'atk' ? 'Strikers take the match' : 'Wardens take the match';
    }
    hooks.onRoundEnd(winner, reason, state.score);
    return true;
  }

  function plantBomb(site, byPlayer) {
    const bomb = state.bomb;
    if (state.phase !== 'live' || !hooks.world.sites[site]) return false;
    if (!['carried', 'dropped'].includes(bomb.phase)) return false;
    const location = hooks.world.sites[site];
    Object.assign(bomb, {
      phase: 'planted', site, x: location.x, z: location.z,
      fuseLeft: FUSE_SECONDS, carrier: null, defuseProgress: 0,
    });
    state.retake.active = true;
    hooks.onPlant(site, byPlayer);
    return true;
  }

  function dropBomb(x, z) {
    const bomb = state.bomb;
    if (state.phase !== 'live' || bomb.phase !== 'carried') return false;
    Object.assign(bomb, { phase: 'dropped', x, z, carrier: null, plantProgress: 0 });
    hooks.onBombDrop(x, z);
    return true;
  }

  function pickupBomb(byPlayer) {
    if (state.phase !== 'live' || state.bomb.phase !== 'dropped') return false;
    state.bomb.phase = 'carried';
    state.bomb.carrier = byPlayer ? 'player' : 'bot';
    hooks.onBombPickup(byPlayer);
    return true;
  }

  function buy(item) {
    if (state.phase !== 'buy' || state.matchOver) return false;
    const account = economy.account('You');
    const before = account.money;
    if (!economy.purchase(account, item)) return false;
    hooks.onBuy(item, before - account.money);
    return true;
  }

  function updateRetake(alive) {
    const retake = state.retake;
    retake.active = state.bomb.phase === 'planted';
    retake.attackers = alive.atk;
    retake.defenders = alive.def;
    retake.clutch = retake.active && (alive.atk === 1 || alive.def === 1);
    retake.urgent = retake.active && state.bomb.fuseLeft < 10;
  }

  function resolveLive(dt, alive) {
    const bomb = state.bomb;
    updateRetake(alive);
    if (bomb.phase === 'planted') {
      bomb.fuseLeft = Math.max(0, bomb.fuseLeft - dt);
      if (bomb.fuseLeft === 0) {
        const site = bomb.site;
        bomb.phase = 'gone';
        endRound('atk', `The device detonated at site ${site}`);
        hooks.onExplode(site);
        return;
      }
    }
    if (alive.def <= 0) {
      endRound('atk', 'Wardens eliminated');
      return;
    }
    if (bomb.phase === 'planted') return;
    if (alive.atk <= 0) {
      endRound('def', 'Strikers eliminated');
    } else if (state.timeLeft <= 0) {
      endRound('def', 'Time expired — Wardens hold the yard');
    }
  }

  function step(dt, alive) {
    if (!Number.isFinite(dt) || dt <= 0 || matchReported) return;
    state.timeLeft = Math.max(0, state.timeLeft - dt);
    if (state.phase === 'buy') {
      if (state.timeLeft > 0) return;
      state.phase = 'live';
      state.timeLeft = ROUND_SECONDS;
      hooks.onLive();
      return;
    }
    if (state.phase === 'live') {
      resolveLive(dt, alive);
      return;
    }
    if (state.phase !== 'end' || state.timeLeft > 0) return;
    if (state.matchOver) {
      matchReported = true;
      hooks.onMatchEnd(state.matchResult, state.score);
      return;
    }
    state.round++;
    startRound(hooks.random);
  }

  function statsLine() {
    return Object.entries(state.stats).map(([name, s]) =>
      `${name}: ${s.kills} K / ${Math.round(s.damage)} DMG / ${s.plants} P / ${s.defuses} D / ${s.mvps} MVP`
    ).join(' · ');
  }

  return {
    state, record, statsLine, startRound, endRound, plantBomb,
    dropBomb, pickupBomb, buy, step,
    killReward() { economy.kill('You'); },
    plantTime: PLANT_SECONDS,
    defuseTime: DEFUSE_SECONDS,
  };
}
