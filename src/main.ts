import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadAssets } from './assets';
import { sfx } from './audio';
import { Bowl, type Piece } from './bowl';
import { CookedPot } from './cooked';
import { ALL, PRICE_PER_100G, SOUPS, TAX_LABEL, TAX_RATE, priceFor, thumbUrl } from './ingredients';
import { PixelPass } from './pixel';
import { BOWL_POS, SCALE_POS, buildWorld, pixelSwatches, type Tray } from './world';

type Mode = 'loading' | 'pick' | 'inspect' | 'guess' | 'weighing' | 'receipt' | 'cooked';

/* Model orientation tuning (set after looking at the generated meshes). */
const TONGS_TIP_SIGN = -1; // which end of the tongs' long axis holds the tips
const TONGS_ROLL = 0; // roll about the tongs' long axis, radians
const SCALE_YAW = 0; // spin so the scale's display faces the customer
const PLATTER_DROP = 0; // metres from the top of the scale model down to the platter

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const money = (value: number) => `$${value.toFixed(2)}`;

/* ---------- renderer & scene ---------- */

const canvas = $<HTMLCanvasElement>('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
/** Highest render scale; the frame loop drops below it when the GPU cannot keep up. */
const MAX_PIXEL_RATIO = Math.min(window.devicePixelRatio, 1.5);
let pixelRatio = MAX_PIXEL_RATIO;
renderer.setPixelRatio(pixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// The wall is static: shadows are only re-rendered while something is animating.
renderer.shadowMap.autoUpdate = false;
let shadowFrames = 3;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x120b08);

/* Pixel-art version: ?style=pixel (or the toggle) repaints the same scene as low-res pixel art. */
const pixelPass = new PixelPass();
const styleParam = new URLSearchParams(window.location.search).get('style');
let pixelMode = styleParam ? styleParam === 'pixel' : false;
try {
  if (!styleParam) pixelMode = localStorage.getItem('malatang-style') === 'pixel';
} catch {
  /* storage unavailable: keep the default */
}
function applyStyle() {
  document.body.classList.toggle('pixel', pixelMode);
  (scene.background as THREE.Color).set(pixelMode ? 0x8f84ad : 0x120b08);
  scene.environmentIntensity = pixelMode ? 0.5 : 0.6;
  renderer.toneMappingExposure = pixelMode ? 0.95 : 1.05;
  hemi.intensity = pixelMode ? 0.9 : 0.55;
  key.intensity = pixelMode ? 1.5 : 2.3;
  // Cabinet, trays and counter become flat pastel shapes in the pixel version.
  for (const { material, flat } of pixelSwatches) {
    const saved = (material.userData.original ??= {
      color: material.color.getHex(),
      map: material.map,
      metalness: material.metalness,
      roughness: material.roughness,
    }) as { color: number; map: THREE.Texture | null; metalness: number; roughness: number };
    material.color.setHex(pixelMode ? flat : saved.color);
    material.map = pixelMode ? null : saved.map;
    material.metalness = pixelMode ? 0 : saved.metalness;
    material.roughness = pixelMode ? 1 : saved.roughness;
    material.needsUpdate = true;
  }
  shadowFrames = 3;
  const button = document.getElementById('btn-style');
  if (button) button.textContent = pixelMode ? '3D version' : 'Pixel version';
}
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;

const hemi = new THREE.HemisphereLight(0xfff4e0, 0x2a1c14, 0.55);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff0dc, 2.3);
key.position.set(0.9, 3.1, 2.3);
key.target.position.set(0, 0.95, -0.2);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = -1.6;
key.shadow.camera.right = 1.6;
key.shadow.camera.top = 1.5;
key.shadow.camera.bottom = -1.5;
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 8;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.015;
scene.add(key, key.target);
const bowlLight = new THREE.SpotLight(0xffdcb0, 5, 3, 0.55, 0.8, 1.4);
bowlLight.position.set(0.1, 1.95, 1.0);
bowlLight.target.position.copy(BOWL_POS);
scene.add(bowlLight, bowlLight.target);

const camera = new THREE.PerspectiveCamera(44, 1, 0.05, 30);
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();

const WALL_LOOK = new THREE.Vector3(0, 0.96, -0.1);
const WALL_OFFSET = new THREE.Vector3(0, 1.04, 1.7);

function wallView() {
  const halfWidth = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect * 1.9;
  const k = Math.max(1, 1.0 / halfWidth);
  return { pos: WALL_LOOK.clone().addScaledVector(WALL_OFFSET, k), look: WALL_LOOK.clone() };
}
const inspectView = () => ({
  pos: BOWL_POS.clone().add(new THREE.Vector3(0, 0.62, 0.36)),
  look: BOWL_POS.clone().add(new THREE.Vector3(0, 0.06, 0)),
});
const scaleView = () => {
  const narrow = camera.aspect < 1;
  return {
    pos: SCALE_POS.clone().add(new THREE.Vector3(narrow ? 0 : 0.1, 0.8, narrow ? 1.2 : 0.86)),
    look: SCALE_POS.clone().add(new THREE.Vector3(narrow ? 0 : 0.2, 0.12, 0)),
  };
};

const cookedView = () => {
  const narrow = camera.aspect < 1;
  return {
    pos: BOWL_POS.clone().add(new THREE.Vector3(0, narrow ? 0.9 : 0.56, narrow ? 0.5 : 0.44)),
    look: BOWL_POS.clone().add(new THREE.Vector3(0, 0.02, narrow ? 0.05 : 0.035)),
  };
};

/* ---------- tweens ---------- */

interface Tween {
  t: number;
  duration: number;
  step: (k: number) => void;
  ease: (k: number) => number;
  resolve: () => void;
}
const tweens: Tween[] = [];
const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
const easeOut = (k: number) => 1 - (1 - k) ** 3;
const easeIn = (k: number) => k * k;
const linear = (k: number) => k;

function tween(duration: number, step: (k: number) => void, ease = easeInOut): Promise<void> {
  return new Promise((resolve) => tweens.push({ t: 0, duration, step, ease, resolve }));
}
const wait = (seconds: number) => tween(seconds, () => {}, linear);

let cameraMoves = 0;
async function moveCamera(view: { pos: THREE.Vector3; look: THREE.Vector3 }, duration: number) {
  const p0 = camPos.clone();
  const l0 = camLook.clone();
  cameraMoves += 1;
  await tween(duration, (k) => {
    camPos.lerpVectors(p0, view.pos, k);
    camLook.lerpVectors(l0, view.look, k);
  });
  cameraMoves -= 1;
}

/* ---------- DOM ---------- */

const ui = {
  loading: $('loading'),
  loadingBar: $('loading-bar'),
  loadingText: $('loading-text'),
  rate: $('rate'),
  btnStyle: $<HTMLButtonElement>('btn-style'),
  label: $('label'),
  toast: $('toast'),
  bar: $('bar'),
  hint: $('hint'),
  count: $('count'),
  btnInspect: $<HTMLButtonElement>('btn-inspect'),
  btnUndo: $<HTMLButtonElement>('btn-undo'),
  btnWeigh: $<HTMLButtonElement>('btn-weigh'),
  inspect: $('inspect'),
  inspectList: $('inspect-list'),
  inspectClose: $<HTMLButtonElement>('inspect-close'),
  guess: $('guess'),
  guessForm: $<HTMLFormElement>('guess-form'),
  guessInput: $<HTMLInputElement>('guess-input'),
  guessCancel: $<HTMLButtonElement>('guess-cancel'),
  soup: $<HTMLSelectElement>('soup'),
  lcd: $('lcd'),
  lcdWeight: $('lcd-weight'),
  lcdRate: $('lcd-rate'),
  lcdTotal: $('lcd-total'),
  receipt: $('receipt'),
  receiptOrder: $('receipt-order'),
  receiptItems: $('receipt-items'),
  receiptTotals: $('receipt-totals'),
  receiptGuess: $('receipt-guess'),
  receiptRating: $('receipt-rating'),
  receiptBest: $('receipt-best'),
  btnAgain: $<HTMLButtonElement>('btn-again'),
  btnCook: $<HTMLButtonElement>('btn-cook'),
  cooked: $('cooked'),
  cookedTitle: $('cooked-title'),
  cookedSub: $('cooked-sub'),
  btnReceipt: $<HTMLButtonElement>('btn-receipt'),
  btnAgain2: $<HTMLButtonElement>('btn-again-2'),
};
const show = (el: HTMLElement, visible: boolean) => el.classList.toggle('hidden', !visible);

let toastTimer = 0;
function toast(message: string) {
  ui.toast.textContent = message;
  show(ui.toast, true);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => show(ui.toast, false), 2200);
}

let viewW = 0;
let viewH = 0;
/** Sync the renderer to the window; returns true when the size changed. */
function resize(): boolean {
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  if (w === viewW && h === viewH && renderer.getPixelRatio() === pixelRatio) return false;
  viewW = w;
  viewH = h;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  pixelPass.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  return true;
}

/* ---------- game ---------- */

async function start() {
  resize();
  const assets = await loadAssets((done, total) => {
    ui.loadingBar.style.width = `${Math.round((done / total) * 100)}%`;
  });
  const world = buildWorld(scene, assets);
  world.scale.rotation.y = SCALE_YAW;
  const platterY = world.platterY - PLATTER_DROP;

  const bowl = new Bowl(assets.bowl);
  bowl.group.position.copy(BOWL_POS);
  scene.add(bowl.group);

  const cooked = new CookedPot();
  cooked.group.position.copy(BOWL_POS);
  scene.add(cooked.group);
  let cookedReady = false;

  // Tongs: the group's origin sits at the gripping tips.
  const tongs = new THREE.Group();
  const tongsModel = assets.tongs.object;
  const tongsRoll = new THREE.Group();
  tongsModel.position.x = (-TONGS_TIP_SIGN * assets.tongs.size.x) / 2;
  tongsRoll.rotation.x = TONGS_ROLL;
  tongsRoll.add(tongsModel);
  tongs.add(tongsRoll);
  tongs.quaternion.setFromUnitVectors(
    new THREE.Vector3(-TONGS_TIP_SIGN, 0, 0),
    new THREE.Vector3(0.34, 0.74, 0.58).normalize(),
  );
  tongs.traverse((child) => (child.castShadow = false));
  tongs.position.set(0.3, 1.25, 0.5);
  scene.add(tongs);
  const tipTarget = tongs.position.clone();
  let tongsOpen = 1;
  let tongsOpenTarget = 1;
  const held: THREE.Object3D[] = [];

  let mode: Mode = 'pick';
  let busy = false;
  let pointerDown = false;
  let clickQueued = false;
  let pointerInside = false;
  let hoveredTray: Tray | null = null;
  let hoveredPiece: Piece | null = null;
  let queuedTray: Tray | null = null;
  let inspectDirty = true;
  const pieceBox = new THREE.Box3();
  let guessValue = 0;
  const pointer = new THREE.Vector2(0, 0.2);
  const raycaster = new THREE.Raycaster();
  const shelfPlane = new THREE.Plane().setFromCoplanarPoints(
    new THREE.Vector3(-1, 1.06, 0.3),
    new THREE.Vector3(1, 1.06, 0.3),
    new THREE.Vector3(0, 1.62, -0.9),
  );
  const counterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.04);
  const tmp = new THREE.Vector3();

  camPos.copy(wallView().pos);
  camLook.copy(wallView().look);

  /* Warm every shader variant and upload every texture behind the loading screen, so the first
     grab, the first cook and the first pixel-art frame don't stall while the GPU compiles. */
  ui.loadingText.textContent = 'Heating the broth…';
  {
    const warm = new THREE.Group();
    const sample = (key: string) => {
      const item = ALL.find((i) => i.key === key)!;
      const proto = assets.food.get(key)!;
      const object = proto.object.clone();
      warm.add(object);
      return { item, grams: item.grams, object, rest: new THREE.Vector3(), footprint: 0.02, halfHeight: 0.02 };
    };
    const raw = [sample('shrimp'), sample('instant-noodle-block'), sample('glass-noodles')];
    warm.position.copy(BOWL_POS);
    scene.add(warm);
    cooked.build(raw.map((p) => ({ ...p, object: p.object.clone() })), 'Tomato');
    cooked.group.visible = true;
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    try {
      await renderer.compileAsync(scene, camera);
    } catch {
      renderer.compile(scene, camera);
    }
    renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    pixelPass.render(renderer, scene, camera);
    cooked.clear();
    cooked.group.visible = false;
    scene.remove(warm);
    shadowFrames = 3;
  }

  ui.rate.textContent = `${money(PRICE_PER_100G)} / 100 g`;
  SOUPS.forEach((name) => ui.soup.add(new Option(name, name)));
  show(ui.loading, false);
  show(ui.rate, true);
  show(ui.btnStyle, true);
  applyStyle();
  ui.btnStyle.addEventListener('click', () => {
    pixelMode = !pixelMode;
    try {
      localStorage.setItem('malatang-style', pixelMode ? 'pixel' : '3d');
    } catch {
      /* not persisted */
    }
    applyStyle();
    sfx.click();
  });
  show(ui.bar, true);
  show(ui.hint, true);
  canvas.classList.add('tongs');

  /* ----- HUD ----- */

  function refreshHud() {
    const n = bowl.pieces.length;
    ui.count.textContent = n === 0 ? 'Bowl is empty' : `${n} piece${n === 1 ? '' : 's'} in the bowl`;
    ui.btnWeigh.disabled = n === 0 || mode !== 'pick';
    ui.btnUndo.disabled = n === 0 || mode !== 'pick';
    ui.btnInspect.textContent = mode === 'inspect' ? 'Back to the fridge' : 'Inspect bowl';
    if (mode === 'inspect') renderInspectList();
  }

  function grouped() {
    return ALL.map((item) => {
      const pieces = bowl.pieces.filter((piece) => piece.item === item);
      return { item, pieces, grams: pieces.reduce((sum, piece) => sum + piece.grams, 0) };
    }).filter((group) => group.pieces.length > 0);
  }

  function renderInspectList() {
    ui.inspectList.replaceChildren();
    const groups = grouped();
    if (groups.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Nothing yet — go grab something.';
      ui.inspectList.append(li);
      return;
    }
    for (const group of groups) {
      const li = document.createElement('li');
      const img = document.createElement('img');
      img.src = thumbUrl(group.item.key);
      img.alt = '';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = group.item.name;
      const qty = document.createElement('span');
      qty.className = 'qty';
      qty.textContent = `×${group.pieces.length}`;
      const minus = document.createElement('button');
      minus.type = 'button';
      minus.textContent = '−';
      minus.title = `Put one ${group.item.name.toLowerCase()} back`;
      minus.addEventListener('click', () => removePiece(group.pieces[group.pieces.length - 1]));
      li.append(img, name, qty, minus);
      ui.inspectList.append(li);
    }
  }

  /* ----- picking ----- */

  const pieceWeight = (grams: number) => Math.round(grams * (0.88 + Math.random() * 0.24) * 10) / 10;

  async function grab(tray: Tray) {
    busy = true;
    const pieces: Piece[] = [];
    for (let i = 0; i < tray.item.perGrab; i += 1) {
      const piece = bowl.add(tray.item, tray.proto, pieceWeight(tray.item.grams));
      if (!piece) break;
      pieces.push(piece);
    }
    if (pieces.length === 0) {
      sfx.full();
      toast('The bowl is heaped full — time to weigh it.');
      pointerDown = false;
      busy = false;
      return;
    }
    ui.hint.classList.add('fade');

    let dip = tray.centre.clone();
    pieces.forEach(() => (dip = tray.take()));
    dip.y += 0.012;
    const from = tongs.position.clone();
    await tween(0.1, (k) => tongs.position.lerpVectors(from, dip, k), easeOut);

    tongsOpenTarget = 0;
    sfx.grab();
    pieces.forEach((piece) => {
      scene.add(piece.object);
      held.push(piece.object);
    });
    await wait(0.03);

    const drop = BOWL_POS.clone().add(pieces[0].rest);
    drop.y = BOWL_POS.y + Math.max(pieces[0].rest.y + 0.13, bowl.height + 0.07);
    await tween(0.3, (k) => {
      tongs.position.lerpVectors(dip, drop, k);
      tongs.position.y += Math.sin(k * Math.PI) * 0.1;
    });

    tongsOpenTarget = 1;
    held.length = 0;
    // The tongs are free again: the next grab can start while these pieces settle.
    busy = false;
    await Promise.all(
      pieces.map(async (piece, i) => {
        bowl.attach(piece);
        const p0 = piece.object.position.clone();
        if (i > 0) await wait(i * 0.05);
        await tween(0.2, (k) => piece.object.position.lerpVectors(p0, piece.rest, k), easeIn);
        sfx.drop();
      }),
    );
    refreshHud();
  }

  async function removePiece(piece: Piece | undefined) {
    if (!piece || busy) return;
    busy = true;
    if (hoveredPiece === piece) hoveredPiece = null;
    const starts = new Map(bowl.pieces.map((p) => [p, p.object.position.clone()]));
    bowl.remove(piece);
    scene.attach(piece.object);
    sfx.remove();
    refreshHud();
    const y0 = piece.object.position.y;
    const s0 = piece.object.scale.x;
    await tween(
      0.24,
      (k) => {
        piece.object.position.y = y0 + k * 0.12;
        piece.object.scale.setScalar(s0 * (1 - k * 0.95));
        bowl.pieces.forEach((p) => p.object.position.lerpVectors(starts.get(p)!, p.rest, k));
      },
      easeOut,
    );
    scene.remove(piece.object);
    busy = false;
    inspectDirty = true;
  }

  /* ----- modes ----- */

  async function setInspect(on: boolean) {
    if (busy || (mode !== 'pick' && mode !== 'inspect')) return;
    sfx.click();
    mode = on ? 'inspect' : 'pick';
    show(ui.inspect, on);
    show(ui.hint, false);
    canvas.classList.toggle('tongs', !on);
    tongs.visible = !on;
    hoveredTray = null;
    hoveredPiece = null;
    refreshHud();
    await moveCamera(on ? inspectView() : wallView(), 0.6);
  }

  function openGuess() {
    if (busy || mode !== 'pick' || bowl.pieces.length === 0) return;
    sfx.click();
    mode = 'guess';
    ui.guessInput.value = '';
    show(ui.guess, true);
    ui.guessInput.focus();
    refreshHud();
  }

  function closeGuess() {
    show(ui.guess, false);
    mode = 'pick';
    refreshHud();
  }

  async function weigh() {
    mode = 'weighing';
    busy = true;
    show(ui.guess, false);
    show(ui.bar, false);
    show(ui.hint, false);
    show(ui.label, false);
    tongs.visible = false;
    world.highlight.visible = false;
    canvas.classList.remove('tongs');

    const grams = Math.round(bowl.totalGrams);
    const price = priceFor(grams);
    ui.lcdWeight.textContent = '0.000';
    ui.lcdRate.textContent = PRICE_PER_100G.toFixed(2);
    ui.lcdTotal.textContent = '0.00';

    const cam = moveCamera(scaleView(), 1.1);
    const p0 = bowl.group.position.clone();
    const lifted = p0.clone().setY(p0.y + 0.16);
    const over = new THREE.Vector3(SCALE_POS.x, platterY + 0.16, SCALE_POS.z);
    const down = over.clone().setY(platterY);
    await tween(0.3, (k) => bowl.group.position.lerpVectors(p0, lifted, k));
    await tween(0.55, (k) => bowl.group.position.lerpVectors(lifted, over, k));
    await tween(0.3, (k) => bowl.group.position.lerpVectors(over, down, k), easeIn);
    sfx.drop();
    await cam;
    show(ui.lcd, true);

    let lastTick = -1;
    await tween(
      1.7,
      (k) => {
        const wobble = Math.sin(k * 26) * (1 - k) * 0.12;
        const shown = Math.max(0, grams * Math.min(1, k * 1.12 + wobble));
        const settled = k >= 1 ? grams : Math.round(shown);
        ui.lcdWeight.textContent = (settled / 1000).toFixed(3);
        ui.lcdTotal.textContent = priceFor(settled).toFixed(2);
        const tick = Math.floor(k * 14);
        if (tick !== lastTick) {
          lastTick = tick;
          sfx.tick();
        }
      },
      easeOut,
    );
    sfx.beep();
    await wait(0.6);
    showReceipt(grams, price);
    mode = 'receipt';
    busy = false;
  }

  function line(list: HTMLElement, left: string, right: string, strong = false) {
    const row = document.createElement(list.tagName === 'UL' ? 'li' : 'div');
    if (strong) row.className = 'strong';
    const a = document.createElement(list.tagName === 'UL' ? 'span' : 'dt');
    const b = document.createElement(list.tagName === 'UL' ? 'span' : 'dd');
    a.textContent = left;
    b.textContent = right;
    row.append(a, b);
    list.append(row);
  }

  function showReceipt(grams: number, price: number) {
    const tax = Math.round(price * TAX_RATE * 100) / 100;
    const diff = guessValue - price;
    const pct = price > 0 ? (Math.abs(diff) / price) * 100 : 0;

    ui.receiptOrder.textContent = `Order #${String.fromCharCode(65 + Math.floor(Math.random() * 6))}${10 + Math.floor(Math.random() * 89)} · ${ui.soup.value}`;
    ui.receiptItems.replaceChildren();
    grouped().forEach((group) =>
      line(ui.receiptItems, `${group.item.name} ×${group.pieces.length}`, `${Math.round(group.grams)} g`),
    );
    ui.receiptTotals.replaceChildren();
    line(ui.receiptTotals, 'Weight', `${(grams / 1000).toFixed(3)} kg`);
    line(ui.receiptTotals, 'Rate', `${money(PRICE_PER_100G)} / 100 g`);
    line(ui.receiptTotals, 'Soup base', 'FREE');
    line(ui.receiptTotals, 'Subtotal', money(price), true);
    line(ui.receiptTotals, TAX_LABEL, money(tax));
    line(ui.receiptTotals, 'Total', money(price + tax));
    ui.receiptGuess.replaceChildren();
    line(ui.receiptGuess, 'Your guess', money(guessValue));
    line(ui.receiptGuess, 'Actual (pre-tax)', money(price));
    line(
      ui.receiptGuess,
      'Off by',
      `${money(Math.abs(diff))} ${diff > 0.004 ? 'over' : diff < -0.004 ? 'under' : ''} (${pct.toFixed(1)}%)`,
      true,
    );

    const [title, note] =
      pct <= 2
        ? ['Human scale', 'The cashier is out of a job.']
        : pct <= 5
          ? ['Malatang master', 'You have clearly done this before.']
          : pct <= 10
            ? ['Regular', 'Close enough to budget lunch.']
            : pct <= 20
              ? ['Getting there', 'The noodles got you, did they not?']
              : pct <= 40
                ? diff > 0
                  ? ['Overcautious', 'It was lighter than you feared.']
                  : ['Eyes bigger than wallet', 'Everything weighs more than it looks.']
                : diff > 0
                  ? ['Big spender', 'You budgeted for a much heavier bowl.']
                  : ['First time?', 'By weight means by weight.'];
    ui.receiptRating.replaceChildren(title);
    const small = document.createElement('small');
    small.textContent = note;
    ui.receiptRating.append(small);

    let best = Number.NaN;
    try {
      best = Number.parseFloat(localStorage.getItem('malatang-best') ?? '');
      if (Number.isNaN(best) || pct < best) {
        best = pct;
        localStorage.setItem('malatang-best', String(pct));
      }
    } catch {
      best = pct;
    }
    ui.receiptBest.textContent = `Your best: off by ${best.toFixed(1)}%`;
    show(ui.receipt, true);
    sfx.receipt(pct <= 10);
  }

  async function cook() {
    if (busy) return;
    if (cookedReady) {
      // Already cooked: just put the receipt away again.
      show(ui.receipt, false);
      show(ui.cooked, true);
      mode = 'cooked';
      return;
    }
    busy = true;
    sfx.click();
    show(ui.receipt, false);
    show(ui.lcd, false);
    const soup = ui.soup.value;
    cooked.build(bowl.pieces, soup);
    const n = bowl.pieces.length;
    ui.cookedTitle.textContent = soup === 'Dry Mix Mala' ? 'Dry mix mala, tossed' : `${soup} malatang`;
    ui.cookedSub.textContent = `${ui.receiptOrder.textContent?.split(' · ')[0] ?? 'Order'} is ready · ${n} piece${n === 1 ? '' : 's'}, ${(bowl.totalGrams / 1000).toFixed(3)} kg`;

    // The raw bowl heads to the kitchen; the gold pot comes out steaming.
    const p0 = bowl.group.position.clone();
    const away = p0.clone().add(new THREE.Vector3(0.6, 0.25, -0.3));
    await tween(0.45, (k) => bowl.group.position.lerpVectors(p0, away, k), easeIn);
    bowl.group.visible = false;
    bowl.group.position.copy(p0);
    const cam = moveCamera(cookedView(), 1.2);
    const above = BOWL_POS.clone().setY(BOWL_POS.y + 0.35);
    cooked.group.visible = true;
    cooked.group.position.copy(above);
    cooked.group.scale.setScalar(0.9);
    await wait(0.35);
    await tween(0.6, (k) => {
      cooked.group.position.lerpVectors(above, BOWL_POS, k);
      cooked.group.scale.setScalar(0.9 + 0.1 * k);
    }, easeIn);
    sfx.drop();
    await cam;
    cookedReady = true;
    ui.btnCook.textContent = 'Back to my bowl';
    show(ui.cooked, true);
    sfx.receipt(true);
    mode = 'cooked';
    busy = false;
  }

  function reopenReceipt() {
    if (busy) return;
    sfx.click();
    show(ui.cooked, false);
    show(ui.receipt, true);
    mode = 'receipt';
  }

  async function newBowl() {
    if (busy) return;
    busy = true;
    sfx.click();
    show(ui.receipt, false);
    show(ui.lcd, false);
    show(ui.cooked, false);
    bowl.clear();
    ui.btnCook.textContent = 'Cook my bowl';
    if (cookedReady) {
      cookedReady = false;
      cooked.group.visible = false;
      cooked.clear();
      bowl.group.visible = true;
    }
    const p0 = bowl.group.position.clone();
    const up = p0.clone().setY(p0.y + 0.16);
    const over = BOWL_POS.clone().setY(BOWL_POS.y + 0.16);
    const cam = moveCamera(wallView(), 1.0);
    await tween(0.25, (k) => bowl.group.position.lerpVectors(p0, up, k));
    await tween(0.45, (k) => bowl.group.position.lerpVectors(up, over, k));
    await tween(0.25, (k) => bowl.group.position.lerpVectors(over, BOWL_POS, k), easeIn);
    await cam;
    mode = 'pick';
    tongs.visible = true;
    canvas.classList.add('tongs');
    show(ui.bar, true);
    busy = false;
    refreshHud();
  }

  /* ----- input ----- */

  function setPointer(event: PointerEvent) {
    pointer.set((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
  }
  canvas.addEventListener('pointermove', (event) => {
    pointerInside = true;
    inspectDirty = true;
    setPointer(event);
  });
  canvas.addEventListener('pointerleave', () => {
    pointerInside = false;
    inspectDirty = true;
    pointerDown = false;
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    pointerInside = true;
    setPointer(event);
    pointerDown = true;
    clickQueued = true;
  });
  window.addEventListener('pointerup', () => (pointerDown = false));
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  ui.btnInspect.addEventListener('click', () => void setInspect(mode !== 'inspect'));
  ui.inspectClose.addEventListener('click', () => void setInspect(false));
  ui.btnUndo.addEventListener('click', () => void removePiece(bowl.pieces[bowl.pieces.length - 1]));
  ui.btnWeigh.addEventListener('click', openGuess);
  ui.guessCancel.addEventListener('click', closeGuess);
  ui.guessForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = Number.parseFloat(ui.guessInput.value);
    if (!Number.isFinite(value) || value < 0) return;
    guessValue = Math.round(value * 100) / 100;
    void weigh();
  });
  ui.btnAgain.addEventListener('click', () => void newBowl());
  ui.btnAgain2.addEventListener('click', () => void newBowl());
  ui.btnCook.addEventListener('click', () => void cook());
  ui.btnReceipt.addEventListener('click', reopenReceipt);

  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
      if (event.key === 'Escape' && mode === 'guess') closeGuess();
      return;
    }
    const k = event.key.toLowerCase();
    if (k === 'i') void setInspect(mode !== 'inspect');
    else if (k === 'z' && mode === 'pick') void removePiece(bowl.pieces[bowl.pieces.length - 1]);
    else if (k === 'enter' && mode === 'pick') openGuess();
    else if (k === 'enter' && mode === 'receipt') void cook();
    else if (k === 'enter' && mode === 'cooked') void newBowl();
    else if (k === 'escape' && mode === 'inspect') void setInspect(false);
    else if (k === 'escape' && mode === 'guess') closeGuess();
    else if (k === 'm') toast(sfx.toggleMute() ? 'Sound off' : 'Sound on');
  });

  /* ----- frame loop ----- */

  function placeLabel(world: THREE.Vector3, title: string, sub?: string) {
    tmp.copy(world).project(camera);
    const x = (tmp.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-tmp.y * 0.5 + 0.5) * window.innerHeight;
    if (ui.label.dataset.key !== title + (sub ?? '')) {
      ui.label.dataset.key = title + (sub ?? '');
      ui.label.replaceChildren(title);
      if (sub) {
        const small = document.createElement('small');
        small.textContent = sub;
        ui.label.append(small);
      }
    }
    const w = ui.label.offsetWidth;
    const lx = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2));
    ui.label.style.transform = `translate(${lx}px, ${Math.max(8, y - 64)}px)`;
    show(ui.label, true);
  }

  function updatePick(dt: number) {
    raycaster.setFromCamera(pointer, camera);
    const hit = pointerInside ? raycaster.intersectObjects(world.hits, false)[0] : undefined;
    const tray = (hit?.object.userData.tray as Tray | undefined) ?? null;
    if (tray !== hoveredTray) {
      hoveredTray = tray;
      world.highlight.visible = !!tray;
      if (tray) {
        world.highlight.matrix.copy(tray.group.matrixWorld);
        world.highlight.matrixWorldNeedsUpdate = true;
      }
    }

    if (!busy) {
      if (hit) {
        tipTarget.copy(hit.point);
        tipTarget.y += 0.05;
      } else {
        const plane = raycaster.ray.intersectPlane(shelfPlane, tmp);
        if (plane && tmp.z <= 0.3) tipTarget.copy(tmp);
        else if (raycaster.ray.intersectPlane(counterPlane, tmp)) tipTarget.copy(tmp);
      }
      tongs.position.lerp(tipTarget, 1 - Math.exp(-32 * dt));
      if (queuedTray) {
        const tray = queuedTray;
        queuedTray = null;
        void grab(tray);
      } else if ((pointerDown || clickQueued) && hoveredTray) void grab(hoveredTray);
    } else if (clickQueued && hoveredTray) {
      // Clicked mid-grab: remember it instead of dropping the click.
      queuedTray = hoveredTray;
    }
    clickQueued = false;

    if (hoveredTray) placeLabel(hoveredTray.centre, hoveredTray.item.name);
    else show(ui.label, false);
  }

  function updateInspect() {
    let piece = hoveredPiece;
    if (inspectDirty || busy || cameraMoves > 0) {
      inspectDirty = false;
      piece = null;
      if (pointerInside && !busy) {
        raycaster.setFromCamera(pointer, camera);
        let best = Infinity;
        for (const candidate of bowl.pieces) {
          // Boxes from the geometry bounds: no per-triangle tests against 5k-triangle models.
          pieceBox.setFromObject(candidate.object);
          const at = raycaster.ray.intersectBox(pieceBox, tmp);
          if (at) {
            const d = at.distanceToSquared(raycaster.ray.origin);
            if (d < best) {
              best = d;
              piece = candidate;
            }
          }
        }
      }
    }
    if (piece !== hoveredPiece) {
      hoveredPiece?.object.scale.setScalar(1);
      hoveredPiece = piece;
      hoveredPiece?.object.scale.setScalar(1.14);
      canvas.style.cursor = piece ? 'pointer' : '';
    }
    if (hoveredPiece) {
      placeLabel(hoveredPiece.object.getWorldPosition(new THREE.Vector3()), hoveredPiece.item.name, 'Click to put back');
      if (clickQueued) void removePiece(hoveredPiece);
    } else {
      show(ui.label, false);
    }
    clickQueued = false;
  }

  let last = performance.now();
  let frameAvg = 16;
  let frameCount = 0;
  /** Trade render resolution for frame rate on slower GPUs (and give it back when there's headroom). */
  function adaptResolution(rawMs: number) {
    if (rawMs <= 0 || rawMs > 120 || document.hidden) return; // ignore tab switches and stalls
    frameAvg += (rawMs - frameAvg) * 0.08;
    frameCount += 1;
    if (frameCount < 45) return;
    let next = pixelRatio;
    if (frameAvg > 21 && pixelRatio > 0.6) next = Math.max(0.6, pixelRatio - 0.15);
    else if (frameAvg < 13 && pixelRatio < MAX_PIXEL_RATIO) next = Math.min(MAX_PIXEL_RATIO, pixelRatio + 0.1);
    if (next !== pixelRatio) {
      pixelRatio = Math.round(next * 100) / 100;
      frameCount = 0;
    }
  }

  function frame(now: number) {
    adaptResolution(now - last);
    const dt = Math.min(Math.max((now - last) / 1000, 0), 0.05);
    last = now;
    if (tweens.length > 0) shadowFrames = 2;
    if (resize() && cameraMoves === 0) {
      const view = cookedReady
        ? cookedView()
        : mode === 'inspect'
          ? inspectView()
          : mode === 'pick' || mode === 'guess'
            ? wallView()
            : scaleView();
      camPos.copy(view.pos);
      camLook.copy(view.look);
    }
    for (let i = tweens.length - 1; i >= 0; i -= 1) {
      const tw = tweens[i];
      tw.t = Math.min(tw.duration, tw.t + dt);
      tw.step(tw.ease(tw.duration === 0 ? 1 : tw.t / tw.duration));
      if (tw.t >= tw.duration) {
        tweens.splice(i, 1);
        tw.resolve();
      }
    }

    if (mode === 'pick') updatePick(dt);
    else if (mode === 'inspect') updateInspect();
    else {
      canvas.style.cursor = '';
      clickQueued = false;
    }

    if (cooked.group.visible) {
      cooked.softSteam = pixelMode;
      cooked.update(dt);
      shadowFrames = Math.max(shadowFrames, 1);
    }

    tongsOpen += (tongsOpenTarget - tongsOpen) * (1 - Math.exp(-30 * dt));
    tongsModel.scale.z = 0.55 + 0.45 * tongsOpen;
    held.forEach((object, i) => {
      object.position.copy(tongs.position);
      object.position.x += (i - (held.length - 1) / 2) * 0.012;
      object.position.y -= 0.004;
    });

    camera.position.copy(camPos);
    camera.lookAt(camLook);
    if (shadowFrames > 0) {
      shadowFrames -= 1;
      renderer.shadowMap.needsUpdate = true;
    }
    if (pixelMode) pixelPass.render(renderer, scene, camera);
    else renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  refreshHud();
  if (import.meta.env.DEV) {
    Object.assign(window, {
      __malatang: {
        /** Dev only: skip straight to the finished bowl with the current picks. */
        serve: (soup: string) => {
          ui.soup.value = soup;
          cooked.build(bowl.pieces, soup);
          cooked.group.visible = true;
          cooked.group.position.copy(BOWL_POS);
          bowl.group.visible = false;
          tongs.visible = false;
          cookedReady = true;
          mode = 'cooked';
          ui.cookedTitle.textContent = `${soup} malatang`;
          show(ui.bar, false);
          show(ui.hint, false);
          show(ui.receipt, false);
          show(ui.lcd, false);
          show(ui.cooked, true);
          const view = cookedView();
          camPos.copy(view.pos);
          camLook.copy(view.look);
        },
        /** Dev only: the cooked pot as a base64 GLB (used to stage the Blender shots). */
        exportCooked: async () => {
          const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
          // Per-instance colours do not survive glTF: bake each instanced mesh's first colour into
          // its material, and export the broth opaque and named so Blender can find it.
          const restore: Array<() => void> = [];
          cooked.turntable.traverse((child) => {
            const inst = child as THREE.InstancedMesh;
            if (inst.isInstancedMesh && inst.instanceColor) {
              const material = inst.material as THREE.MeshStandardMaterial;
              const colors = inst.instanceColor;
              inst.material = material.clone();
              const c = new THREE.Color();
              inst.getColorAt(0, c);
              (inst.material as THREE.MeshStandardMaterial).color.copy(c);
              inst.instanceColor = null;
              restore.push(() => {
                inst.material = material;
                inst.instanceColor = colors;
              });
            }
          });
          const glb = (await new GLTFExporter().parseAsync(cooked.turntable, { binary: true })) as ArrayBuffer;
          restore.forEach((undo) => undo());
          let text = '';
          const bytes = new Uint8Array(glb);
          for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return btoa(text);
        },
        cooked, scene, camera, camPos, camLook, renderer, bowl, world, tongs, assets, state: () => ({ mode, busy, pieces: bowl.pieces.length }) },
    });
  }
  requestAnimationFrame(frame);
}

start().catch((error: unknown) => {
  console.error(error);
  ui.loadingText.textContent = 'Could not load the ingredients. Refresh to try again.';
  ui.loadingBar.style.background = '#e2452f';
});
