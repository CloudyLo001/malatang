// Frame-exact gameplay capture for the trailer.
// Usage (dev server on :5188, run from the project root):
//   node video/capture.mjs wide|tall [shot ...]
// The page runs on a virtual clock: every saved frame advances the game by exactly 1/30 s,
// so the footage is smooth no matter how slowly the browser renders.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const aspect = process.argv[2] ?? 'wide';
const only = process.argv.slice(3);
const size = aspect === 'tall' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
const DT = 1000 / 30;
const OUT = path.join('video', 'frames', `game-${aspect}`);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--mute-audio'],
});
const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1, reducedMotion: 'reduce' });
page.on('pageerror', (error) => console.error('page error:', error.message));

await page.addInitScript(() => {
  let now = 0;
  const queue = [];
  performance.now = () => now;
  window.requestAnimationFrame = (cb) => {
    queue.push(cb);
    return queue.length;
  };
  window.cancelAnimationFrame = () => {};
  window.__step = (ms) => {
    now += ms;
    queue.splice(0).forEach((cb) => cb(now));
  };
  try {
    localStorage.setItem('malatang-style', '3d');
    localStorage.removeItem('malatang-best');
  } catch {}
  // Screen-space helpers for aiming the mouse.
  const toScreen = (v) => {
    const p = v.clone().project(window.__malatang.camera);
    return [(p.x * 0.5 + 0.5) * innerWidth, (-p.y * 0.5 + 0.5) * innerHeight];
  };
  window.__trayXY = (key) => {
    const hit = window.__malatang.world.hits.find((h) => h.userData.tray.item.key === key);
    return toScreen(hit.userData.tray.centre);
  };
  window.__trayCentre = (key) => {
    const c = window.__malatang.world.hits.find((h) => h.userData.tray.item.key === key).userData.tray.centre;
    return [c.x, c.y, c.z];
  };
  window.__pieceXY = (i) => {
    const pieces = window.__malatang.bowl.pieces;
    const piece = pieces[Math.min(i, pieces.length - 1)];
    return toScreen(piece.object.getWorldPosition(piece.object.position.clone()));
  };
  window.__setCam = (pos, look) => {
    window.__malatang.camPos.set(...pos);
    window.__malatang.camLook.set(...look);
  };
  window.__getCam = () => [window.__malatang.camPos.toArray(), window.__malatang.camLook.toArray()];
});

/* ---------- mouse with eased glides ---------- */
const mouse = {
  x: size.width / 2,
  y: size.height / 2,
  path: [],
  isDown: false,
  go(x, y, frames) {
    const x0 = this.path.length ? this.path[this.path.length - 1][0] : this.x;
    const y0 = this.path.length ? this.path[this.path.length - 1][1] : this.y;
    for (let i = 1; i <= frames; i += 1) {
      const k = i / frames;
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      this.path.push([x0 + (x - x0) * e, y0 + (y - y0) * e]);
    }
  },
  async tick() {
    const p = this.path.shift();
    if (p) {
      [this.x, this.y] = p;
      await page.mouse.move(this.x, this.y);
    }
  },
  async click() {
    await page.mouse.move(this.x, this.y);
    await page.mouse.down();
    await page.mouse.up();
  },
};

const step = () => page.evaluate((dt) => window.__step(dt), DT);
const ev = (fn, ...args) => page.evaluate(fn, ...args);

async function record(name, frames, script) {
  const dir = path.join(OUT, name);
  const save = only.length === 0 || only.includes(name);
  if (save) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }
  const t0 = Date.now();
  for (let i = 0; i < frames; i += 1) {
    await script?.(i);
    await mouse.tick();
    await step();
    if (save) await page.screenshot({ path: path.join(dir, `${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 92 });
  }
  console.log(`${aspect} ${name}: ${frames} frames${save ? '' : ' (skipped)'} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (process.env.STOP_AFTER === name) {
    await browser.close();
    process.exit(0);
  }
}

async function idle(frames, script) {
  for (let i = 0; i < frames; i += 1) {
    await script?.(i);
    await mouse.tick();
    await step();
  }
}

/** Glide to a tray, click it, and let the grab play out. */
function grabPlan(keys, every, glide = 9) {
  return async (i) => {
    const slot = Math.floor(i / every);
    const t = i % every;
    if (slot >= keys.length) return;
    if (t === 0) {
      const [x, y] = await ev((k) => window.__trayXY(k), keys[slot]);
      mouse.go(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 16, glide);
    }
    if (t === glide + 1) await mouse.click();
  };
}

/* ---------- load ---------- */
await page.goto('http://localhost:5188/?style=3d');
for (let i = 0; i < 600; i += 1) {
  const ready = await page.evaluate(() => window.__malatang?.state().mode === 'pick').catch(() => false);
  if (ready) break;
  await page.waitForTimeout(250);
  await step().catch(() => {});
}
await idle(20);
await page.mouse.move(mouse.x, mouse.y);

/* ---------- shots ---------- */

// Wide: browse the wall, labels follow the tongs.
await record('wall', 180, async (i) => {
  const plan = { 0: 'bok-choy', 40: 'shrimp', 80: 'pork-belly-slice', 115: 'fish-ball', 150: 'instant-noodle-block' };
  if (plan[i]) {
    const [x, y] = await ev((k) => window.__trayXY(k), plan[i]);
    mouse.go(x, y, 28);
  }
});

// A grabbing spree, one ingredient after another.
await record(
  'spree',
  240,
  grabPlan(['shrimp', 'fish-ball', 'bok-choy', 'beef-slice', 'instant-noodle-block', 'enoki-mushroom', 'broccoli', 'fried-tofu-puff', 'lotus-root-slice'], 26),
);

// Close-up on the trays while the tongs work.
const [wallPos, wallLook] = await ev(() => window.__getCam());
const centre = await ev(() => window.__trayCentre('striped-fish-dumpling'));
const closeA = [[centre[0] + 0.1, centre[1] + 0.2, centre[2] + 0.36], [centre[0] - 0.02, centre[1] - 0.02, centre[2]]];
const closeB = [[centre[0] - 0.08, centre[1] + 0.17, centre[2] + 0.31], [centre[0] - 0.04, centre[1] - 0.02, centre[2]]];
const lerp3 = (a, b, k) => a.map((v, j) => v + (b[j] - v) * k);
const closeGrab = grabPlan(['fish-tofu-roll', 'striped-fish-dumpling', 'shrimp', 'fish-tofu-roll', 'striped-fish-dumpling', 'shrimp'], 30, 10);
await record('close', 180, async (i) => {
  const k = i / 179;
  await ev(([p, l]) => window.__setCam(p, l), [lerp3(closeA[0], closeB[0], k), lerp3(closeA[1], closeB[1], k)]);
  await closeGrab(i);
});
await ev(([p, l]) => window.__setCam(p, l), [wallPos, wallLook]);

// Off camera: fill the bowl up some more.
await idle(200, grabPlan(['shiitake-mushroom', 'firm-tofu', 'mini-sausage', 'napa-cabbage', 'beef-slice', 'snow-peas', 'crab-stick'], 27));
await idle(30);

// Inspect the bowl, hover a few pieces, put one back.
await record('inspect', 180, async (i) => {
  if (i === 3) await page.keyboard.press('i');
  const plan = { 30: 2, 62: 7, 94: 12, 126: 5 };
  if (plan[i] !== undefined) {
    const [x, y] = await ev((n) => window.__pieceXY(n), plan[i]);
    mouse.go(x, y, 22);
  }
  if (i === 152) await mouse.click();
});
await page.keyboard.press('Escape');
await idle(30);

// Guess the bill and pick a soup.
await record('guess', 180, async (i) => {
  if (i === 6) await page.click('#btn-weigh');
  const typed = { 34: '2', 44: '4', 54: '.', 62: '5', 70: '0' };
  if (typed[i]) await page.keyboard.type(typed[i]);
  if (i === 105) await page.selectOption('#soup', 'Szechuan Mala');
  if (i === 168) await page.click('#guess-form button[type=submit]');
});

// Weigh: scale, LCD count-up, receipt.
await record('weigh', 210);

// Cook it: the pot comes out steaming.
await record('cook', 210, async (i) => {
  if (i === 24) await page.click('#btn-cook');
});

if (aspect === 'wide') {
  const b64 = await ev(() => window.__malatang.exportCooked());
  fs.mkdirSync(path.join('video', 'out'), { recursive: true });
  fs.writeFileSync(path.join('video', 'out', 'cooked.glb'), Buffer.from(b64, 'base64'));
  console.log('exported cooked.glb');
}

// Pixel version: flip the style, then start a new bowl in pixel art.
await record('pixel', 300, async (i) => {
  if (i === 30) await page.click('#btn-style');
  if (i === 120) await page.click('#btn-again-2');
  if (i >= 170) await grabPlan(['shrimp', 'bok-choy', 'fish-ball', 'beef-slice'], 30)(i - 170);
});

await browser.close();
