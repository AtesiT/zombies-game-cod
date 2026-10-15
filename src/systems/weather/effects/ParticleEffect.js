import { ObjectPool } from '../../../utils/ObjectPool.js';
/** Screen-space pooled precipitation; visual RNG never consumes gameplay RNG. */
export class ParticleEffect {
  constructor(kind) {
    this.kind=kind;this.items=[];this.seed=kind==='rain'?4242:9595;
    this.pool=new ObjectPool(()=>({}),p=>Object.assign(p,{x:this.random()*800,y:this.random()*500,speed:this.kind==='rain'?420+this.random()*180:22+this.random()*25,size:1+this.random()*2}),160);
  }
  /** Cheap deterministic local visual random stream. */
  random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
  /** Resize active population to the quality/intensity budget; reuse all records. */
  update(dt,intensity,cap){
    const count=Math.round(Math.min(1,intensity)*cap);
    while(this.items.length>count)this.pool.release(this.items.pop());
    while(this.items.length<count)this.items.push(this.pool.acquire());
    for(const p of this.items){p.y+=p.speed*dt;p.x+=(this.kind==='rain'?-75:Math.sin(p.y*.015)*12)*dt;if(p.y>510){p.y=-10;p.x=this.random()*800;}if(p.x<-10)p.x=810;}
  }
  /** Draw batched streaks or cheap snow specks. */
  draw(ctx,intensity){if(!this.items.length)return;ctx.save();ctx.globalAlpha=.6*intensity;
    if(this.kind==='rain'){ctx.strokeStyle='#9ac6e0';ctx.lineWidth=1;ctx.beginPath();for(const p of this.items){ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-3,p.y+12+p.size*3);}ctx.stroke();}
    else{ctx.fillStyle='#edf5ff';for(const p of this.items)ctx.fillRect(p.x,p.y,p.size,p.size);}
    ctx.restore();
  }
  /** Drop active/free records on session disposal. */
  dispose(){this.items.length=0;this.pool.clear();}
}
