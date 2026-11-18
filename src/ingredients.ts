/** Big Way style flat rate: every ingredient is the same price by weight. */
export const PRICE_PER_100G = 3.99;
export const TAX_RATE = 0.13; // Ontario HST
export const TAX_LABEL = 'HST 13%';

export interface Ingredient {
  /** Registry key under public/assets/mint/<key>/ */
  key: string;
  name: string;
  /** Average grams for one piece. */
  grams: number;
  /** Longest dimension of one piece, metres. */
  size: number;
  /** Pieces the tongs take per grab. */
  perGrab: number;
  /** Pieces shown in a full tray. */
  trayCount: number;
  /** Stand the piece upright instead of laying it on its flattest side. */
  upright?: boolean;
}

// Rows follow the display wall, back (top tier) to front, left to right.
export const ROWS: Ingredient[][] = [
  [
    { key: 'bok-choy', name: 'Bok choy', grams: 45, size: 0.125, perGrab: 1, trayCount: 14 },
    { key: 'napa-cabbage', name: 'Napa cabbage', grams: 24, size: 0.11, perGrab: 1, trayCount: 16 },
    { key: 'spinach', name: 'Spinach', grams: 28, size: 0.14, perGrab: 1, trayCount: 12 },
    { key: 'bean-sprouts', name: 'Bean sprouts', grams: 30, size: 0.085, perGrab: 1, trayCount: 14 },
    { key: 'broccoli', name: 'Broccoli', grams: 22, size: 0.065, perGrab: 1, trayCount: 22 },
    { key: 'enoki-mushroom', name: 'Enoki mushroom', grams: 35, size: 0.115, perGrab: 1, trayCount: 14 },
    { key: 'shiitake-mushroom', name: 'Shiitake', grams: 18, size: 0.055, perGrab: 1, trayCount: 24 },
  ],
  [
    { key: 'shimeji-mushroom', name: 'Shimeji mushroom', grams: 30, size: 0.08, perGrab: 1, trayCount: 16 },
    { key: 'shrimp', name: 'Shrimp', grams: 16, size: 0.085, perGrab: 1, trayCount: 20 },
    { key: 'fish-tofu-roll', name: 'Fish roll', grams: 28, size: 0.065, perGrab: 1, trayCount: 18 },
    { key: 'striped-fish-dumpling', name: 'Lobster ball', grams: 20, size: 0.045, perGrab: 1, trayCount: 24, upright: true },
    { key: 'tofu-skin', name: 'Tofu skin', grams: 15, size: 0.085, perGrab: 1, trayCount: 20 },
    { key: 'lotus-root-slice', name: 'Lotus root', grams: 18, size: 0.062, perGrab: 1, trayCount: 22 },
    { key: 'mini-sausage', name: 'Mini sausage', grams: 14, size: 0.06, perGrab: 1, trayCount: 26 },
  ],
  [
    { key: 'fried-tofu-puff', name: 'Tofu puff', grams: 12, size: 0.045, perGrab: 1, trayCount: 26 },
    { key: 'firm-tofu', name: 'Tofu', grams: 45, size: 0.06, perGrab: 1, trayCount: 20 },
    { key: 'pork-blood-curd', name: 'Pork blood', grams: 40, size: 0.042, perGrab: 1, trayCount: 24 },
    { key: 'pork-belly-slice', name: 'Pork belly', grams: 22, size: 0.085, perGrab: 1, trayCount: 18 },
    { key: 'fish-ball', name: 'Fish ball', grams: 18, size: 0.036, perGrab: 1, trayCount: 30 },
    { key: 'crab-stick', name: 'Crab stick', grams: 16, size: 0.085, perGrab: 1, trayCount: 20 },
    { key: 'snow-peas', name: 'Snow peas', grams: 4, size: 0.08, perGrab: 3, trayCount: 30 },
  ],
  [
    { key: 'beef-slice', name: 'Beef', grams: 14, size: 0.08, perGrab: 1, trayCount: 22 },
    { key: 'lamb-roll-slice', name: 'Lamb', grams: 14, size: 0.08, perGrab: 1, trayCount: 22 },
    { key: 'fatty-beef-slice', name: 'Fatty beef', grams: 15, size: 0.085, perGrab: 1, trayCount: 22 },
    { key: 'chicken-slice', name: 'Chicken', grams: 25, size: 0.07, perGrab: 1, trayCount: 20 },
    { key: 'glass-noodles', name: 'Glass noodles', grams: 80, size: 0.085, perGrab: 1, trayCount: 12 },
    { key: 'instant-noodle-block', name: 'Instant noodle', grams: 70, size: 0.09, perGrab: 1, trayCount: 10 },
    { key: 'udon-noodles', name: 'Udon', grams: 200, size: 0.095, perGrab: 1, trayCount: 10 },
  ],
];

export const ALL: Ingredient[] = ROWS.flat();

export const EQUIPMENT = {
  bowl: 'hot-pot-bowl',
  tongs: 'serving-tongs',
  scale: 'digital-scale',
} as const;

export const SOUPS = [
  'House Special Spicy',
  'Bone Broth',
  'Tomato',
  'Tom Yum',
  'Szechuan Mala',
  'Curry',
  'Herbal Mushroom',
  'Dry Mix Mala',
];

export function priceFor(grams: number): number {
  return Math.round((grams / 100) * PRICE_PER_100G * 100) / 100;
}

/** Runtime variants built by scripts/build-game-assets.mjs from the Mint GLBs. */
export function modelUrl(key: string, variant: 'model' | 'lod' = 'model'): string {
  return `${import.meta.env.BASE_URL}assets/game/${key}/${variant}.glb`;
}

export function thumbUrl(key: string): string {
  return `${import.meta.env.BASE_URL}assets/mint/${key}/preview_image.webp`;
}
