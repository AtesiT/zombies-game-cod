/** Cached edge softness plus an opaque outside-radius veil; always gameplay-visible. */
export class FogEffect {
  constructor(){this.mask=null;}
  /** Lazily bake a single bounded mask, never a per-frame gradient. */
  getMask(){if(this.mask)return this.mask;const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d');const g=ctx.createRadialGradient(64,64,44,64,64,64);g.addColorStop(0,'rgba(155,168,178,0)');g.addColorStop(1,'rgba(155,168,178,1)');ctx.fillStyle=g;ctx.fillRect(0,0,128,128);return this.mask=c;}
  /** Hide beyond the same radius used by actor culling and fog spawning. */
  draw(ctx,x,y,radius,intensity){if(intensity<.001)return;ctx.save();ctx.globalAlpha=intensity;ctx.fillStyle='#9ba8b2';ctx.beginPath();ctx.rect(0,0,800,500);ctx.arc(x,y,radius,0,Math.PI*2,true);ctx.fill('evenodd');ctx.drawImage(this.getMask(),x-radius,y-radius,radius*2,radius*2);ctx.restore();}
  /** Release the offscreen canvas. */
  dispose(){this.mask=null;}
}
