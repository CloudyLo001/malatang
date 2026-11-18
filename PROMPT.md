# Build Prompt — Malatang "Guess the Bill" (Big Way style)

Use mint-threejs-skills to build a browser game in **three.js + Vite + TypeScript**,
with every food item and the bowl/tongs/scale generated as 3D models through the
**Mint MCP**.

## Game idea

You are at a Big Way–style self-serve malatang wall. Grab ingredients with tongs,
pile them into your bowl, then **guess what the bill will be before the bowl is
weighed**. The scale reveals the weight and the real cost; you are scored on how
close your guess was.

- **Core verb:** pick ingredients with tongs → drop in the bowl.
- **Objective:** guess the total cost as accurately as possible.
- **Pressure:** the weight is hidden until the weigh-in; pieces vary in weight.
- **Reward:** accuracy rating + best-streak, receipt reveal.
- **Retry:** "New bowl" resets everything.

## Research facts to model (Big Way Hot Pot)

- Format: grab a metal bowl and a pair of tongs, walk a refrigerated wall of open
  stainless trays, fill the bowl, weigh at the cashier, pick a soup base, get a
  number; kitchen cooks it.
- Bowl: large gold-toned metal bowl (reviews describe "sturdy, stylish gold
  coloured metal bowls").
- Price: by weight, flat rate for everything. Canadian locations are
  **$3.99 / 100 g** (Toronto Bloor listed at $3.89; older Burnaby $3.68; a US
  store $3.69). Use **$3.99 / 100 g**, soup base free, as a single config constant.
- Show HST (13%) as a separate receipt line; the guess is against the pre-tax subtotal.

## Layout (match the reference screenshot)

A 4-tier stepped stainless display, 7 trays per tier, 28 ingredients:

| Tier | Trays (left → right) |
|---|---|
| 1 (top/back) | bok choy, napa cabbage, spinach, bean sprouts, broccoli, enoki, shiitake |
| 2 | shimeji, shrimp, fish tofu roll, striped fish dumpling, tofu skin, lotus root, mini sausage |
| 3 | tofu puff, firm tofu, pork blood curd, pork belly slice, fish ball, crab stick, snow peas |
| 4 (front) | beef slice, lamb roll slice, fatty beef slice, chicken slice, glass noodles, instant noodle, udon |

The Big Way bowl sits **centre-foreground** on the counter. A pair of tongs follows
the cursor and shows what is being picked.

## Assets (Mint MCP)

- One Mint Project for this codebase, recorded in `mint-assets.json`.
- **Each ingredient is its own model of a single piece** (one slice, one ball, one
  noodle nest), realistic raw-food look, so pieces can be instanced into trays and
  the bowl.
- Equipment models: gold Big Way–style bowl, stainless tongs, digital cashier scale.
- Trays, shelf, counter are procedural stainless geometry (repeated support props).
- Load GLBs through the shared Draco-capable loader.

## Interactions

- Hover tray → highlight + name tag. Click (or hold to keep grabbing) → tongs dip,
  grab a piece, arc to the bowl, piece settles in the pile.
- **Inspect bowl**: camera pushes in over the bowl; a panel lists what is inside
  (item × count, no weights). Pieces can be removed from the list.
- **Weigh it**: enter a dollar guess → bowl moves onto the scale → weight counts up
  → receipt shows weight, rate, subtotal, HST, your guess, the difference and a rating.
- Each ingredient has a realistic gram weight per piece with ±12% variance.
- No weight or price shown before the weigh-in.

## Quality bar

- High-quality food models, warm deli-case lighting, soft shadows, brushed steel.
- Minimal UI: bottom action bar, inspect panel, guess dialog, receipt. No provider
  branding in the UI.
- Small synthesized sound effects (grab, drop, scale beep, receipt).

## Verification

Build + typecheck, then a desktop browser pass: load, pick items, inspect, weigh,
receipt, new bowl; no console errors.
