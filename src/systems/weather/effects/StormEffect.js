/** Telegraph and strike visuals; one pending strike/one bounded recent flash. */
export class StormEffect {
  /** Draw dangerous positions even when cosmetic particles are disabled. */
  drawGround(ctx,pending,last,floor){ctx.save();if(pending?.floor===floor){ctx.strokeStyle='#ffdb83';ctx.lineWidth=3;ctx.beginPath();ctx.arc(pending.x,pending.y,pending.radius,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#ffe5a3';ctx.fillRect(pending.x-4,pending.y-4,8,8);}
    if(last?.floor===floor&&last.remaining>0){ctx.globalAlpha=Math.min(1,last.remaining);ctx.strokeStyle='#d9f0ff';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(last.x-10,last.y-100);ctx.lineTo(last.x+9,last.y-62);ctx.lineTo(last.x-7,last.y-39);ctx.lineTo(last.x,last.y);ctx.stroke();}ctx.restore();}
  /** Brief flash only when cosmetic weather is enabled. */
  draw(ctx,last,enabled){if(!enabled||!last||last.remaining<.62)return;ctx.save();ctx.globalAlpha=Math.max(0,(last.remaining-.62)/.18)*.45;ctx.fillStyle='#eef6ff';ctx.fillRect(0,0,800,500);ctx.restore();}
}
