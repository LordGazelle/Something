// Спільна конфігурація для сервера і клієнта.
// Весь баланс гри живе тут — це "data-driven" підхід: змінюєш цифри, не чіпаючи логіку.

export const TICK_RATE = 30; // симуляцій на секунду на сервері
export const INTERP_DELAY = 100; // мс, затримка інтерполяції на клієнті

export const ARENA = {
  startRadius: 470,
  minRadius: 110,
  shrinkDelay: 6, // сек до початку звуження
  shrinkTime: 75, // сек на повне звуження
};

export const PLAYER = {
  radius: 16,
  maxHp: 100,
  speed: 165,
  friction: 3.2, // загасання відкидання (на секунду)
  lavaDps: 13,
  knockScale: 65, // кожні N отриманої шкоди = +100% до відкидання
};

export const MAX_LEVEL = 3;
export const levelCost = (lvl) => (lvl === 1 ? 3 : 5); // ціна переходу з lvl на lvl+1
export const lvlDamage = (lvl) => 1 + 0.25 * (lvl - 1);
export const lvlKnock = (lvl) => 1 + 0.12 * (lvl - 1);
export const lvlCooldown = (lvl) => 1 - 0.12 * (lvl - 1);

// kind визначає, як сервер обробляє спел
export const SPELLS = {
  fireball: {
    name: 'Вогняна куля', kind: 'projectile', icon: '🔥', color: '#ff7a1a',
    cd: 1.5, speed: 540, radius: 9, life: 1.4, damage: 8, knock: 300,
    desc: 'Базовий снаряд. Завжди на Q.',
  },
  lightning: {
    name: 'Блискавка', kind: 'beam', icon: '⚡', color: '#9fd8ff',
    cd: 6, range: 300, damage: 6, knock: 430,
    desc: 'Миттєвий промінь на коротку дистанцію, сильне відкидання.',
  },
  homing: {
    name: 'Самонавідна ракета', kind: 'projectile', icon: '🎯', color: '#e05cff',
    cd: 8, speed: 300, radius: 10, life: 4, damage: 10, knock: 320, homing: 3.2,
    desc: 'Повільна, але сама шукає найближчого ворога.',
  },
  blink: {
    name: 'Телепорт', kind: 'blink', icon: '✨', color: '#c8f7ff',
    cd: 8, range: 280,
    desc: 'Миттєве переміщення до курсора. Рятує з лави.',
  },
  dash: {
    name: 'Ривок', kind: 'dash', icon: '💨', color: '#ffe08a',
    cd: 7, speed: 760, time: 0.24, damage: 7, knock: 470,
    desc: 'Різкий ривок, що таранить і відкидає ворогів.',
  },
  gravity: {
    name: 'Гравітаційна сфера', kind: 'projectile', icon: '🌀', color: '#7b6cff',
    cd: 12, speed: 230, radius: 12, life: 1.6, damage: 3, knock: 0,
    field: { radius: 170, time: 2.5, pull: 950 },
    desc: 'Створює поле, що затягує всіх у центр.',
  },
  shield: {
    name: 'Дзеркальний щит', kind: 'shield', icon: '🛡️', color: '#8fffd0',
    cd: 10, time: 1.2,
    desc: 'Відбиває снаряди назад у нападника.',
  },
  swap: {
    name: 'Обмін', kind: 'projectile', icon: '🔄', color: '#5cffb1',
    cd: 10, speed: 620, radius: 8, life: 1.1, damage: 4, knock: 0, swap: true,
    desc: 'Влучив — міняєшся місцями з ціллю. Класика Warlocks.',
  },
  meteor: {
    name: 'Метеор', kind: 'meteor', icon: '☄️', color: '#ff3b2f',
    cd: 11, range: 460, delay: 1.0, radius: 75, damage: 14, knock: 540,
    desc: 'Падає в точку через 1 с. Величезне відкидання.',
  },
  frost: {
    name: 'Крижана хвиля', kind: 'nova', icon: '❄️', color: '#7fd4ff',
    cd: 9, radius: 145, damage: 4, knock: 260, slow: 2,
    desc: 'Хвиля навколо тебе: відштовхує і сповільнює.',
  },
};

export const SPELL_POOL = Object.keys(SPELLS).filter((s) => s !== 'fireball');
export const LOADOUT_SIZE = 4; // + fireball
export const SLOT_KEYS = ['Q', 'W', 'E', 'R', 'F'];

export const STAT_UPGRADES = {
  vit: { name: 'Живучість', icon: '❤️', desc: '+12 макс. HP', cost: 4, max: 3 },
  boots: { name: 'Чоботи', icon: '👢', desc: '+8% швидкість', cost: 3, max: 3 },
  anchor: { name: 'Якір', icon: '⚓', desc: '-10% відкидання', cost: 4, max: 3 },
};

export const MODES = {
  ffa: { name: 'Кожен сам за себе' },
  teams: { name: 'Команди 2×2 / 3×3' },
};

export const MUTATORS = {
  none: { name: 'Без мутатора' },
  ice: { name: 'Крижана арена (ковзко)' },
  rapid: { name: 'Швидкі перезарядки (×0.5)' },
  chaos: { name: 'Хаос (подвійне відкидання)' },
};

export const COLORS = ['#ff5252', '#40c4ff', '#69f0ae', '#ffd740', '#e040fb', '#ff9100', '#18ffff', '#f5f5f5'];
export const TEAM_COLORS = ['#ff4d4d', '#4da6ff'];

export const PHASE_TIME = { shop: 15, countdown: 3, roundEnd: 3, gameOver: 8 };
