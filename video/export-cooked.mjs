// Exports the cooked pot (Szechuan Mala, same picks as the gameplay run) to video/out/cooked.glb
// for the Blender hero shot. Needs the dev server on :5188; run from the project root.
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:5188/?style=3d');
await page.waitForFunction(() => window.__malatang?.serve, null, { timeout: 120000 });
const b64 = await page.evaluate(async () => {
  const m = window.__malatang;
  const picks = [
    ['shrimp', 16, 3], ['fish-ball', 18, 2], ['bok-choy', 45, 1], ['beef-slice', 14, 2], ['instant-noodle-block', 70, 1],
    ['enoki-mushroom', 35, 1], ['broccoli', 22, 2], ['fried-tofu-puff', 12, 2], ['lotus-root-slice', 18, 2],
    ['fish-tofu-roll', 28, 2], ['striped-fish-dumpling', 20, 2], ['shiitake-mushroom', 18, 1], ['firm-tofu', 45, 1],
    ['mini-sausage', 14, 2], ['napa-cabbage', 24, 1], ['crab-stick', 16, 1],
  ];
  for (const [key, grams, n] of picks) {
    for (let i = 0; i < n; i += 1) {
      const p = m.bowl.add({ key, name: key, grams, size: 0.08, perGrab: 1, trayCount: 1 }, m.assets.food.get(key), grams);
      if (p) {
        m.bowl.group.add(p.object);
        m.bowl.attach(p);
        p.object.position.copy(p.rest);
      }
    }
  }
  m.serve('Szechuan Mala');
  return m.exportCooked();
});
fs.writeFileSync('video/out/cooked.glb', Buffer.from(b64, 'base64'));
console.log('wrote video/out/cooked.glb', Buffer.from(b64, 'base64').length);
await browser.close();
