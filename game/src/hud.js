import { economy, PRICES } from './economy.js';
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
    if (`${hp}:${armor}` === lastHealth) return;
    lastHealth = `${hp}:${armor}`;
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
      ['7', 'helmet', {name:'Helmet',price:350}],
      ['8', 'kit', {name:'Defuse kit · defenders',price:400}],
      ['X', 'smoke', {name:'Smoke grenade',price:300}],
      ['Z', 'flash', {name:'Flashbang',price:200}],
    ];
    for (const [key, id, def] of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'buy-item';
      button.dataset.item = id;
      const detail = id === 'grenade' ? 'HE · radius 6.5 m'
        : id === 'armor' ? 'Absorbs 50% damage'
        : id === 'helmet' ? 'Head protection' : id === 'kit' ? 'Defuse in 2.5 seconds' : id === 'smoke' ? 'Blocks sightlines · X' : id === 'flash' ? 'Blinds enemies · Z' : `${def.damage} dmg · ${def.mag} rnd mag`;
      button.innerHTML = `<b>[${key}] ${def.name}</b><span>${detail}</span><em>$${def.price}</em>`;
      button.addEventListener('click', () => buyHandler && buyHandler(id));
      list.appendChild(button);
    }
  }
  buildBuyMenu();

  function refreshShop() {
    const account = economy.account('You');
    for (const button of els.buy.querySelectorAll('button[data-item]')) {
      const item = button.dataset.item;
      const price = PRICES[item];
      const owned = item === 'armor' ? account.armor >= 100
        : item === 'helmet' || item === 'kit' ? account[item]
        : item === 'smoke' || item === 'flash' ? account[item] >= 2
        : false;
      const unavailable = item === 'kit' && account.team !== 'def';
      button.disabled = account.money < price || owned || unavailable;
      button.title = unavailable ? 'Defenders only' : owned ? 'Already equipped'
        : account.money < price ? `Need $${price-account.money} more` : 'Purchase';
    }
  }
  function showBuy(show) {
    refreshShop();
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
    tactical: drawTactical, direction: damageDirection,
    retake(bomb, defenders, attackers) {
      if(bomb.phase !== 'planted')return;
      const remaining=Math.max(0,bomb.fuseLeft);
      const kit=defenders.some(bot=>bot.kit);
      const required=kit?2.5:5;
      const status=remaining<required?'SAVE — no time to defuse':
        defenders.length===1?'CLUTCH — isolate duels, then defuse':
        'RETAKE — smoke the device, flash before entry';
      els.bombText.textContent=`${status} · ${remaining.toFixed(1)}s · ${attackers} vs ${defenders.length} · ${kit?'KIT 2.5s':'DEFUSE 5s'}`;
      els.bomb.classList.toggle('urgent',remaining<10);
    },
    setCrosshair, hitMarker, damageFlash, feed, banner, showOverlay, hideOverlay,
    showBuy, onBuy, onPlay,
  };
}

const radar=document.createElement('canvas'); radar.width=180;radar.height=180;radar.style='position:fixed;top:95px;left:20px;pointer-events:none';document.body.append(radar);
const veil=document.createElement('div');veil.style='position:fixed;inset:0;background:white;pointer-events:none;opacity:0';document.body.append(veil);
function drawTactical(body,bots,bomb,blind){veil.style.opacity=Math.min(1,blind);const c=radar.getContext('2d');c.clearRect(0,0,180,180);c.fillStyle='#101c24aa';c.fillRect(0,0,180,180);for(const a of [{body,alive:true,team:'atk'},...bots]){if(!a.alive)continue;const x=90+a.body.position.x*2,z=90+a.body.position.z*2;c.fillStyle=a.team==='atk'?'#ffc35a':'#65ddd1';c.beginPath();c.moveTo(x,z);c.arc(x,z,16,-a.body.yaw-Math.PI/2-.4,-a.body.yaw-Math.PI/2+.4);c.closePath();c.fill();c.beginPath();c.arc(x,z,3,0,7);c.fill();}if(bomb.phase==='planted'||bomb.phase==='dropped'){c.fillStyle='red';c.fillRect(87+bomb.x*2,87+bomb.z*2,6,6);}}
function damageDirection(body,source){if(!source)return;radar.style.outline='3px solid #ff5733';radar.title='Damage bearing '+Math.round(Math.atan2(source.x-body.position.x,source.z-body.position.z)*180/Math.PI);setTimeout(()=>radar.style.outline='',500);}
