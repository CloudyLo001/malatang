# Malatang — Guess the Bill

Fill a bowl from a Big Way–style self-serve wall, guess the cost, then weigh it.

```bash
npm install
npm run dev      # http://127.0.0.1:5188
npm run build
```

- Pricing and ingredient weights: `src/ingredients.ts` (`PRICE_PER_100G = 3.99`).
- Controls: click / hold a tray to grab · `I` inspect bowl · `Z` undo · `Enter` weigh · `M` mute.
- Models were generated with Mint (registry: `mint-assets.json`, sources in `public/assets/mint`).
  `node scripts/build-game-assets.mjs` rebuilds the runtime variants in `public/assets/game`
  (resized textures + low-poly meshes for the tray piles).
- The original build brief is in `PROMPT.md`.

## Pixel-art version

Open `/?style=pixel` or use the **Pixel version** button (top-left). Same game and models,
repainted by `src/pixel.ts`: low-resolution render, banded colours, ink outlines, flat pastel
cabinet materials and a chunky UI theme. `/?style=3d` forces the original look.

Built by Cloudy Lo ([@itscloudylo](https://instagram.com/itscloudylo)). 3D assets generated with [Mint](https://mint.gg).
