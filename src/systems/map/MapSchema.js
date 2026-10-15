import { validateWeather } from '../weather/WeatherState.js';
import { validateEnvironment } from '../environment/EnvironmentSchema.js';
import { WEAPONS } from '../../weapons.js';
const CHARS = /^[ .#crTFV@DW]+$/;
/** Validate the versioned registry before any game session is changed. */
export function validateRegistry(data) {
  if (data?.version !== 1 || !Array.isArray(data.maps) || !data.maps.length)
    throw new Error('Invalid map registry');
  const ids = new Set();
  for (const m of data.maps) {
    for (const key of ['id', 'name', 'scene', 'music', 'background', 'thumbnail', 'description']) {
      if (typeof m[key] !== 'string' || !m[key].trim()) throw new Error(`Missing map ${key}`);
    }
    if (ids.has(m.id)) throw new Error(`Duplicate map: ${m.id}`);
    ids.add(m.id);
    if (!Array.isArray(m.mechanics)) throw new Error('Missing mechanics descriptors');
    if (m.scene !== 'tile-grid') throw new Error(`Unsupported scene: ${m.scene}`);
    const l = m.level;
    if (
      !l ||
      l.rows?.length !== 50 ||
      l.rows.some((r) => typeof r !== 'string' || r.length !== 72 || !CHARS.test(r))
    )
      throw new Error(`Invalid 72x50 layout: ${m.id}`);
    validateEnvironment(l);
    validateWeather(l.weather);
    const point = (p) =>
      p &&
      Number.isInteger(p.x) &&
      Number.isInteger(p.y) &&
      p.x > 0 &&
      p.y > 0 &&
      p.x < 71 &&
      p.y < 49 &&
      '. @r'.includes(l.rows[p.y][p.x]);
    const tile = (p) =>
      p &&
      Number.isInteger(p.x) &&
      Number.isInteger(p.y) &&
      p.x > 0 &&
      p.y > 0 &&
      p.x < 71 &&
      p.y < 49;
    for (const key of [
      'powerSwitches',
      'upgrades',
      'boxSpots',
      'wallBuys',
      'doors',
      'barricades',
      'stations',
      'landmarks',
    ]) {
      if (l[key] !== undefined && !Array.isArray(l[key])) throw new Error(`Invalid ${key}`);
    }
    for (const key of ['powerSwitches', 'upgrades', 'boxSpots', 'wallBuys'])
      for (const p of l[key] ?? []) if (!point(p)) throw new Error(`Invalid ${key} tile`);
    for (const p of l.wallBuys ?? [])
      if (!WEAPONS[p.weapon] || !tile({ x: p.wx, y: p.wy })) throw new Error('Invalid wall weapon');
    for (const p of l.doors ?? [])
      if (!tile(p) || l.rows[p.y][p.x] !== 'D' || !Number.isFinite(p.price) || p.price < 0)
        throw new Error('Invalid door');
    for (const p of l.barricades ?? [])
      if (!tile(p) || l.rows[p.y][p.x] !== 'W') throw new Error('Invalid barricade');
    for (let y = 0; y < 50; y++)
      for (let x = 0; x < 72; x++) {
        if (l.rows[y][x] === 'D' && !l.doors?.some((p) => p.x === x && p.y === y))
          throw new Error('Door needs object data');
        if (l.rows[y][x] === 'W' && !l.barricades?.some((p) => p.x === x && p.y === y))
          throw new Error('Window needs object data');
      }
    const finitePoint = (p) =>
      p &&
      Number.isFinite(p.x) &&
      Number.isFinite(p.y) &&
      p.x > 0 &&
      p.y > 0 &&
      p.x < 1728 &&
      p.y < 1200;
    for (const s of l.stations ?? [])
      if (
        !finitePoint(s) ||
        !['repair', 'refuel'].includes(s.type) ||
        !(Number.isFinite(s.radius) && s.radius > 0 && s.radius < 250) ||
        !(s.price >= 0 && Number.isFinite(s.price))
      )
        throw new Error('Invalid vehicle station');
    for (const p of l.landmarks ?? [])
      if (!finitePoint(p) || typeof p.name !== 'string') throw new Error('Invalid landmark');
    if (l.vehicle) {
      const v = l.vehicle;
      if (
        v.type !== 'armored-bus' ||
        !finitePoint(v) ||
        !Number.isFinite(v.angle) ||
        !['hp', 'fuel', 'length', 'width', 'acceleration', 'maxSpeed'].every(
          (k) => Number.isFinite(v[k]) && v[k] > 0,
        ) ||
        v.length > 160 ||
        v.width > 80 ||
        v.maxSpeed > 400
      )
        throw new Error('Invalid vehicle');
      // Sampling the full footprint uses the same spacing as vehicle static collision.
      for (let x = -v.length / 2; x <= v.length / 2; x += v.length / 12)
        for (let y = -v.width / 2; y <= v.width / 2; y += v.width / 6) {
          const wx = v.x + x * Math.cos(v.angle) - y * Math.sin(v.angle),
            wy = v.y + x * Math.sin(v.angle) + y * Math.cos(v.angle);
          if (!'. @r'.includes(l.rows[Math.floor(wy / 24)]?.[Math.floor(wx / 24)] ?? '#'))
            throw new Error('Vehicle starts inside obstacle');
        }
    }
    if (!point(l.start) || !Array.isArray(l.spawns) || !l.spawns.length || !l.spawns.every(point))
      throw new Error(`Invalid start/spawns: ${m.id}`);
  }
  return data;
}
