import { EventBus } from '../../utils/EventBus.js';
import { TILE } from '../../art.js';
import { audio } from '../../audio.js';
import { EnvironmentRenderer } from '../environment/EnvironmentRenderer.js';
import { WEATHER_STATES, WEATHER_ORDER, weatherId, weatherWeights, validateWeather } from './WeatherState.js';
import { RainEffect } from './effects/RainEffect.js';
import { FogEffect } from './effects/FogEffect.js';
import { StormEffect } from './effects/StormEffect.js';
import { SnowEffect } from './effects/SnowEffect.js';
const CAPS={low:[48,36],medium:[96,72],high:[160,120]};
/** Device capability hint, further reduced by the existing frame-quality governor. */
export function weatherDeviceQuality(){const n=globalThis.navigator,h=n?.hardwareConcurrency??8,m=n?.deviceMemory??8;return h<=2||m<=2?'low':h<=4||m<=4?'medium':'high';}
/** Smooth, serializable weather state; hosts alone schedule/damage, clients only interpolate visuals. */
export class WeatherManager extends EventBus {
  constructor(game,config={}){
    super();validateWeather(config,game.map.floors.length);this.game=game;this.config=config;
    this.duration=config.transitionSeconds??8;this.period=config.intervalSeconds??180;this.waveEvery=config.waveEvery??4;
    this.state=weatherId(config.initial??'clear');this.weights=weatherWeights(this.state);this.from={...this.weights};this.transition=this.duration;
    this.elapsed=0;this.autoTimer=0;this.lastWave=0;this.locked=false;this.paused=false;this.rng=(config.seed??0x715aa37)>>>0;
    this.stormTimer=this.nextStormTime()-1.2;this.pending=null;this.lastStrike=null;this.strikeId=0;this.heardStrike=0;this.emitTimer=0;
    this.modifiers={speed:1,accuracy:1,spread:1,drift:1,visibility:1,spawnDistance:1,muffle:0};
    this.deviceQuality=weatherDeviceQuality();this.quality=this.deviceQuality;this.visualsEnabled=true;
    this.rain=new RainEffect();this.fog=new FogEffect();this.snow=new SnowEffect();this.storm=new StormEffect();this.renderer=new EnvironmentRenderer(64);this.actors=[];
    this.recompute();
  }
  /** Emit weather events locally and on the shared session event hub. */
  publish(type,payload){this.emit(type,payload);this.game.mapManager?.emit(type,payload);}
  /** Seeded gameplay randomness, independent of particles/device quality. */
  random(){this.rng=(Math.imul(this.rng,1664525)+1013904223)>>>0;return this.rng/4294967296;}
  /** Storm strike interval stays within the requested 10–20 second bounds. */
  nextStormTime(){return 10+this.random()*10;}
  /** Force a mode; mid-transition forcing starts at current weights without discontinuity. */
  force(value,{immediate=false,lock=true}={}){
    const id=weatherId(value);this.from={...this.weights};this.state=id;this.locked=lock;this.transition=immediate?this.duration:0;this.autoTimer=0;
    if(immediate)Object.assign(this.weights,weatherWeights(id));
    if(id!=='storm'){this.pending=null;this.stormTimer=this.nextStormTime()-1.2;}
    this.recompute();this.publish('weather:change',{state:id,locked:this.locked,transitionSeconds:immediate?0:this.duration});return this.state;
  }
  /** Cycle canonical modes using the same debug/scheduler path. */
  cycle(options={}){return this.force(WEATHER_ORDER[(WEATHER_ORDER.indexOf(this.state)+1)%WEATHER_ORDER.length],options);}
  /** Restore timed/wave automatic changes without changing the current mode abruptly. */
  resumeAutomatic(){this.locked=false;this.autoTimer=0;}
  /** Set cosmetics policy without touching any gameplay modifier or hazard timer. */
  setVisualPolicy(enabled,quality=this.deviceQuality){if(!Object.hasOwn(CAPS,quality))throw new Error('Unknown weather quality');this.visualsEnabled=!!enabled;this.quality=quality;}
  /** Refresh a stable modifier object, composed from current interpolation weights. */
  recompute(){const w=this.weights;const accuracy=1-.15*w.rain;
    Object.assign(this.modifiers,{speed:1-.25*w.snow,accuracy,spread:1/accuracy,drift:1+.1*w.rain,visibility:1-.6*w.fog,spawnDistance:1-.3*w.fog,muffle:w.rain});
    audio.setWeatherMuffle?.(this.modifiers.muffle);
  }
  /** Gameplay visibility radius (baseline covers the whole logical viewport). */
  visibilityRadius(){return Math.hypot(400,250)*this.modifiers.visibility;}
  /** Cull fog-hidden actors and minimap/aim markers using identical visibility. */
  visible(pos,floor=this.game.map.floor){if(this.weights.fog<.01)return true;if(floor!==this.game.map.floor)return false;return Math.hypot(pos.x-this.game.player.pos.x,pos.y-this.game.player.pos.y)<=this.visibilityRadius();}
  /** Permit a legal reachable spawn 30% closer at full fog, never visibly materializing. */
  adjustSpawn(pick){
    if(!pick||this.weights.fog<.1||pick.floor!==this.game.map.floor)return pick;
    const g=this.game,m=g.map,s=pick.s??pick,p=g.player.pos,dx=s.x-p.x,dy=s.y-p.y;
    const x=p.x+dx*this.modifiers.spawnDistance,y=p.y+dy*this.modifiers.spawnDistance;
    const tx=Math.floor(x/24),ty=Math.floor(y/24);let best=null,bestD=Infinity;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const nx=tx+dx,ny=ty+dy,px=(nx+.5)*24,py=(ny+.5)*24,i=m.idx(nx,ny);
      if(!m.inside(nx,ny)||m.solidAt(nx,ny)||m._inSolid({x:px,y:py},12,pick.floor)||m.blockedAt(px,py,12,pick.floor)||m.dist[i]>=0x3fffffff||Math.hypot(px-p.x,py-p.y)<=this.visibilityRadius()+30||g.bus?.body.distance(px,py)<30)continue;
      const d=Math.hypot(px-x,py-y);if(d<bestD){best={...pick,s:{x:px,y:py,tx:nx,ty:ny}};bestD=d;}
    }
    return best??pick;
  }
  /** Require outdoor declaration/ground type and a clear local neighborhood for a strike. */
  isOpen(x,y,floor=this.game.map.floor){
    const m=this.game.map,F=m.floors[floor];if(!F)return false;
    const tx=Math.floor(x/24),ty=Math.floor(y/24),t=F.tiles[m.idx(tx,ty)],areas=this.config.openAreas;
    if(areas?.length){if(!areas.some(a=>a.floor===floor&&x>=a.x&&y>=a.y&&x<=a.x+a.width&&y<=a.y+a.height))return false;}
    else if(t!==TILE.EXTERIOR&&t!==TILE.ROOF)return false;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(m.solidTileOn(floor,tx+dx,ty+dy))return false;
    return !m.blockedAt(x,y,24,floor);
  }
  /** Bounded open-area selection, never a full grid scan. */
  strikePoint(){const m=this.game.map,areas=this.config.openAreas??[];
    for(let i=0;i<32;i++){const a=areas.length?areas[Math.floor(this.random()*areas.length)]:{x:24,y:24,width:(m.w-2)*24,height:(m.h-2)*24,floor:0};const point={x:a.x+this.random()*a.width,y:a.y+this.random()*a.height,floor:a.floor};if(this.isOpen(point.x,point.y,point.floor))return point;}return null;
  }
  /** Commit one authoritative 150-damage strike; protection overrides are limited to lightning. */
  strike(point){
    if(!this.isOpen(point.x,point.y,point.floor))return false;
    const g=this.game,radius=48;this.lastStrike={...point,radius,id:++this.strikeId,remaining:.8};
    for(const p of g.players??[g.player])if(!p.dead&&(p.floor??0)===point.floor&&Math.hypot(p.pos.x-point.x,p.pos.y-point.y)<=radius+p.r)p.hurt(150,point.x,point.y,g,{ignoreInvulnerability:true,bypassProtection:true});
    for(const z of g.zombies??[])if(!z.dead&&!z.remove&&(z.floor??0)===point.floor&&Math.hypot(z.pos.x-point.x,z.pos.y-point.y)<=radius+z.r){if(z.hurt(150,false,g,Math.atan2(z.pos.y-point.y,z.pos.x-point.x))===2)g.onZombieKilled(z,false,null,'lightning');}
    const b=g.bus?.body;if(b&&point.floor===0&&b.distance(point.x,point.y)<=radius)b.hp=Math.max(0,b.hp-150);
    if(this.visualsEnabled)g.particles?.spark(point.x,point.y,-Math.PI/2,12,'#d9f0ff');
    g.shake?.(4,.2);this.playThunder();this.publish('weather:strike',{...this.lastStrike,damage:150});return true;
  }
  /** Play each committed strike once, including received host snapshots. */
  playThunder(){if(this.lastStrike&&this.heardStrike!==this.lastStrike.id){this.heardStrike=this.lastStrike.id;audio.explosion?.();}}
  /** Advance interpolated state and cosmetics; only an authority schedules hazards. */
  update(dt,{authoritative=true}={}){
    if(this.paused)return;this.elapsed+=dt;
    this.transition=Math.min(this.duration,this.transition+dt);const a=this.transition/this.duration,t=a*a*(3-2*a);
    for(const id of WEATHER_ORDER)this.weights[id]=this.from[id]+((id===this.state?1:0)-this.from[id])*t;
    this.recompute();
    if(authoritative&&!this.locked&&!this.game.rangeMode){this.autoTimer+=dt;if(this.autoTimer>=this.period)this.cycle({lock:false});}
    if(this.lastStrike){this.lastStrike.remaining=Math.max(0,this.lastStrike.remaining-dt);}
    if(authoritative){
      if(this.state==='storm'&&this.weights.storm>=.5){
        if(this.pending){this.pending.countdown-=dt;if(this.pending.countdown<=0){this.strike(this.pending);this.pending=null;this.stormTimer=this.nextStormTime()-1.2;}}
        else if((this.stormTimer-=dt)<=0){const p=this.strikePoint();if(p){this.stormTimer=0;this.pending={...p,radius:48,countdown:1.2};this.publish('weather:warning',{...this.pending});}else this.stormTimer=2;}
      }else this.pending=null;
    }else if(this.pending)this.pending.countdown=Math.max(0,this.pending.countdown-dt);
    const [rainCap,snowCap]=CAPS[this.quality],visual=this.visualsEnabled?1:0;
    this.rain.update(dt,this.weights.rain+this.weights.storm,rainCap*visual);this.snow.update(dt,this.weights.snow,snowCap*visual);
    this.emitTimer-=dt;if(this.emitTimer<=0){this.emitTimer=.25;this.publish('weather:modifiers',{...this.modifiers});}
  }
  /** Wave changes are host-owned; direct debug startRound(N) initializes rather than skipping modes. */
  onWave(n){const previous=this.lastWave;this.lastWave=n;if(previous>0&&n>previous&&!this.locked&&!this.game.rangeMode&&Math.floor(n/this.waveEvery)>Math.floor(previous/this.waveEvery))this.cycle({lock:false});}
  /** Record moved footprints after actors/bus have reached their final positions. */
  afterUpdate(){this.actors.length=0;this.actors.push(...(this.game.players??[]),...(this.game.zombies??[]));if(this.game.bus)this.actors.push(this.game.bus.body);this.snow.track(this.actors,this.weights.snow,this.visualsEnabled);}
  /** Render only ground mechanics inside the world's existing camera transform. */
  drawGround(ctx){this.snow.drawGround(ctx,this.game.map.floor,this.visualsEnabled?this.weights.snow:0);this.storm.drawGround(ctx,this.pending,this.lastStrike,this.game.map.floor);}
  /** Render screen weather after world light/grade but before HUD. Fog cannot be toggled away. */
  drawOverlay(ctx){const cosmetic=this.visualsEnabled&&this.game.settings?.get('weather')!==false&&this.game._perfStage<2;
    if(cosmetic){this.rain.draw(ctx,this.weights.rain+this.weights.storm);this.snow.draw(ctx,this.weights.snow);}
    this.fog.draw(ctx,this.game.player.pos.x-this.game.cam.x,this.game.player.pos.y-this.game.cam.y,this.visibilityRadius(),this.weights.fog);this.storm.draw(ctx,this.lastStrike,cosmetic);
  }
  /** Cached state caption and mandatory storm warning; transition text is quantized to bound caches. */
  drawHUD(ctx){ctx.save();ctx.font='bold 10px monospace';ctx.fillStyle='#bdd4dc';ctx.textAlign='left';const progress=this.transition<this.duration?` ${Math.ceil(this.transition/this.duration*10)*10}%`:'';this.renderer.label(ctx,`${WEATHER_STATES[this.state].label.toUpperCase()}${progress} • F6`,12,132);
    if(this.pending){ctx.fillStyle='#ffe1a0';ctx.textAlign='center';this.renderer.label(ctx,'LIGHTNING IN OPEN AREA • AVOID GOLD CIRCLE',400,115);}ctx.restore();}
  /** JSON-safe gameplay state; cosmetic particle/trail history is deliberately not persisted. */
  serialize(){return {version:1,state:this.state,weights:{...this.weights},from:{...this.from},transition:this.transition,elapsed:this.elapsed,autoTimer:this.autoTimer,lastWave:this.lastWave,locked:this.locked,paused:this.paused,rng:this.rng,stormTimer:this.stormTimer,pending:this.pending?{...this.pending}:null,lastStrike:this.lastStrike?{...this.lastStrike}:null,strikeId:this.strikeId};}
  /** Validate a save/network snapshot atomically before restoring authoritative timers/RNG. */
  restore(s){
    if(!s||s.version!==1)throw new Error('Invalid weather snapshot');const state=weatherId(s.state);
    const validVector=v=>v&&WEATHER_ORDER.every(id=>Number.isFinite(v[id])&&v[id]>=0&&v[id]<=1)&&Math.abs(WEATHER_ORDER.reduce((a,id)=>a+v[id],0)-1)<.00001;
    const nums=['transition','elapsed','autoTimer','lastWave','rng','stormTimer','strikeId'];
    const point=p=>!p||(Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.y>=0&&p.x<this.game.map.w*24&&p.y<this.game.map.h*24&&Number.isInteger(p.floor)&&p.floor>=0&&p.floor<this.game.map.floors.length&&p.radius===48);
    if(!validVector(s.weights)||!validVector(s.from)||!nums.every(k=>Number.isFinite(s[k])&&s[k]>=0)||s.transition>this.duration||s.stormTimer>20||!Number.isInteger(s.rng)||s.rng>0xffffffff||typeof s.locked!=='boolean'||typeof s.paused!=='boolean'||!point(s.pending)||!point(s.lastStrike)||(s.pending&&(!Number.isFinite(s.pending.countdown)||s.pending.countdown<0||s.pending.countdown>1.2))||(s.lastStrike&&(!Number.isFinite(s.lastStrike.remaining)||s.lastStrike.remaining<0||s.lastStrike.remaining>.8||!Number.isInteger(s.lastStrike.id))))throw new Error('Invalid weather snapshot');
    const changed=this.state!==state;Object.assign(this,{state,weights:{...s.weights},from:{...s.from},transition:s.transition,elapsed:s.elapsed,autoTimer:s.autoTimer,lastWave:s.lastWave,locked:s.locked,paused:s.paused,rng:s.rng,stormTimer:s.stormTimer,pending:s.pending?{...s.pending}:null,lastStrike:s.lastStrike?{...s.lastStrike}:null,strikeId:s.strikeId});this.recompute();if(changed)this.publish('weather:change',{state,restored:true});if(this.lastStrike?.remaining>0)this.playThunder();
  }
  /** Release weather-owned objects/canvases and restore neutral audio routing. */
  dispose(){this.rain.dispose();this.snow.dispose();this.fog.dispose();this.renderer.dispose();this.actors.length=0;this.pending=null;this.lastStrike=null;audio.setWeatherMuffle?.(0);super.dispose();}
}
