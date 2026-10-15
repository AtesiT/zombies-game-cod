/** Canonical weather IDs and labels shared by scheduling/debug/serialization. */
export const WEATHER_STATES = Object.freeze({
  clear: Object.freeze({ label: 'Clear' }),
  rain: Object.freeze({ label: 'Heavy Rain' }),
  fog: Object.freeze({ label: 'Dense Fog' }),
  storm: Object.freeze({ label: 'Thunderstorm' }),
  snow: Object.freeze({ label: 'Snow' }),
});
export const WEATHER_ORDER = Object.freeze(Object.keys(WEATHER_STATES));
/** Normalize friendly URL/console names; reject unknown states before mutation. */
export function weatherId(value) {
  const id = ({ 'heavy-rain': 'rain', 'dense-fog': 'fog', thunderstorm: 'storm' })[value] ?? value;
  if (!Object.hasOwn(WEATHER_STATES,id)) throw new Error(`Unknown weather: ${value}`);
  return id;
}
/** Fresh unit-weight state vector. */
export function weatherWeights(id='clear') { return Object.fromEntries(WEATHER_ORDER.map(key=>[key,key===id?1:0])); }
/** Validate map-local schedules and outdoor strike rectangles. */
export function validateWeather(config, floors=1) {
  if(config===undefined)return;
  if(!config||typeof config!=='object'||Array.isArray(config))throw new Error('Invalid weather configuration');
  if(config.initial!==undefined)weatherId(config.initial);
  for(const [key,min,max] of [['transitionSeconds',5,10],['intervalSeconds',10,3600],['waveEvery',1,100],['seed',0,0xffffffff]]){
    if(config[key]!==undefined&&(!Number.isFinite(config[key])||config[key]<min||config[key]>max))throw new Error(`Invalid weather ${key}`);
  }
  if(config.waveEvery!==undefined&&!Number.isInteger(config.waveEvery))throw new Error('Invalid weather waveEvery');
  if(config.openAreas!==undefined&&(!Array.isArray(config.openAreas)||config.openAreas.length>32))throw new Error('Invalid weather open areas');
  for(const a of config.openAreas??[])if(!a||!['x','y','width','height'].every(k=>Number.isFinite(a[k]))||a.x<24||a.y<24||a.width<96||a.height<96||a.x+a.width>1704||a.y+a.height>1176||!Number.isInteger(a.floor)||a.floor<0||a.floor>=floors)throw new Error('Invalid weather strike rectangle');
}
