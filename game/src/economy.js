// Persistent accounts survive entity respawns;
//  equipment survives only with its owner.
export const PRICES = Object.freeze({
  pistol:300,
  smg:1200,
  rifle:2700,
  sniper:4750,armor:650,helmet:350,smoke:300,flash:200,kit:400,grenade:300});
export const DIFFICULTY = Object.freeze({rookie:{reaction:.75,error:1.6,discipline:.5,utility:.35},veteran:{reaction:.45,error:1,discipline:.85,utility:.75},elite:{reaction:.23,error:.55,discipline:1,utility:1}});
export function createEconomy(){
  const accounts=new Map();
  const history=[];
  let decisions=null;
  let round=0;
  const streak={atk:0,def:0};
  function account(id,team='atk'){
    if(!accounts.has(id)) accounts.set(id,{id,team,money:800,weapon:'pistol',armor:0,helmet:false,kit:false,smoke:0,flash:0,alive:false});
    return accounts.get(id);
  }
  function credit(a,value,reason='reward'){
    const before=a.money;
    a.money=Math.min(16000,a.money+value);
    history.push({round,id:a.id,item:reason,delta:a.money-before,balance:a.money});
    if(history.length>500)history.shift();
  }
  function purchase(a,item){
    const price=PRICES[item];
    if (!Object.hasOwn(PRICES, item) || !Number.isFinite(price) || a.money < price) return false;
    if (['pistol','smg','rifle','sniper'].includes(item) && a.weapon === item) return false;
    if(['helmet','kit'].includes(item)&&a[item])return false;
    if(item==='kit'&&a.team!=='def')return false;
    if(['smoke','flash'].includes(item)&&a[item]>=2)return false;
    if(item==='armor'&&a.armor>=100)return false;
    a.money-=price;
    history.push({round,id:a.id,item,delta:-price,balance:a.money});
    if(['pistol','smg','rifle','sniper'].includes(item))a.weapon=item;
    else if(item==='armor')a.armor=100;
    else if(['helmet','kit'].includes(item))a[item]=true;
    else a[item]=(a[item]||0)+1;
    return true;
  }
  function beginRound(){
    round++;
    decisions={atk:teamDecision('atk'),def:teamDecision('def')};
    return decisions;
  }
  function consume(id,item){
    const a=account(id);
    if(!['smoke','flash','grenade'].includes(item)||!a[item])return false;
    a[item]--;
    return true;
  }
  function snapshot(team){
    return [...accounts.values()].filter(a=>a.team===team).map(a=>({...a}));
  }
  function settle(winner){
    for(const team of ['atk','def']){
      const reward=team===winner?3250:Math.min(3400,1900+500*streak[team]);
      for(const a of accounts.values())if(a.team===team)credit(a,reward);
      streak[team]=team===winner?0:streak[team]+1;
    }
  }
  function teamDecision(team){
    const members=[...accounts.values()].filter(a=>a.team===team);
    const mean=members.reduce((n,a)=>n+a.money,0)/Math.max(1,members.length);
    return mean>=3900?'full':mean>=2000?'force':'eco';
  }
  function equipBot(a,tier='veteran'){
    const decision=decisions?.[a.team]||teamDecision(a.team);
    if(!a.alive)Object.assign(a,{weapon:'pistol',armor:0,helmet:false,kit:false,smoke:0,flash:0});
    const discipline=DIFFICULTY[tier].discipline;
    if(decision==='eco'&&discipline>=.8)return decision;
    if(a.weapon==='pistol')purchase(a,decision==='full'?'rifle':'smg');
    purchase(a,'armor');
    if(decision==='full'){
      purchase(a,'helmet');
      if(a.team==='def')purchase(a,'kit');
      purchase(a,'smoke');
purchase(a,'flash');
    }
    return decision;
  }
  function canAffordLoadout(id, items) {
    const a = account(id);
    let cost = 0;
    for (const item of items) {
      if (!Object.hasOwn(PRICES, item)) return false;
      if (item === 'kit' && a.team !== 'def') return false;
      cost += PRICES[item];
    }
    return a.money >= cost;
  }
  function report(team) {
    const members = snapshot(team);
    const total = members.reduce((sum, a) => sum + a.money, 0);
    const armed = members.filter(a => a.weapon !== 'pistol').length;
    const kits = members.filter(a => a.kit).length;
    const utility = members.reduce((sum, a) => sum + a.smoke + a.flash, 0);
    return {
      team,
      total,
      average: total / Math.max(1, members.length),
      decision: decisions?.[team] || teamDecision(team),
      armed,
      kits,
      utility,
      lossStreak: streak[team],
      nextLossReward: Math.min(3400, 1900 + 500 * streak[team]),
      members,
    };
  }
  return {accounts,history,report,canAffordLoadout,account,purchase,settle,teamDecision,equipBot,beginRound,consume,snapshot,kill(id){
    const a=account(id);
    const reward={
  pistol:300,
  smg:600,
  rifle:300,
  sniper:100}[a.weapon]||300;
    credit(a,reward,'kill');
  }};
}
export const economy=createEconomy();
