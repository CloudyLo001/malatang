import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Assets, Proto } from './assets';
import { ROWS, type Ingredient } from './ingredients';

export const COUNTER_Y = 0.86;
export const BOWL_POS = new THREE.Vector3(0, COUNTER_Y, 0.5);
export const SCALE_POS = new THREE.Vector3(0.66, COUNTER_Y, 0.6);

const TRAY_W = 0.235;
const TRAY_D = 0.21;
const TRAY_H = 0.05;
const PITCH = 0.25;
const TILT = 0.34;
const TIER_RISE = 0.15;
const TIER_RUN = 0.262;
const TIER0_Y = 0.94;
const WALL_T = 0.004;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface PieceSlot {
  matrix: THREE.Matrix4;
  position: THREE.Vector3;
  present: boolean;
}

export class Tray {
  readonly group = new THREE.Group();
  readonly hit: THREE.Mesh;
  readonly centre = new THREE.Vector3();
  private slots: PieceSlot[] = [];
  private instanced!: THREE.InstancedMesh;

  constructor(
    readonly item: Ingredient,
    readonly proto: Proto,
  ) {
    this.hit = new THREE.Mesh(new THREE.BoxGeometry(TRAY_W + 0.012, 0.09, TRAY_D + 0.012));
    this.hit.position.y = 0.035;
    this.hit.visible = false;
    this.hit.userData.tray = this;
    this.group.add(this.hit);
  }

  /** Fill the tray. Call once the tray's world matrix is final. */
  stock(scene: THREE.Scene) {
    this.group.updateMatrixWorld(true);
    this.centre.set(0, TRAY_H + 0.02, 0).applyMatrix4(this.group.matrixWorld);

    const s = this.proto.size;
    const innerW = TRAY_W - 0.03;
    const innerD = TRAY_D - 0.03;
    const foot = Math.max(0.02, ((s.x + s.z) / 2) * 0.74);
    const cols = Math.max(1, Math.floor(innerW / foot));
    const rows = Math.max(1, Math.floor(innerD / foot));
    const perLayer = cols * rows;
    // Bulky pieces get fewer layers so the heap stays inside the tier.
    const maxLayers = Math.max(1, Math.floor(0.11 / (s.y * 0.72)));
    const count = Math.min(36, perLayer * maxLayers, Math.max(this.item.trayCount, perLayer));
    const roundish = s.x / Math.max(s.z, 1e-4) < 1.35;
    const maxX = Math.max(0, innerW / 2 - Math.min(s.x, s.z) * 0.45);
    const maxZ = Math.max(0, innerD / 2 - Math.min(s.x, s.z) * 0.45);

    const local = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    let order: number[] = [];

    for (let k = 0; k < count; k += 1) {
      const layer = Math.floor(k / perLayer);
      if (k % perLayer === 0) {
        order = Array.from({ length: perLayer }, (_, i) => i).sort(() => Math.random() - 0.5);
      }
      const cell = order[k % perLayer];
      const col = cell % cols;
      const row = Math.floor(cell / cols);
      pos.set(
        THREE.MathUtils.clamp(((col + 0.5) / cols - 0.5) * innerW + rand(-0.3, 0.3) * (innerW / cols), -maxX, maxX),
        WALL_T + s.y * 0.5 + layer * s.y * 0.72 + rand(0, 0.003),
        THREE.MathUtils.clamp(((row + 0.5) / rows - 0.5) * innerD + rand(-0.3, 0.3) * (innerD / rows), -maxZ, maxZ),
      );
      const yaw = roundish ? rand(0, Math.PI * 2) : rand(-0.45, 0.45) + (Math.random() < 0.5 ? Math.PI : 0);
      const lean = layer === 0 ? 0.08 : 0.24;
      euler.set(rand(-lean, lean), yaw, rand(-lean, lean), 'YXZ');
      quat.setFromEuler(euler);
      local.compose(pos, quat, one);
      const matrix = new THREE.Matrix4()
        .multiplyMatrices(this.group.matrixWorld, local)
        .multiply(this.proto.meshMatrix);
      this.slots.push({
        matrix,
        position: pos.clone().applyMatrix4(this.group.matrixWorld),
        present: true,
      });
    }

    this.instanced = new THREE.InstancedMesh(
      this.proto.lodGeometry ?? this.proto.mesh.geometry,
      this.proto.mesh.material,
      count,
    );
    this.instanced.castShadow = true;
    this.instanced.receiveShadow = true;
    this.instanced.frustumCulled = false;
    scene.add(this.instanced);
    this.refresh();
  }

  private refresh() {
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    this.slots.forEach((slot, i) => this.instanced.setMatrixAt(i, slot.present ? slot.matrix : hidden));
    this.instanced.instanceMatrix.needsUpdate = true;
  }

  /** Remove the top-most piece and return where it was. */
  take(): THREE.Vector3 {
    let left = this.slots.filter((slot) => slot.present).length;
    if (left <= Math.ceil(this.slots.length * 0.35)) {
      this.slots.forEach((slot) => (slot.present = true));
      left = this.slots.length;
    }
    for (let i = this.slots.length - 1; i >= 0; i -= 1) {
      const slot = this.slots[i];
      if (slot.present) {
        slot.present = false;
        this.refresh();
        return slot.position.clone();
      }
    }
    return this.centre.clone();
  }
}

/** Structural materials and the flat colour each takes in the pixel-art version. */
export const pixelSwatches: Array<{ material: THREE.MeshStandardMaterial; flat: number }> = [];
const swatch = (material: THREE.MeshStandardMaterial, flat: number) => {
  pixelSwatches.push({ material, flat });
  return material;
};

function steel(roughness: number, color = 0xdfe2e6) {
  return new THREE.MeshStandardMaterial({ color, metalness: 1, roughness });
}

function trayGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    parts.push(g);
  };
  const w = TRAY_W - 0.014;
  const d = TRAY_D - 0.014;
  box(w, WALL_T, d, 0, WALL_T / 2, 0);
  box(w, TRAY_H, WALL_T, 0, TRAY_H / 2, d / 2);
  box(w, TRAY_H, WALL_T, 0, TRAY_H / 2, -d / 2);
  box(WALL_T, TRAY_H, d, w / 2, TRAY_H / 2, 0);
  box(WALL_T, TRAY_H, d, -w / 2, TRAY_H / 2, 0);
  // Flanged rim.
  const lip = 0.009;
  box(TRAY_W, 0.003, lip, 0, TRAY_H, d / 2 + lip / 2 - 0.002);
  box(TRAY_W, 0.003, lip, 0, TRAY_H, -d / 2 - lip / 2 + 0.002);
  box(lip, 0.003, TRAY_D, w / 2 + lip / 2 - 0.002, TRAY_H, 0);
  box(lip, 0.003, TRAY_D, -w / 2 - lip / 2 + 0.002, TRAY_H, 0);
  return mergeGeometries(parts)!;
}

function woodTexture(base: string, streak: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 260; i += 1) {
    ctx.strokeStyle = streak;
    ctx.globalAlpha = rand(0.04, 0.22);
    ctx.lineWidth = rand(0.5, 2.5);
    const y = rand(0, 512);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(170, y + rand(-6, 6), 340, y + rand(-6, 6), 512, y + rand(-3, 3));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

export interface World {
  trays: Tray[];
  hits: THREE.Mesh[];
  highlight: THREE.Group;
  scale: THREE.Group;
  /** World-space height of the scale's weighing surface. */
  platterY: number;
}

export function buildWorld(scene: THREE.Scene, assets: Assets): World {
  const span = PITCH * 7 + 0.05;
  const deckMat = swatch(steel(0.42, 0x8f9399), 0x7f7a9c);
  const trayMat = swatch(steel(0.2, 0xf2f4f6), 0xf3eef6);
  const darkSteel = swatch(steel(0.5, 0x6d7076), 0x5a5273);
  const trayGeo = trayGeometry();
  const trays: Tray[] = [];

  ROWS.forEach((row, r) => {
    const tier = ROWS.length - 1 - r;
    const tierGroup = new THREE.Group();
    tierGroup.position.set(0, TIER0_Y + tier * TIER_RISE, -tier * TIER_RUN);
    tierGroup.rotation.x = TILT;
    scene.add(tierGroup);

    const deck = new THREE.Mesh(new THREE.BoxGeometry(span, 0.018, TRAY_D + 0.05), deckMat);
    deck.position.y = -0.011;
    deck.receiveShadow = true;
    deck.castShadow = true;
    tierGroup.add(deck);

    // Front rail of each tier.
    const rail = new THREE.Mesh(new THREE.BoxGeometry(span, 0.03, 0.012), deckMat);
    rail.position.set(0, 0.004, TRAY_D / 2 + 0.03);
    rail.castShadow = true;
    tierGroup.add(rail);

    row.forEach((item, c) => {
      const proto = assets.food.get(item.key);
      if (!proto) throw new Error(`Missing model for ${item.key}`);
      const tray = new Tray(item, proto);
      tray.group.position.x = (c - 3) * PITCH;
      const pan = new THREE.Mesh(trayGeo, trayMat);
      pan.castShadow = true;
      pan.receiveShadow = true;
      tray.group.add(pan);
      tierGroup.add(tray.group);
      trays.push(tray);
    });

    // Vertical riser behind the tier with an LED strip under the next shelf.
    const riser = new THREE.Mesh(new THREE.BoxGeometry(span, 0.17, 0.012), darkSteel);
    riser.position.set(0, TIER0_Y + tier * TIER_RISE + 0.085, -tier * TIER_RUN - 0.118);
    riser.receiveShadow = true;
    scene.add(riser);
    const led = new THREE.Mesh(
      new THREE.BoxGeometry(span - 0.04, 0.006, 0.012),
      new THREE.MeshBasicMaterial({ color: 0xfff1d6, toneMapped: false }),
    );
    led.position.set(0, riser.position.y + 0.078, riser.position.z + 0.012);
    scene.add(led);
  });

  scene.updateMatrixWorld(true);
  trays.forEach((tray) => tray.stock(scene));

  // Cabinet shell.
  const wood = woodTexture('#2a1a11', '#0d0704');
  wood.repeat.set(3, 2);
  const woodMat = swatch(new THREE.MeshStandardMaterial({ map: wood, roughness: 0.62, metalness: 0.05 }), 0xa996bf);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(6, 3.2), woodMat);
  back.position.set(0, 1.5, -1.02);
  back.receiveShadow = true;
  scene.add(back);
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.4, 1.35), darkSteel);
    panel.position.set(side * (span / 2 + 0.03), 1.25, -0.42);
    panel.castShadow = true;
    panel.receiveShadow = true;
    scene.add(panel);
  }
  const hood = new THREE.Mesh(new THREE.BoxGeometry(span + 0.12, 0.07, 1.2), darkSteel);
  hood.position.set(0, 1.97, -0.45);
  scene.add(hood);
  const hoodLight = new THREE.Mesh(
    new THREE.BoxGeometry(span - 0.1, 0.01, 0.05),
    new THREE.MeshBasicMaterial({ color: 0xfff3dc, toneMapped: false }),
  );
  hoodLight.position.set(0, 1.93, 0.05);
  scene.add(hoodLight);

  // Kick plate between the counter and the first tier.
  const kick = new THREE.Mesh(new THREE.BoxGeometry(span, 0.2, 0.014), deckMat);
  kick.position.set(0, COUNTER_Y + 0.02, 0.135);
  kick.receiveShadow = true;
  scene.add(kick);

  // Counter.
  const counterTex = woodTexture('#3a2617', '#120a05');
  counterTex.repeat.set(4, 1);
  const counter = new THREE.Mesh(
    new THREE.BoxGeometry(4.2, 0.06, 1.1),
    swatch(new THREE.MeshStandardMaterial({ map: counterTex, roughness: 0.38, metalness: 0.08 }), 0xe9b193),
  );
  counter.position.set(0, COUNTER_Y - 0.03, 0.68);
  counter.receiveShadow = true;
  scene.add(counter);
  const fascia = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.9, 0.04), woodMat);
  fascia.position.set(0, COUNTER_Y - 0.5, 1.2);
  scene.add(fascia);

  // Hover highlight frame.
  const highlight = new THREE.Group();
  const glow = new THREE.MeshBasicMaterial({ color: 0xffc247, toneMapped: false });
  const fw = TRAY_W + 0.006;
  const fd = TRAY_D + 0.006;
  const bar = 0.006;
  for (const [w, d, x, z] of [
    [fw, bar, 0, fd / 2],
    [fw, bar, 0, -fd / 2],
    [bar, fd, fw / 2, 0],
    [bar, fd, -fw / 2, 0],
  ]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(w, 0.005, d), glow);
    edge.position.set(x, TRAY_H + 0.004, z);
    highlight.add(edge);
  }
  highlight.visible = false;
  highlight.matrixAutoUpdate = false;
  scene.add(highlight);

  // Cashier scale.
  const scale = new THREE.Group();
  const scaleObj = assets.scale.object;
  scaleObj.position.y = assets.scale.size.y / 2;
  scale.add(scaleObj);
  scale.position.copy(SCALE_POS);
  scene.add(scale);

  return {
    trays,
    hits: trays.map((tray) => tray.hit),
    highlight,
    scale,
    platterY: COUNTER_Y + assets.scale.size.y,
  };
}
