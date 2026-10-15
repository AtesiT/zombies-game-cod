import { ParticleEffect } from './ParticleEffect.js';
/** Rain renderer shared by rain/storm; no gameplay behavior depends on its visibility. */
export class RainEffect extends ParticleEffect {
  constructor(){super('rain');}
  /** Precipitation and blue veil in logical screen coordinates. */
  draw(ctx,intensity){super.draw(ctx,intensity);if(intensity<=0)return;ctx.save();ctx.globalAlpha=.06*intensity;ctx.fillStyle='#6a98bc';ctx.fillRect(0,0,800,500);ctx.restore();}
}
