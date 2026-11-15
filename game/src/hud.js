// The HUD: DOM over the canvas, updated only when a value changes. It shows
// health, armour, ammunition, the round timer and the score, the money and the
// buy menu during the freeze, a killfeed, the bomb state, and a round banner.
// The crosshair gap grows with movement and firing, so the spread the player
// feels is the spread they see. No game logic lives here — main.js calls setters.
import { WEAPONS, GRENADE, ARMOR } from './weapons.js';

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const els = {
    health: $('health-value'),
    armor: $('armor-value'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    ammo: $('ammo'),
    timer: $('timer-value'),
    scoreAtk: $('score-atk'),
    scoreDef: $('score-def'),
    round: $('round-value'),
    money: $('money-value'),
    aliveAtk: $('alive-atk'),
    aliveDef: $('alive-def'),
    killfeed: $('killfeed'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    buy: $('buy-menu'),
    buyMoney: $('buy-money'),
    bomb: $('bomb-status'),
    bombText: $('bomb-text'),
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    overlay: $('overlay'),
    overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'),
    play: $('play'),
    damage: $('damage-flash'),
  };

  let lastAmmo = '';
  let lastHealth = -1;

  function setHealth(hp, armor) {
    if (hp === lastHealth) return;
    lastHealth = hp;
    els.health.textContent = String(Math.max(0, Math.ceil(hp)));
    els.health.parentElement.classList.toggle('low', hp <= 30);
    els.armor.textContent = armor > 0 ? `+${Math.ceil(armor)}` : '';
  }

  function setAmmo(mag, reserve, grenades) {
    const key = `${mag}/${reserve}/${grenades}`;
    if (key === lastAmmo) return;
    lastAmmo = key;
    els.ammoMag.textContent = String(mag);
    els.ammoReserve.textContent = `/ ${reserve}   ◉ ${grenades}`;
    els.ammo.classList.toggle('empty', mag === 0);
  }

  function setTimer(seconds, planted) {
    const s = Math.max(0, Math.ceil(seconds));
    els.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    els.timer.classList.toggle('planted', !!planted);
  }

  function setScore(atk, def, round) {
    els.scoreAtk.textContent = String(atk);
    els.scoreDef.textContent = String(def);
    els.round.textContent = `ROUND ${round}`;
  }

  function setMoney(money) {
    els.money.textContent = `$${money.toLocaleString('en-US')}`;
    els.buyMoney.textContent = `$${money.toLocaleString('en-US')}`;
  }

  function setAlive(atk, def) {
    els.aliveAtk.textContent = `▲ ${atk}`;
    els.aliveDef.textContent = `● ${def}`;
  }

  function setBomb(text, kind) {
    els.bombText.textContent = text;
    els.bomb.className = kind ? `show ${kind}` : '';
  }

  function setCrosshair(spread) {
    const gap = 3 + spread * 260;
    els.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
  }

  function hitMarker(kill) {
    els.hitmarker.classList.add('on');
    els.hitmarker.classList.toggle('kill', !!kill);
    setTimeout(() => els.hitmarker.classList.remove('on', 'kill'), 110);
  }

  function damageFlash() {
    els.damage.classList.remove('on');
    void els.damage.offsetWidth; // restart the CSS animation
    els.damage.classList.add('on');
  }

  function feed(text, good) {
    const line = document.createElement('div');
    line.className = `feed-line${good ? ' good' : ''}`;
    line.textContent = text;
    els.killfeed.prepend(line);
    while (els.killfeed.children.length > 5) els.killfeed.lastChild.remove();
    setTimeout(() => line.remove(), 6000);
  }

  let bannerTimer = 0;
  function banner(title, sub, ms = 2600) {
    els.bannerTitle.textContent = title;
    els.bannerSub.textContent = sub || '';
    els.banner.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => els.banner.classList.remove('show'), ms);
  }

  function showOverlay(kind, score) {
    els.overlay.hidden = false;
    if (kind === 'start') {
      els.overlayTitle.textContent = 'SOLSTICE YARD';
      els.overlayCopy.textContent = '5v5 plant / defuse at a solar station at dusk. Plant the device or wipe the Wardens. First to 8 rounds takes the match.';
      els.play.textContent = 'Click to play';
    } else if (kind === 'paused') {
      els.overlayTitle.textContent = 'Paused';
      els.overlayCopy.textContent = `Score ${score}. Click to resume.`;
      els.play.textContent = 'Resume';
    } else if (kind === 'end') {
      els.overlayTitle.textContent = 'Round over';
      els.overlayCopy.textContent = score;
      els.play.textContent = 'Next round';
    }
  }
  function hideOverlay() {
    els.overlay.hidden = true;
  }

  // Buy menu: buttons for each weapon, grenade and armour, plus the key hints.
  // Clicking a button calls onBuy; main.js decides whether the purchase lands.
  let buyHandler = null;
  function buildBuyMenu() {
    const list = els.buy.querySelector('.buy-items');
    list.innerHTML = '';
    const items = [
      ['1', 'pistol', WEAPONS.pistol],
      ['2', 'smg', WEAPONS.smg],
      ['3', 'rifle', WEAPONS.rifle],
      ['4', 'sniper', WEAPONS.sniper],
      ['5', 'grenade', GRENADE],
      ['6', 'armor', ARMOR],
    ];
    for (const [key, id, def] of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'buy-item';
      button.dataset.item = id;
      const detail = id === 'grenade' ? 'HE · radius 6.5 m'
        : id === 'armor' ? 'Absorbs 50% damage'
        : `${def.damage} dmg · ${def.mag} rnd mag`;
      button.innerHTML = `<b>[${key}] ${def.name}</b><span>${detail}</span><em>$${def.price}</em>`;
      button.addEventListener('click', () => buyHandler && buyHandler(id));
      list.appendChild(button);
    }
  }
  buildBuyMenu();

  function showBuy(show) {
    els.buy.classList.toggle('show', !!show);
  }
  function onBuy(handler) {
    buyHandler = handler;
  }
  function onPlay(handler) {
    els.play.addEventListener('click', handler);
  }

  return {
    setHealth, setAmmo, setTimer, setScore, setMoney, setAlive, setBomb,
    setCrosshair, hitMarker, damageFlash, feed, banner, showOverlay, hideOverlay,
    showBuy, onBuy, onPlay,
  };
}
