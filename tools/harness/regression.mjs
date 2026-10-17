// Historical suites sometimes print FAIL but exit 0. Treat both as failures.
import { spawnSync } from 'node:child_process';
const suites = `ach boot box buried coopfix craft craftecon craftnet creatures debugmenu dlss egg fence frontmenu guestlink guestwalk hauntnet haunts heli joinwatch late lightfloors menu music net netlive openings overlay packedfx perfgov poweranim props quality range settingsmouse specials stairs step60 touch touchctx traps twoslots wallbuys wave3 weapons webaudio xhair zoo`.split(' ');
let failures = 0;
for (const name of suites) {
  const t = Date.now();
  const r = spawnSync(process.execPath, [`${name}.mjs`], { cwd: new URL('.', import.meta.url), encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
  const output = (r.stdout ?? '') + (r.stderr ?? '');
  const bad = r.error || r.status !== 0 || /\b(?:FAIL|FAILURES|THREW)\b|✗|❌/.test(output);
  console.log(`${bad ? 'FAIL' : 'PASS'} ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  if (bad) { failures++; console.log(r.error?.message ?? '', output); }
}
console.log(`${suites.length - failures}/${suites.length} suites passed`);
process.exitCode = failures ? 1 : 0;
