import { EventBus } from '../../utils/EventBus.js';
/** Active-game clock, independent from cosmetic Game.time. One day lasts twelve real minutes. */
export class DayNightCycle extends EventBus {
  constructor(game){super();this.game=game;this.hour=12;this.cycleSeconds=720;this.paused=false;this.darkness=0;this.period='day';this.spawnMultiplier=1;}
  /** Exact gameplay boundaries; visuals ease independently over five seconds. */
  refresh(){const h=this.hour;const p=h>=6&&h<17?'day':h>=17&&h<19?'dusk':'night';if(p!==this.period){this.period=p;const event={period:p,hour:h};this.emit('time:change',event);this.game.mapManager?.emit('time:change',event);}this.spawnMultiplier=p==='day'?1:p==='dusk'?1.1:1.5;}
  /** Force a time in [0,24), optionally freeze the clock for debugging. */
  force(hour,{pause=true}={}){if(!Number.isFinite(hour)||hour<0||hour>=24)throw new Error('Invalid hour');this.hour=hour;this.paused=pause;this.refresh();}
  /** Resume automatic clock advance. */
  resume(){this.paused=false;}
  /** Toggle an individual battery torch; depleted batteries cannot turn on. */
  toggle(player=this.game.player){this.initTorch(player);if(player.flashlightOn)player.flashlightOn=false;else if(player.flashlightBattery>0)player.flashlightOn=true;}
  /** Initialize newly joined players without retaining bodies in a separate collection. */
  initTorch(p){p.flashlightBattery??=100;p.flashlightOn??=false;}
  /** Update only during active gameplay; clients interpolate without draining host batteries. */
  update(dt,{authoritative=true}={}){if(!this.paused)this.hour=(this.hour+24*dt/this.cycleSeconds)%24;this.refresh();const target=this.period==='day'?0:this.period==='dusk'?.45:1;this.darkness+=(target-this.darkness)*(1-Math.exp(-dt/5));for(const p of this.game.players??[]){this.initTorch(p);if(!authoritative)continue;if(p.flashlightOn&&!p.dead){p.flashlightBattery=Math.max(0,p.flashlightBattery-dt*100/90);if(p.flashlightBattery===0)p.flashlightOn=false;}else p.flashlightBattery=Math.min(100,p.flashlightBattery+dt*(this.period==='day'?2:.4));}}
  /** Add bounded shared lighting using the existing cached cone masks. */
  addLights(L,camX,camY){for(const p of this.game.players??[]){this.initTorch(p);if(!p.dead&&p.flashlightOn&&p.flashlightBattery>0&&(p.floor??0)===this.game.map.floor)L.cone(p.pos.x-camX,p.pos.y-camY-6,p.aim,215,.58,.95);}}
  /** Clock/battery status drawn after world effects, without allocating text-cache canvases. */
  drawHUD(ctx){const p=this.game.player;this.initTorch(p);ctx.save();ctx.font='bold 10px monospace';ctx.fillStyle='#d7d6bd';const hh=Math.floor(this.hour),mm=Math.floor((this.hour-hh)*60);ctx.fillText(`${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')} ${this.period.toUpperCase()} • LIGHT [L] ${p.flashlightOn?'ON':'OFF'} ${Math.ceil(p.flashlightBattery)}%`,12,146);ctx.restore();}
  /** JSON-safe host state and per-player battery inventory. */
  serialize(){return {version:1,hour:this.hour,paused:this.paused,darkness:this.darkness,lights:(this.game.players??[]).map(p=>({id:p.netId??0,on:!!p.flashlightOn,battery:p.flashlightBattery??100}))};}
  /** Atomic snapshot validation; never trust malformed time or battery values. */
  restore(s){if(!s||s.version!==1||!Number.isFinite(s.hour)||s.hour<0||s.hour>=24||typeof s.paused!=='boolean'||!Number.isFinite(s.darkness)||s.darkness<0||s.darkness>1||!Array.isArray(s.lights)||s.lights.length>16||s.lights.some(l=>!l||!Number.isInteger(l.id)||typeof l.on!=='boolean'||!Number.isFinite(l.battery)||l.battery<0||l.battery>100))throw new Error('Invalid clock snapshot');this.hour=s.hour;this.paused=s.paused;this.darkness=s.darkness;this.refresh();for(const l of s.lights){const p=this.game.players?.find(p=>(p.netId??0)===l.id);if(p){p.flashlightOn=l.on;p.flashlightBattery=l.battery;}}}
}
