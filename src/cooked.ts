import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Piece } from './bowl';

/* The finished bowl: a gold two-handled pot, the chosen broth, and everything cooked. */

const R = 0.155; // inner radius at the rim, metres
const POT_H = 0.088;
const BASE_R = 0.128;

interface SoupStyle {
  broth: number;
  edge: number;
  oil: number;
  /** 0 = no oil slick, 1 = heavy chili oil. */
  oilAmount: number;
  opacity: number;
  /** Broth level as a fraction of pot height. */
  level: number;
  /** How strongly the broth stains the ingredients. */
  coat: number;
  flecks: Array<{ color: number; count: number; size: number }>;
  sesame: boolean;
  garnish: 'cilantro' | 'scallion' | 'both';
  extras?: 'tomato' | 'goji' | 'peanut' | 'lime';
}

const SOUP_STYLES: Record<string, SoupStyle> = {
  'House Special Spicy': {
    broth: 0xd8561f, edge: 0xa8320f, oil: 0xc0260c, oilAmount: 0.7, opacity: 0.9, level: 0.62, coat: 0.32,
    flecks: [{ color: 0x8f1606, count: 260, size: 2.2 }, { color: 0x4a2a14, count: 40, size: 2.4 }],
    sesame: true, garnish: 'both',
  },
  'Bone Broth': {
    broth: 0xf1e6cf, edge: 0xd9c7a2, oil: 0xf0c66a, oilAmount: 0.35, opacity: 0.94, level: 0.62, coat: 0.06,
    flecks: [{ color: 0x6f9a3a, count: 40, size: 3 }, { color: 0x3a3a30, count: 30, size: 1.4 }],
    sesame: false, garnish: 'scallion',
  },
  Tomato: {
    broth: 0xe5481f, edge: 0xb8300f, oil: 0xf06a2a, oilAmount: 0.4, opacity: 0.95, level: 0.6, coat: 0.3,
    flecks: [{ color: 0xc82810, count: 120, size: 4 }],
    sesame: true, garnish: 'both', extras: 'tomato',
  },
  'Tom Yum': {
    broth: 0xe98a32, edge: 0xc2581c, oil: 0xd8401a, oilAmount: 0.55, opacity: 0.86, level: 0.62, coat: 0.22,
    flecks: [{ color: 0xb02a10, count: 140, size: 2 }, { color: 0x5f8f2e, count: 50, size: 3.4 }],
    sesame: false, garnish: 'cilantro', extras: 'lime',
  },
  'Szechuan Mala': {
    broth: 0xa82410, edge: 0x6e1408, oil: 0x9e1206, oilAmount: 1, opacity: 0.9, level: 0.62, coat: 0.4,
    flecks: [{ color: 0x5a0c04, count: 380, size: 2.4 }, { color: 0x3a2214, count: 90, size: 2.8 }],
    sesame: true, garnish: 'both', extras: 'peanut',
  },
  Curry: {
    broth: 0xe3a22c, edge: 0xc07a18, oil: 0xd8781a, oilAmount: 0.4, opacity: 0.97, level: 0.6, coat: 0.3,
    flecks: [{ color: 0x9a5a14, count: 80, size: 1.6 }],
    sesame: false, garnish: 'cilantro',
  },
  'Herbal Mushroom': {
    broth: 0x9c6c3a, edge: 0x6a4420, oil: 0xd8a050, oilAmount: 0.3, opacity: 0.82, level: 0.64, coat: 0.16,
    flecks: [{ color: 0x4a2a12, count: 60, size: 2 }],
    sesame: false, garnish: 'scallion', extras: 'goji',
  },
  'Dry Mix Mala': {
    broth: 0xa52a10, edge: 0x6a1406, oil: 0x8e1406, oilAmount: 1, opacity: 1, level: 0.16, coat: 0.5,
    flecks: [{ color: 0x5a0c04, count: 420, size: 2.6 }, { color: 0x3a2214, count: 120, size: 3 }],
    sesame: true, garnish: 'both', extras: 'peanut',
  },
};

/** Ingredient-specific cooking colour shift (multiplied into the model's own colours). */
const COOK_TINT: Record<string, number> = {
  'beef-slice': 0x9c7c6c,
  'lamb-roll-slice': 0xa88676,
  'fatty-beef-slice': 0xa88a7c,
  'pork-belly-slice': 0xe2cab8,
  'chicken-slice': 0xf4e6d4,
  shrimp: 0xffa47c,
  'pork-blood-curd': 0x8c6c6c,
  'bok-choy': 0xc4d8a4,
  'napa-cabbage': 0xe0e6c0,
  spinach: 0xa8c08c,
  'bean-sprouts': 0xeee6c8,
  'snow-peas': 0xb8d49a,
  broccoli: 0xb0cc90,
};
const WILT = new Set(['bok-choy', 'napa-cabbage', 'spinach', 'bean-sprouts', 'snow-peas']);
const NOODLES: Record<string, { color: number; radius: number; strands: number; wave: number; opacity: number; length: number }> = {
  'instant-noodle-block': { color: 0xf2d28a, radius: 0.0024, strands: 70, wave: 1, opacity: 1, length: 0.3 },
  'glass-noodles': { color: 0xeee8de, radius: 0.0016, strands: 70, wave: 0.15, opacity: 0.75, length: 0.34 },
  'udon-noodles': { color: 0xf8f2e2, radius: 0.0055, strands: 26, wave: 0.05, opacity: 1, length: 0.28 },
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function canvasTexture(size: number, paint: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  paint(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

const css = (hex: number, alpha = 1) => {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${alpha})`;
};

function soupTexture(style: SoupStyle) {
  return canvasTexture(1024, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.05, s / 2, s / 2, s / 2);
    g.addColorStop(0, css(style.broth));
    g.addColorStop(0.75, css(style.broth));
    g.addColorStop(1, css(style.edge));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    // Oil slick: pools and beads, each with a bright meniscus.
    const beads = Math.round(70 + style.oilAmount * 260);
    for (let i = 0; i < beads; i += 1) {
      const r = Math.random() < 0.15 ? rand(14, 40) * style.oilAmount + 6 : rand(2.5, 11);
      const x = rand(0, s);
      const y = rand(0, s);
      ctx.fillStyle = css(style.oil, rand(0.45, 0.85));
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * rand(0.7, 1), rand(0, Math.PI), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,240,210,0.45)';
      ctx.lineWidth = Math.max(1, r * 0.12);
      ctx.beginPath();
      ctx.arc(x - r * 0.15, y - r * 0.15, r * 0.7, Math.PI * 1.05, Math.PI * 1.6);
      ctx.stroke();
    }
    for (const fleck of style.flecks) {
      ctx.fillStyle = css(fleck.color, 0.9);
      for (let i = 0; i < fleck.count; i += 1) {
        ctx.beginPath();
        ctx.ellipse(rand(0, s), rand(0, s), fleck.size * rand(0.6, 1.4), fleck.size * rand(0.4, 1), rand(0, Math.PI), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
}

function steamTexture() {
  return canvasTexture(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

function potGeometry(): THREE.LatheGeometry {
  const rimR = R + 0.006;
  const pts = [
    [0, 0],
    [BASE_R - 0.008, 0],
    [BASE_R + 0.002, 0.004],
    [rimR + 0.004, POT_H - 0.006],
    [rimR + 0.006, POT_H - 0.001],
    [rimR + 0.003, POT_H + 0.002],
    [rimR - 0.001, POT_H],
    [R, POT_H - 0.004],
    [BASE_R - 0.006, 0.007],
    [BASE_R - 0.016, 0.004],
    [0, 0.004],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 96);
}

function handleGeometry(): THREE.BufferGeometry {
  const inner = R - 0.004;
  const reach = 0.072;
  const half = 0.058;
  const cr = 0.014;
  const roundRect = (x0: number, x1: number, h: number, c: number) => {
    const shape = new THREE.Shape();
    shape.moveTo(x0, -h + c);
    shape.lineTo(x0, h - c);
    shape.quadraticCurveTo(x0, h, x0 + c, h);
    shape.lineTo(x1 - c, h);
    shape.quadraticCurveTo(x1, h, x1, h - c);
    shape.lineTo(x1, -h + c);
    shape.quadraticCurveTo(x1, -h, x1 - c, -h);
    shape.lineTo(x0 + c, -h);
    shape.quadraticCurveTo(x0, -h, x0, -h + c);
    return shape;
  };
  const outer = roundRect(inner, inner + reach, half, cr);
  const t = 0.0055;
  outer.holes.push(roundRect(inner + t, inner + reach - t, half - t, cr - t * 0.6));
  const geometry = new THREE.ExtrudeGeometry(outer, { depth: 0.013, bevelEnabled: true, bevelSize: 0.0012, bevelThickness: 0.0012, bevelSegments: 2, curveSegments: 10 });
  // Shape lies in XY; turn it so the loop is horizontal and the band stands 13 mm tall.
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, POT_H - 0.006, 0);
  return geometry;
}

interface Steam {
  sprite: THREE.Sprite;
  age: number;
  life: number;
  x: number;
  z: number;
}

export class CookedPot {
  readonly group = new THREE.Group();
  /** Spins slowly so the bowl can be admired from every side. */
  readonly turntable = new THREE.Group();
  private readonly contents = new THREE.Group();
  private readonly gold: THREE.MeshStandardMaterial;
  private readonly soupMaterial: THREE.MeshStandardMaterial;
  private readonly soup: THREE.Mesh;
  private readonly steam: Steam[] = [];
  private readonly materialCache = new Map<string, THREE.Material>();
  private soupName = '';
  /** Fainter, smaller steam (posterised steam reads as blobs in the pixel version). */
  softSteam = false;

  constructor() {
    this.gold = new THREE.MeshStandardMaterial({ color: 0xd7b06a, metalness: 1, roughness: 0.27 });
    const pot = new THREE.Mesh(potGeometry(), this.gold);
    pot.castShadow = true;
    pot.receiveShadow = true;
    const handles = handleGeometry();
    const left = new THREE.Mesh(handles, this.gold);
    const right = new THREE.Mesh(handles, this.gold);
    right.rotation.y = Math.PI;
    left.castShadow = right.castShadow = true;

    this.soupMaterial = new THREE.MeshStandardMaterial({ roughness: 0.14, metalness: 0, transparent: true, depthWrite: false });
    this.soup = new THREE.Mesh(new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2), this.soupMaterial);
    this.soup.renderOrder = 2;
    this.soup.receiveShadow = true;

    const steamMap = steamTexture();
    for (let i = 0; i < 14; i += 1) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamMap, transparent: true, depthWrite: false, opacity: 0 }));
      sprite.renderOrder = 3;
      this.steam.push({ sprite, age: Math.random() * 3, life: rand(2.4, 3.6), x: 0, z: 0 });
      this.group.add(sprite);
    }

    this.turntable.add(pot, left, right, this.soup, this.contents);
    this.group.add(this.turntable);
    this.group.visible = false;
  }

  get title() {
    return this.soupName;
  }

  get radius() {
    return R + 0.075;
  }

  private cookMaterial(source: THREE.Material, tint: THREE.Color): THREE.Material {
    const key = `${source.uuid}:${tint.getHexString()}`;
    const cached = this.materialCache.get(key);
    if (cached) return cached;
    const material = (source as THREE.MeshStandardMaterial).clone();
    if ('color' in material) material.color.multiply(tint);
    if ('roughness' in material) material.roughness = Math.min(material.roughness, 0.45);
    this.materialCache.set(key, material);
    return material;
  }

  clear() {
    this.contents.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh && mesh.userData.ownGeometry) mesh.geometry.dispose();
    });
    this.contents.clear();
  }

  /** Cook every piece from the customer's bowl into the pot with the chosen broth. */
  build(pieces: Piece[], soupName: string) {
    this.clear();
    this.soupName = soupName;
    const style = SOUP_STYLES[soupName] ?? SOUP_STYLES['House Special Spicy'];
    const brothColor = new THREE.Color(style.broth);
    const surfaceY = POT_H * style.level;
    const radiusAt = (y: number) => BASE_R - 0.004 + ((R - BASE_R + 0.004) * y) / POT_H;

    this.soupMaterial.map?.dispose();
    this.soupMaterial.map = soupTexture(style);
    this.soupMaterial.opacity = style.opacity;
    this.soupMaterial.transparent = style.opacity < 1;
    this.soupMaterial.depthWrite = style.opacity >= 1;
    this.soupMaterial.needsUpdate = true;
    const sr = radiusAt(surfaceY) - 0.001;
    this.soup.scale.set(sr, 1, sr);
    this.soup.position.y = surfaceY;
    // Dry mix sits as a tossed heap above a shallow glaze; soups float everything at the surface.
    const pileY = Math.max(surfaceY, POT_H * 0.45);

    // Height field over the pot so ingredients heap on top of each other.
    const GRID = 26;
    const cell = (i: number) => ((i + 0.5) / GRID - 0.5) * 2 * R;
    // The broth and noodle bed below the surface is the floor everything rests on.
    const field = new Float32Array(GRID * GRID).fill(pileY - 0.014);
    const span = (c: number, half: number) => [
      Math.max(0, Math.floor(((c - half) / (2 * R) + 0.5) * GRID)),
      Math.min(GRID - 1, Math.floor(((c + half) / (2 * R) + 0.5) * GRID)),
    ];
    /** Highest point under an axis-aligned footprint (pieces rest on it, never inside it). */
    const support = (x: number, z: number, hx: number, hz: number) => {
      const [x0, x1] = span(x, hx);
      const [z0, z1] = span(z, hz);
      let top = -Infinity;
      for (let iz = z0; iz <= z1; iz += 1) for (let ix = x0; ix <= x1; ix += 1) top = Math.max(top, field[iz * GRID + ix]);
      return top;
    };
    const stampRect = (x: number, z: number, hx: number, hz: number, top: number) => {
      const [x0, x1] = span(x, hx);
      const [z0, z1] = span(z, hz);
      for (let iz = z0; iz <= z1; iz += 1) {
        for (let ix = x0; ix <= x1; ix += 1) field[iz * GRID + ix] = Math.max(field[iz * GRID + ix], top);
      }
    };
    const stamp = (x: number, z: number, fp: number, top: number) => stampRect(x, z, fp, fp, top);

    // Noodles first: a tangled bed just under and across the surface.
    const noodlePieces = pieces.filter((p) => NOODLES[p.item.key]);
    const others = pieces.filter((p) => !NOODLES[p.item.key]);
    const strandGeoms = new Map<string, THREE.BufferGeometry[]>();
    let strandBudget = 320;
    for (const piece of noodlePieces) {
      const spec = NOODLES[piece.item.key];
      const list = strandGeoms.get(piece.item.key) ?? [];
      for (let s = 0; s < spec.strands && strandBudget > 0; s += 1, strandBudget -= 1) {
        const reach = R * 0.86;
        let x = rand(-reach, reach) * 0.7;
        let z = rand(-reach, reach) * 0.7;
        let heading = rand(0, Math.PI * 2);
        const pts: THREE.Vector3[] = [];
        const steps = 30;
        const stepLen = spec.length / steps;
        for (let i = 0; i <= steps; i += 1) {
          heading += rand(-0.3, 0.3) + Math.sin(i * 1.9) * 0.55 * spec.wave;
          x += Math.cos(heading) * stepLen;
          z += Math.sin(heading) * stepLen;
          const r = Math.hypot(x, z);
          if (r > reach) {
            x *= reach / r;
            z *= reach / r;
            heading += Math.PI * 0.6;
          }
          const crinkle = Math.sin(i * 2.9) * 0.003 * spec.wave;
          pts.push(new THREE.Vector3(x + crinkle, pileY + rand(-0.004, 0.0035), z - crinkle));
        }
        const curve = new THREE.CatmullRomCurve3(pts);
        list.push(new THREE.TubeGeometry(curve, steps * 3, spec.radius, 5, false));
        // Noodles lift whatever lands on them a little.
        pts.forEach((p) => stamp(p.x, p.z, spec.radius + 0.003, pileY + 0.004 + spec.radius * 2));
      }
      strandGeoms.set(piece.item.key, list);
    }
    for (const [key, list] of strandGeoms) {
      if (list.length === 0) continue;
      const spec = NOODLES[key];
      const color = new THREE.Color(spec.color).lerp(brothColor, style.coat * 0.6);
      const merged = mergeGeometries(list);
      list.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(
        merged,
        new THREE.MeshStandardMaterial({ color, roughness: 0.32, transparent: spec.opacity < 1, opacity: spec.opacity }),
      );
      mesh.userData.ownGeometry = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.contents.add(mesh);
    }

    // Everything else is grouped by ingredient into wedges, like a plated malatang.
    const groups = new Map<string, Piece[]>();
    for (const piece of others) {
      const list = groups.get(piece.item.key) ?? [];
      list.push(piece);
      groups.set(piece.item.key, list);
    }
    const ordered = [...groups.values()].sort((a, b) => b.length - a.length);
    const total = Math.max(1, others.length);
    let angle = rand(0, Math.PI * 2);
    const white = new THREE.Color(0xffffff);
    for (const list of ordered) {
      const wedge = (list.length / total) * Math.PI * 2;
      const key = list[0].item.key;
      const tint = new THREE.Color(COOK_TINT[key] ?? 0xf4ebe0).multiply(white.clone().lerp(brothColor, style.coat));
      for (const piece of list) {
        const object = piece.object.clone();
        object.position.set(0, 0, 0);
        object.scale.setScalar(1);
        object.rotation.set(rand(-0.18, 0.18), rand(0, Math.PI * 2), rand(-0.18, 0.18), 'YXZ');
        // Cooking shrinks everything a little; leafy greens wilt flat.
        if (WILT.has(key)) object.scale.set(0.82, 0.5, 0.82);
        else object.scale.setScalar(0.88);
        object.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.material = Array.isArray(mesh.material)
            ? mesh.material.map((m) => this.cookMaterial(m, tint))
            : this.cookMaterial(mesh.material, tint);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        });
        object.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(object, true);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        const hx = size.x / 2;
        const hz = size.z / 2;
        const corner = Math.hypot(hx, hz);

        let best: { x: number; z: number; y: number } | null = null;
        for (let i = 0; i < 40; i += 1) {
          // Mostly inside this ingredient's wedge; anywhere in the pot once the wedge is heaped.
          const a = i < 12 ? angle + rand(0.08, 0.92) * wedge : rand(0, Math.PI * 2);
          const r = Math.sqrt(Math.random()) * (R - 0.004);
          const x = Math.cos(a) * r;
          const z = Math.sin(a) * r;
          // Nestle a third of the way into whatever is below, but never under the broth bed.
          const y = Math.max(pileY - 0.014, support(x, z, hx, hz) - size.y * 0.35);
          // The whole footprint must clear the flared wall at the height it would rest at.
          if (r + corner > radiusAt(Math.min(y, POT_H)) - 0.004) continue;
          if (!best || y + size.y < best.y + size.y) best = { x, z, y };
        }
        // A heap may crown just above the rim; anything that would go higher stays submerged
        // under the broth and noodles instead of stacking into a tower.
        if (!best || best.y + size.y > POT_H + 0.06) continue;
        object.position.set(best.x - centre.x, best.y - box.min.y, best.z - centre.z);
        stampRect(best.x, best.z, hx, hz, best.y + size.y);
        this.contents.add(object);
      }
      angle += wedge;
    }

    // Garnish heaped in the middle, on top of everything.
    let crown = pileY;
    for (let i = 0; i < field.length; i += 1) {
      const ix = i % GRID;
      const iz = Math.floor(i / GRID);
      if (Math.hypot(cell(ix), cell(iz)) < R * 0.3) crown = Math.max(crown, field[i]);
    }
    crown = Math.min(crown, POT_H + 0.05);
    this.addGarnish(style, crown, pileY, field, cell, GRID);
  }

  private addGarnish(
    style: SoupStyle,
    crown: number,
    surfaceY: number,
    field: Float32Array,
    cell: (i: number) => number,
    grid: number,
  ) {
    const topAt = (x: number, z: number) => {
      const ix = Math.min(grid - 1, Math.max(0, Math.floor((x / (2 * R) + 0.5) * grid)));
      const iz = Math.min(grid - 1, Math.max(0, Math.floor((z / (2 * R) + 0.5) * grid)));
      return Math.max(surfaceY, field[iz * grid + ix]);
    };
    void cell;
    const dummy = new THREE.Object3D();
    const addInstanced = (
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      count: number,
      place: (i: number, d: THREE.Object3D) => void,
      colors?: (i: number) => THREE.Color,
    ) => {
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      for (let i = 0; i < count; i += 1) {
        place(i, dummy);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        if (colors) mesh.setColorAt(i, colors(i));
      }
      mesh.userData.ownGeometry = true;
      mesh.castShadow = true;
      this.contents.add(mesh);
      return mesh;
    };

    if (style.garnish !== 'scallion') {
      // Chopped cilantro: little three-lobed leaves in a loose mound.
      const leaf = new THREE.Shape();
      leaf.moveTo(0, 0);
      leaf.bezierCurveTo(-0.004, 0.002, -0.007, 0.008, -0.003, 0.011);
      leaf.bezierCurveTo(-0.002, 0.014, 0.002, 0.014, 0.003, 0.011);
      leaf.bezierCurveTo(0.007, 0.008, 0.004, 0.002, 0, 0);
      const leafGeom = new THREE.ShapeGeometry(leaf, 4).rotateX(-Math.PI / 2);
      const greens = [0x3c8a2c, 0x4f9e36, 0x2f7424, 0x5aa83e].map((c) => new THREE.Color(c));
      addInstanced(
        leafGeom,
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide }),
        110,
        (i, d) => {
          const r = Math.sqrt(Math.random()) * 0.042;
          const a = Math.random() * Math.PI * 2;
          d.position.set(Math.cos(a) * r, crown + 0.006 + (0.042 - r) * 0.35 + rand(0, 0.006), Math.sin(a) * r);
          d.rotation.set(rand(-0.6, 0.6), rand(0, Math.PI * 2), rand(-0.6, 0.6));
          d.scale.setScalar(rand(0.8, 1.3));
          void i;
        },
        (i) => greens[i % greens.length],
      );
    }
    if (style.garnish !== 'cilantro') {
      // Sliced scallion rings.
      const ring = new THREE.TorusGeometry(0.0042, 0.0012, 5, 14).rotateX(Math.PI / 2);
      const shades = [0xe8f2d0, 0xcfe6a8, 0x8cc060].map((c) => new THREE.Color(c));
      addInstanced(
        ring,
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }),
        26,
        (i, d) => {
          const r = Math.sqrt(Math.random()) * 0.035 + 0.008;
          const a = Math.random() * Math.PI * 2;
          d.position.set(Math.cos(a) * r, crown + 0.012 + rand(0, 0.006), Math.sin(a) * r);
          d.rotation.set(rand(-0.4, 0.4), 0, rand(-0.4, 0.4));
          d.scale.set(1, rand(1.2, 2.2), 1);
          void i;
        },
        (i) => shades[i % shades.length],
      );
    }
    if (style.sesame) {
      const seed = new THREE.SphereGeometry(0.0014, 6, 4).scale(1, 0.45, 1.7);
      addInstanced(seed, new THREE.MeshStandardMaterial({ color: 0xf6ead0, roughness: 0.5 }), 160, (_i, d) => {
        const r = Math.sqrt(Math.random()) * R * 0.9;
        const a = Math.random() * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        d.position.set(x, topAt(x, z) + 0.002, z);
        d.rotation.set(0, rand(0, Math.PI * 2), 0);
        d.scale.setScalar(1);
      });
    }
    if (style.extras) {
      const extra = {
        tomato: { geom: new THREE.BoxGeometry(0.014, 0.01, 0.012), color: 0xe0381c, count: 18, rough: 0.35 },
        goji: { geom: new THREE.SphereGeometry(0.004, 8, 6).scale(1, 0.8, 1.7), color: 0xd8301c, count: 22, rough: 0.3 },
        peanut: { geom: new THREE.SphereGeometry(0.0045, 8, 6).scale(1, 0.75, 1.35), color: 0xb87a40, count: 26, rough: 0.55 },
        lime: { geom: new THREE.CylinderGeometry(0.012, 0.012, 0.003, 18, 1, false, 0, Math.PI), color: 0x9cc850, count: 3, rough: 0.4 },
      }[style.extras];
      addInstanced(extra.geom, new THREE.MeshStandardMaterial({ color: extra.color, roughness: extra.rough }), extra.count, (_i, d) => {
        const r = rand(0.3, 0.9) * R * 0.88;
        const a = Math.random() * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        d.position.set(x, topAt(x, z) + 0.002, z);
        d.rotation.set(rand(-0.4, 0.4), rand(0, Math.PI * 2), rand(-0.4, 0.4));
        d.scale.setScalar(rand(0.8, 1.2));
      });
    }
  }

  /** Steam rises and the broth slowly swirls. */
  update(dt: number) {
    this.turntable.rotation.y += dt * 0.12;
    const map = this.soupMaterial.map;
    if (map) {
      map.center.set(0.5, 0.5);
      map.rotation += dt * 0.02;
    }
    const wet = this.soupName !== 'Dry Mix Mala';
    for (const puff of this.steam) {
      puff.age += dt;
      if (puff.age >= puff.life) {
        puff.age = 0;
        puff.life = rand(2.4, 3.6);
        const r = Math.sqrt(Math.random()) * R * 0.75;
        const a = Math.random() * Math.PI * 2;
        puff.x = Math.cos(a) * r;
        puff.z = Math.sin(a) * r;
      }
      const k = puff.age / puff.life;
      puff.sprite.position.set(puff.x + Math.sin(k * 5 + puff.life) * 0.015, POT_H + 0.02 + k * 0.32, puff.z);
      puff.sprite.scale.setScalar(this.softSteam ? 0.04 + k * 0.07 : 0.07 + k * 0.16);
      (puff.sprite.material as THREE.SpriteMaterial).opacity =
        Math.sin(Math.PI * k) * (wet ? 0.32 : 0.16) * (this.softSteam ? 0.45 : 1);
    }
  }
}
