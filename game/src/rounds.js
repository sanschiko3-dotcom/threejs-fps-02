// Rounds and the economy: the match state machine. Phases are buy (frozen, shop
// open), live (100 s, plant/defuse/elimination), and end (banner, payouts, then
// the next round). Money follows Counter-Strike's shape — kill $300, round win
// $3250, loss $1900 plus a $500 loss-streak bonus — so a lost round still buys a
// rifle two rounds later. The bomb is one object with a phase: carried, planted,
// dropped, or gone. First to 8 rounds takes the match; 7–7 after 14 is a draw.
import { pick, shuffle } from './rng.js';
import { WEAPONS, GRENADE, ARMOR } from './weapons.js';

export const BUY_SECONDS = 6;
export const ROUND_SECONDS = 100;
export const END_SECONDS = 4;
export const WIN_ROUNDS = 8;
const KILL_REWARD = 300;
const WIN_REWARD = 3250;
const LOSS_REWARD = 1900;
const LOSS_STREAK_BONUS = 500;
const PLANT_TIME = 3.5;
const DEFUSE_TIME = 5;
const FUSE_SECONDS = 40;

const PLANS = [
  { atk: ['A', 'A', 'mid', 'B'], def: ['A', 'A', 'B', 'B', 'mid'] },
  { atk: ['B', 'B', 'A', 'mid'], def: ['B', 'B', 'A', 'A', 'mid'] },
  { atk: ['A', 'B', 'mid', 'mid'], def: ['A', 'B', 'mid', 'mid', 'A'] },
  { atk: ['mid', 'A', 'B', 'A'], def: ['mid', 'mid', 'A', 'B', 'B'] },
];

export function createRounds(hooks) {
  const state = {
    phase: 'buy',
    round: 1,
    score: { atk: 0, def: 0 },
    timeLeft: BUY_SECONDS,
    money: 800,
    lossStreak: 0,
    endReason: '',
    endWinner: null,
    plan: PLANS[0],
    bomb: {
      phase: 'carried', // carried | planted | dropped | gone
      site: null,
      x: 0,
      z: 0,
      fuseLeft: FUSE_SECONDS,
      plantProgress: 0,
      defuseProgress: 0,
      carrier: null,
    },
    matchOver: false,
    matchResult: '',
  };

  function drawPlan(random) {
    state.plan = pick(random, PLANS);
    return state.plan;
  }

  function startRound(random) {
    state.phase = 'buy';
    state.timeLeft = BUY_SECONDS;
    state.endReason = '';
    state.endWinner = null;
    state.bomb.phase = 'carried';
    state.bomb.site = null;
    state.bomb.fuseLeft = FUSE_SECONDS;
    state.bomb.plantProgress = 0;
    state.bomb.defuseProgress = 0;
    drawPlan(random);
    hooks.onRoundStart(state.round, state.plan);
  }

  function endRound(winner, reason) {
    if (state.phase === 'end') return;
    state.phase = 'end';
    state.endWinner = winner;
    state.endReason = reason;
    state.timeLeft = END_SECONDS;
    if (winner === 'atk') {
      state.score.atk += 1;
      state.money += WIN_REWARD;
      state.lossStreak = 0;
    } else {
      state.score.def += 1;
      state.money += LOSS_REWARD + Math.min(2, state.lossStreak) * LOSS_STREAK_BONUS;
      state.lossStreak += 1;
    }
    hooks.onRoundEnd(winner, reason, state.score);
    if (state.score.atk >= WIN_ROUNDS || state.score.def >= WIN_ROUNDS) {
      state.matchOver = true;
      state.matchResult = state.score.atk > state.score.def
        ? 'Strikers take the match'
        : state.score.atk < state.score.def
          ? 'Wardens take the match'
          : 'Match drawn';
    }
  }

  function plantBomb(site, byPlayer) {
    if (state.bomb.phase !== 'carried' && state.bomb.phase !== 'dropped') return false;
    state.bomb.phase = 'planted';
    state.bomb.site = site;
    const s = hooks.world.sites[site];
    state.bomb.x = s.x;
    state.bomb.z = s.z;
    state.bomb.fuseLeft = FUSE_SECONDS;
    hooks.onPlant(site, byPlayer);
    return true;
  }

  function dropBomb(x, z) {
    state.bomb.phase = 'dropped';
    state.bomb.x = x;
    state.bomb.z = z;
    hooks.onBombDrop(x, z);
  }

  function pickupBomb(byPlayer) {
    if (state.bomb.phase !== 'dropped') return false;
    state.bomb.phase = 'carried';
    state.bomb.carrier = byPlayer ? 'player' : 'bot';
    hooks.onBombPickup(byPlayer);
    return true;
  }

  function buy(item) {
    const price = item === 'armor' ? ARMOR.price
      : item === 'grenade' ? GRENADE.price
      : WEAPONS[item] ? WEAPONS[item].price : 0;
    if (price === 0 && item !== 'pistol') return false;
    if (state.money < price) return false;
    if (state.phase !== 'buy') return false;
    state.money -= price;
    hooks.onBuy(item, price);
    return true;
  }

  function step(dt, alive) {
    state.timeLeft -= dt;
    if (state.phase === 'buy' && state.timeLeft <= 0) {
      state.phase = 'live';
      state.timeLeft = ROUND_SECONDS;
      hooks.onLive();
    } else if (state.phase === 'live') {
      if (state.bomb.phase === 'planted') {
        state.bomb.fuseLeft -= dt;
        if (state.bomb.fuseLeft <= 0) {
          endRound('atk', 'The device detonated at site ' + state.bomb.site);
          hooks.onExplode(state.bomb.site);
          state.bomb.phase = 'gone';
          return;
        }
      }
      if (state.timeLeft <= 0) {
        endRound('def', 'Time expired — Wardens hold the yard');
      } else if (alive.atk <= 0 && state.bomb.phase !== 'planted') {
        endRound('def', 'Strikers eliminated');
      } else if (alive.def <= 0) {
        endRound('atk', 'Wardens eliminated');
      }
    } else if (state.phase === 'end' && state.timeLeft <= 0) {
      if (state.matchOver) {
        hooks.onMatchEnd(state.matchResult, state.score);
      } else {
        state.round += 1;
        startRound(hooks.random);
      }
    }
  }

  return {
    state,
    startRound,
    endRound,
    plantBomb,
    dropBomb,
    pickupBomb,
    buy,
    step,
    killReward() {
      state.money += KILL_REWARD;
    },
    plantTime: PLANT_TIME,
    defuseTime: DEFUSE_TIME,
  };
}
