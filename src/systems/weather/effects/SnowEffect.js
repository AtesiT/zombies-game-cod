import { ParticleEffect } from './ParticleEffect.js';
import { ObjectPool } from '../../../utils/ObjectPool.js';
/** Pooled snow specks and bounded world-space actor/vehicle tracks. */
export class SnowEffect extends ParticleEffect {
  constructor(){super('snow');this.prints=[];this.last=new WeakMap();this.printPool=new ObjectPool(()=>({}), (p,x,y,nx,ny,floor)=>Object.assign(p,{x,y,nx,ny,floor,life:8}),256);}
  /** Age tracks regardless of quality so invisible records cannot accumulate. */
  update(dt,intensity,cap){super.update(dt,intensity,cap);for(let i=this.prints.length-1;i>=0;i--)if((this.prints[i].life-=dt)<=0)this.printPool.release(this.prints.splice(i,1)[0]);}
  /** Sample moved actors after simulation; weak ownership avoids retaining removed zombies. */
  track(entities,intensity,enabled){if(intensity<.1||!enabled)return;for(const e of entities){if(e.dead||e.remove)continue;const p=e.pos;let last=this.last.get(e);if(!last){last={x:p.x,y:p.y,floor:e.floor??0};this.last.set(e,last);continue;}const dx=p.x-last.x,dy=p.y-last.y,d=Math.hypot(dx,dy);if(d<18)continue;if(this.prints.length>=256)this.printPool.release(this.prints.shift());if(d<100&&last.floor===(e.floor??0))this.prints.push(this.printPool.acquire(p.x,p.y,-dy/d,dx/d,e.floor??0));last.x=p.x;last.y=p.y;last.floor=e.floor??0;}}
  /** Tracks drawn on the world plane before actors; visibility veil still covers them. */
  drawGround(ctx,floor,intensity){
    if(intensity<.01)return;
    ctx.save();ctx.fillStyle='#596573';
    // Four age batches avoid hundreds of individual Canvas paint submissions.
    for(let band=0;band<4;band++){
      ctx.globalAlpha=.5*((band+.5)/4)*intensity;ctx.beginPath();
      for(const p of this.prints){if(p.floor!==floor||Math.min(3,Math.floor(p.life/2))!==band)continue;ctx.rect(p.x+p.nx*3,p.y+p.ny*3,2,3);ctx.rect(p.x-p.nx*3,p.y-p.ny*3,2,3);}
      ctx.fill();
    }
    ctx.restore();
  }
  /** White tint plus snow particles, outside the HUD. */
  draw(ctx,intensity){super.draw(ctx,intensity);if(intensity<=0)return;ctx.save();ctx.globalAlpha=.17*intensity;ctx.fillStyle='#dce9f4';ctx.fillRect(0,0,800,500);ctx.restore();}
  /** Release particles, tracks and weak owner state. */
  dispose(){super.dispose();this.prints.length=0;this.printPool.clear();this.last=new WeakMap();}
}
