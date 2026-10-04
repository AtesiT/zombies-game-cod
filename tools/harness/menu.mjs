// O opens the settings panel and keeps it open -- one keypress used to both
// open and close it inside the same step.
import { nc, load } from './stub.mjs';
const M = await load();
const H = 1 / 60;
let fails = 0;
const ok = (c, l, x = '') => { console.log(`${c ? ' ok ' : 'FAIL'}  ${l}${x ? '  -- ' + x : ''}`); if (!c) fails++; };

const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
g.begin(); g.started = true;
g.player.hurt = () => false;
const tap = (code) => { g.input.pressed.add(code); g.update(H); g.input.endFrame(); };

tap('KeyO');
ok(g.settingsOpen === true, 'O opens the panel');
g.update(H);
ok(g.settingsOpen === true, 'and it stays open on later frames');
ok(g.paused === true, 'the game behind it is paused');

// navigation must work while it is open
const before = g.settingsIndex;
tap('ArrowDown');
ok(g.settingsIndex === (before + 1) % 13, 'ArrowDown moves the cursor', `${before} -> ${g.settingsIndex}`);
tap('ArrowUp');
ok(g.settingsIndex === before, 'ArrowUp moves it back');

// a second O closes it
tap('KeyO');
ok(g.settingsOpen === false, 'a second O closes it');
ok(g.paused === false, 'and the game resumes');

// escape closes too, and does it from the pause screen as well
tap('KeyO'); ok(g.settingsOpen, 'open again');
tap('Escape');
ok(g.settingsOpen === false, 'Escape closes it');

// the panel actually renders when open
const cx = nc(M.VW, M.VH).getContext('2d');
tap('KeyO');
g.draw(cx);
const d = cx.getImageData(0, 0, M.VW, M.VH).data;
let gold = 0;
for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] > 150 && d[i + 2] < 160) gold++;
ok(gold > 400, 'the panel is drawn', `${gold} gold px`);
tap('Escape');

console.log(fails === 0 ? '\nMENU PASS' : `\nMENU FAIL (${fails})`);
process.exit(fails ? 1 : 0);
