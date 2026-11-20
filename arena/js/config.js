// Параметри машин, зброї та матчу.

export const CARS = {
  grim: {
    name: 'ГРІМ', desc: 'Маслкар. Чесний баланс швидкості й броні.',
    color: 0xd8352a, trim: 0x1c1c22, mass: 1.0, hp: 100,
    accel: 27, maxSpeed: 44, grip: 7.5, steer: 2.7,
    size: [2.1, 0.8, 4.5], cabin: [1.75, 0.65, 1.9], cabinZ: -0.35, wheelR: 0.48,
    special: 'salvo', specialName: 'ЗАЛП', specialCd: 16,
    stats: [3, 3, 3],
  },
  dozer: {
    name: 'БУЛЬДОЗЕР', desc: 'Тягач із відвалом. Таран рве все на шматки.',
    color: 0xe7a51c, trim: 0x2a2a2a, mass: 1.8, hp: 150,
    accel: 20, maxSpeed: 35, grip: 9, steer: 2.1,
    size: [2.5, 1.1, 5.2], cabin: [2.2, 1.0, 1.7], cabinZ: 1.0, wheelR: 0.62,
    special: 'ram', specialName: 'ТАРАН', specialCd: 12,
    stats: [1, 5, 2],
  },
  wasp: {
    name: 'ОСА', desc: 'Багі. Найшвидша й найспритніша, але крихка.',
    color: 0x35d46e, trim: 0x111111, mass: 0.7, hp: 75,
    accel: 34, maxSpeed: 52, grip: 6.2, steer: 3.2,
    size: [1.9, 0.55, 3.9], cabin: [1.2, 0.55, 1.3], cabinZ: -0.5, wheelR: 0.55,
    special: 'zap', specialName: 'БЛИСКАВКА', specialCd: 10,
    stats: [5, 1, 5],
  },
  ghost: {
    name: 'ПРИВИД', desc: 'Катафалк. Засіює дорогу мінами.',
    color: 0x7b4fe0, trim: 0x16121f, mass: 1.25, hp: 115,
    accel: 24, maxSpeed: 41, grip: 7, steer: 2.45,
    size: [2.1, 0.9, 5.0], cabin: [1.85, 0.85, 2.8], cabinZ: -0.55, wheelR: 0.5,
    special: 'minefield', specialName: 'МІННЕ ПОЛЕ', specialCd: 15,
    stats: [3, 4, 2],
  },
};
export const CAR_IDS = Object.keys(CARS);

// Зброя з підбирань. Кулемет — нескінченний.
export const WEAPONS = {
  homing: { name: 'САМОНАВІДНА', icon: '◎', dmg: 18, speed: 52, turn: 3.0, life: 4.5, radius: 4.5, color: 0x66d9ff, ammo: 3 },
  fire:   { name: 'ВОГНЯНА',     icon: '▲', dmg: 13, speed: 90, life: 2.4, radius: 4, burn: 3, color: 0xff6a1a, ammo: 4 },
  power:  { name: 'ПОТУЖНА',     icon: '◆', dmg: 38, speed: 68, life: 3, radius: 8, color: 0xffe14a, ammo: 1 },
  mine:   { name: 'МІНА',        icon: '✱', dmg: 32, radius: 7, life: 40, color: 0xff2255, ammo: 3 },
  shock:  { name: 'УДАРНА ХВИЛЯ', icon: '◉', dmg: 12, radius: 17, color: 0xb388ff, ammo: 2 },
};
export const WEAPON_IDS = Object.keys(WEAPONS);

export const MG = { dmg: 1.7, rate: 0.085, speed: 170, life: 0.65 };

export const MATCH = { killLimit: 15, time: 300, respawn: 3.5, maxPlayers: 8 };

export const BOT_NAMES = ['Іржа', 'Шкварка', 'Гайка', 'Бампер', 'Кардан', 'Глушник', 'Карбюратор', 'Домкрат', 'Поршень'];
export const PALETTE = [0xd8352a, 0x2f8cff, 0xe7a51c, 0x35d46e, 0xff4fb3, 0x7b4fe0, 0x29d3d3, 0xf2f2f2];
