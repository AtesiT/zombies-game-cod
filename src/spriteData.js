// ---------------------------------------------------------------------------
// Pure data: pixel-art sprites as ASCII + palette keys.
// Imported by both the browser (src/art.js) and the offline preview tool
// (tools/preview.mjs) -- keep this file free of any DOM / canvas usage.
// ---------------------------------------------------------------------------

// Palette keys (resolved to real colours in src/art.js)
export const PAL = {
  // soldier
  h: '#2f3a2c', // helmet dark
  H: '#414f3c', // helmet
  J: '#556349', // helmet light
  S: '#c39a72', // skin
  s: '#9a7554', // skin shadow
  U: '#5a6142', // uniform
  u: '#43492f', // uniform dark
  I: '#6d7550', // uniform light
  b: '#2b2418', // belt / dark leather
  L: '#4d5138', // trousers
  K: '#5f6446', // trousers light
  o: '#241d13', // boots

  // metal & wood
  G: '#6f7079', // gun metal
  g: '#41424a', // gun metal dark
  M: '#9a9ba4', // gun metal light
  w: '#6a4a2a', // wood
  v: '#8a6338', // wood light
  n: '#3f2a17', // wood dark

  // zombie
  z: '#7f8d68', // skin
  Z: '#5f6b4c', // skin dark
  y: '#9aab7e', // skin light
  c: '#4b4a41', // cloth
  C: '#38372f', // cloth dark
  e: '#cbe07a', // eye glow
  m: '#3a1d20', // mouth
  T: '#d9d6c2', // teeth
  B: '#7c1f22', // blood
  2: '#4d1214', // blood dark
  k: '#191a1c', // near black
};

// --- soldier --------------------------------------------------------------
// 20 wide, upper block is 16 rows, leg block is 6 rows  => 22 tall.
// Sprite origin: bottom-centre is the entity's feet.
export const PLAYER_UPPER = [
  '....................',
  '.......hhhhhh.......',
  '......hhhhhhhh......',
  '.....hhHHHHHHhh.....',
  '.....hHHHHHHHHh.....',
  '.....hHSSSSSSHh.....',
  '.....hSSsSSsSSh.....',
  '.....hSSSSSSSSh.....',
  '......sSSSSSSs......',
  '.......SSSSSS.......',
  '....uuUUUUUUUUuu....',
  '...uUUUUUUUUUUUUu...',
  '...uUUIUUUUUUIUUu...',
  '...uUUUUUUUUUUUUu...',
  '....UUUUUUUUUUUU....',
  '....bbUUUUUUUUbb....',
];

export const PLAYER_LEGS = [
  [
    '.....LLL..LLL.......',
    '.....LLL..LLL.......',
    '.....LLL..LLL.......',
    '.....LLL..LLL.......',
    '....ooo....ooo......',
    '....................',
  ],
  [
    '....LLLL..LLL.......',
    '....LLLL..LLL.......',
    '....LLLL...LLL......',
    '....LLLL....LLL.....',
    '...oooo.....ooo.....',
    '....................',
  ],
  [
    '.....LLLLLLL........',
    '.....LLLLLLL........',
    '.....LLLLLLL........',
    '.....LLLLLLL........',
    '....ooooooooo.......',
    '....................',
  ],
  [
    '.......LLL..LLLL....',
    '.......LLL..LLLL....',
    '......LLL...LLLL....',
    '.....LLL....LLLL....',
    '.....ooo.....oooo...',
    '....................',
  ],
];

// --- zombie ---------------------------------------------------------------
export const ZOMBIE_UPPER = [
  '....................',
  '....................',
  '.......zzzz.........',
  '......zzzzzzz.......',
  '.....zyyyyyyyz......',
  '.....zyZZZZZyz......',
  '.....zeZZZZZez......',
  '.....zZBBBZZz.......',
  '.....zZmTTTmZz......',
  '......zZZmZZz.......',
  '.......zzzz.........',
  '....ccCCCCCCCCcc....',
  '...cCCCCCCCCCCCCczZ.',
  '...cCBCCCCCCBBCczZZz',
  '...cCCCBCCCCCcCczZz.',
  '....CCCCCCCCCC......',
];

// arms thrown up, used for the lunge / barricade-chewing pose
export const ZOMBIE_UPPER_ATTACK = [
  '....................',
  '....................',
  '.......zzzz.........',
  '......zzzzzzz.......',
  '.....zyyyyyyyz......',
  '.....zyZZZZZyz......',
  '.....zeZZZZZez......',
  '.....zZBBBZZz.......',
  '.....zZmTTTmZz......',
  '......zZZmZZz.......',
  '..zZ...zzzz...zZ....',
  '..czZ........Zzc....',
  '..cCCCCCCCCCCCCc.zZ.',
  '..cCBCCCCCCBBCczZZz.',
  '..cCCCBCCCCCcCczZz..',
  '...CCCCCCCCCCCC.....',
];

export const ZOMBIE_LEGS = [
  [
    '.....ccc..ccc.......',
    '.....ccc..ccc.......',
    '.....ccc..ccc.......',
    '.....ccc..ccc.......',
    '....kkk....kkk......',
    '....................',
  ],
  [
    '....cccc..ccc.......',
    '....cccc..ccc.......',
    '....cccc...ccc......',
    '....cccc....ccc.....',
    '...kkkk.....kkk.....',
    '....................',
  ],
  [
    '.....ccccccc........',
    '.....ccccccc........',
    '.....ccccccc........',
    '.....ccccccc........',
    '....kkkkkkkkk.......',
    '....................',
  ],
  [
    '.......ccc..cccc....',
    '.......ccc..cccc....',
    '......ccc...cccc....',
    '.....ccc....cccc....',
    '.....kkk.....kkkk...',
    '....................',
  ],
];

// --- weapons --------------------------------------------------------------
// drawn pointing east; `pivot` is where it attaches to the player's chest,
// `muzzle` is the tip of the barrel.
export const GUNS = {
  m1911: {
    w: 14, h: 9, pivot: [2, 4], muzzle: [13, 4],
    rows: [
      '..............',
      '..............',
      '..UU..........',
      '.UUUU.........',
      '.UUUUggggggGGg',
      '.UUUUSgggggGG.',
      '..UUUS........',
      '..UUU.........',
      '..............',
    ],
  },
  thompson: {
    w: 20, h: 9, pivot: [2, 4], muzzle: [18, 4],
    rows: [
      '....................',
      '....................',
      '..UU................',
      '.UUUU...............',
      '.UUUUSwwwwwGGGGGGGGg',
      '.UUUUUwwwwggGGGGGGG.',
      '.UUUUU....gggg......',
      '..UUU.....gg........',
      '....................',
    ],
  },
  trenchgun: {
    w: 22, h: 9, pivot: [2, 4], muzzle: [20, 4],
    rows: [
      '......................',
      '......................',
      '..UU..................',
      '.UUUU.................',
      '.UUUUSwwwwGGgggggGGGGg',
      '.UUUUUwwwwggGGGGGGGGG.',
      '.UUUUU.....wwwwwww....',
      '..UUU.................',
      '......................',
    ],
  },
  mp40: {
    w: 18, h: 9, pivot: [2, 4], muzzle: [16, 4],
    rows: [
      '..................',
      '..................',
      '..UU..............',
      '.UUUU.............',
      '.UUUUSwwgggGGGGGGg',
      '.UUUUUwwggGGGGGGG.',
      '.UUUUU...gg.......',
      '..UUU....gg.......',
      '..................',
    ],
  },
  kar98k: {
    w: 24, h: 9, pivot: [2, 4], muzzle: [22, 4],
    rows: [
      '........................',
      '........................',
      '..UU....................',
      '.UUUU...................',
      '.UUUUSwwwwwwggggGGGGGGGg',
      '.UUUUUwwwwwwgGGGGGGGGG..',
      '.UUUUU.......gggg.......',
      '..UUU...................',
      '........................',
    ],
  },
};

// --- small items ----------------------------------------------------------
export const GRENADE_SPRITE = {
  w: 6, h: 6,
  rows: [
    '......',
    '.GGG..',
    'GMMG..',
    'GMMG..',
    'GGGG..',
    '......',
  ],
};

// --- wall-buy plaques (drawn on the wall behind a buy spot) ---------------
// 24 x 24, one per weapon family; drawn flat against the wall face.
export const PLAQUE_ART = {
  pistol: [
    '........................',
    '........................',
    '..wwwwwwwwwwwwwwwwwwww..',
    '..wvvvvvvvvvvvvvvvvvvw..',
    '..wv................vw..',
    '..wv.....gggggg.....vw..',
    '..wv.....gMMMMg.....vw..',
    '..wv.....gggggg.....vw..',
    '..wv.......gg.......vw..',
    '..wv.......gg.......vw..',
    '..wv......ggg.......vw..',
    '..wv................vw..',
    '..wvvvvvvvvvvvvvvvvvvw..',
    '..wwwwwwwwwwwwwwwwwwww..',
    '........................',
  ],
  smg: [
    '........................',
    '........................',
    '..wwwwwwwwwwwwwwwwwwww..',
    '..wvvvvvvvvvvvvvvvvvvw..',
    '..wv................vw..',
    '..wv...gggggggggg...vw..',
    '..wv...gMMMMMMMMg...vw..',
    '..wv...gggggggggg...vw..',
    '..wv......gMMg......vw..',
    '..wv......gMMg......vw..',
    '..wv......gMMg......vw..',
    '..wv................vw..',
    '..wvvvvvvvvvvvvvvvvvvw..',
    '..wwwwwwwwwwwwwwwwwwww..',
    '........................',
  ],
  shotgun: [
    '........................',
    '........................',
    '..wwwwwwwwwwwwwwwwwwww..',
    '..wvvvvvvvvvvvvvvvvvvw..',
    '..wv................vw..',
    '..wv..gggggggggggg..vw..',
    '..wv..gMMMMMMMMMMg..vw..',
    '..wv..gggggggggggg..vw..',
    '..wv....wwwwwww.....vw..',
    '..wv....vvvvvvv.....vw..',
    '..wv................vw..',
    '..wv................vw..',
    '..wvvvvvvvvvvvvvvvvvvw..',
    '..wwwwwwwwwwwwwwwwwwww..',
    '........................',
  ],
  rifle: [
    '........................',
    '........................',
    '..wwwwwwwwwwwwwwwwwwww..',
    '..wvvvvvvvvvvvvvvvvvvw..',
    '..wv................vw..',
    '..wv.ggggggggggggggg.vw.',
    '..wv.gMMMMMMMMMMMMMg.vw.',
    '..wv.ggggggggggggggg.vw.',
    '..wv.....wwwwww......vw.',
    '..wv.....vvvvvv......vw.',
    '..wv.................vw.',
    '..wv.................vw.',
    '..wvvvvvvvvvvvvvvvvvvw..',
    '..wwwwwwwwwwwwwwwwwwww..',
    '........................',
  ],
};
