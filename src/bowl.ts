import * as THREE from 'three';
import type { Proto } from './assets';
import type { Ingredient } from './ingredients';

/** Grid cells a resting piece covers, with its underside and top in each (relative to its origin). */
interface Footprint {
  cells: Int32Array;
  bottom: Float32Array;
  top: Float32Array;
}

export interface Piece {
  item: Ingredient;
  grams: number;
  object: THREE.Object3D;
  /** Resting position of the object's origin, bowl-local. */
  rest: THREE.Vector3;
  footprint: Footprint;
}

const GRID = 40;
/** Cells whose inner surface is above this fraction of the bowl height are rim, not basin. */
const BASIN = 0.9;
/** Most a piece leans to follow the slope under it, radians. */
const MAX_LEAN = 0.75;
/** How far a heap may rise above the rim before the bowl counts as full, metres. */
const HEAP = 0.11;

const UP = new THREE.Vector3(0, 1, 0);

/**
 * The customer's bowl. Pieces are packed on a height field sampled from the real bowl mesh.
 * Every piece is rasterised into the same grid as its own underside/top profile, so it comes to
 * rest exactly where its underside first touches the bowl or the food below: nothing overlaps
 * and nothing passes through the bowl. Pieces lean with the slope beneath them, like food
 * sliding against the side of a real bowl.
 */
export class Bowl {
  readonly group = new THREE.Group();
  readonly pieces: Piece[] = [];
  readonly radius: number;
  readonly height: number;
  private readonly contents = new THREE.Group();
  /** Inner surface height per cell; NaN where the cell is rim or outside the bowl. */
  private readonly floor = new Float32Array(GRID * GRID);
  private readonly pile = new Float32Array(GRID * GRID);
  private readonly cell: number;
  private readonly vertexCache = new Map<Proto, Float32Array>();

  constructor(proto: Proto) {
    this.radius = Math.max(proto.size.x, proto.size.z) / 2;
    this.height = proto.size.y;
    this.cell = (2 * this.radius) / GRID;
    const shell = proto.object;
    shell.position.y = this.height / 2;
    this.group.add(shell, this.contents);
    this.sampleFloor(shell);
    this.resetPile();
  }

  private coord(i: number): number {
    return ((i + 0.5) / GRID - 0.5) * 2 * this.radius;
  }

  private index(x: number, z: number): number {
    const ix = Math.floor(x / this.cell + GRID / 2);
    const iz = Math.floor(z / this.cell + GRID / 2);
    if (ix < 0 || iz < 0 || ix >= GRID || iz >= GRID) return -1;
    return iz * GRID + ix;
  }

  /** Cast straight down onto the bowl model to find its inner surface under every cell. */
  private sampleFloor(shell: THREE.Object3D) {
    this.group.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    shell.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
    });
    // Hit whichever way the generated mesh's faces point.
    const restore = meshes.map((mesh) => {
      const material = mesh.material as THREE.Material;
      const side = material.side;
      material.side = THREE.DoubleSide;
      return () => (material.side = side);
    });
    const raycaster = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const from = new THREE.Vector3();
    const origin = this.group.position.clone();
    for (let iz = 0; iz < GRID; iz += 1) {
      for (let ix = 0; ix < GRID; ix += 1) {
        const x = this.coord(ix);
        const z = this.coord(iz);
        let y = Number.NaN;
        if (Math.hypot(x, z) < this.radius) {
          from.set(origin.x + x, origin.y + this.height + 0.5, origin.z + z);
          raycaster.set(from, down);
          const hit = raycaster.intersectObjects(meshes, false)[0];
          if (hit) {
            const local = hit.point.y - origin.y;
            if (local < this.height * BASIN) y = local;
          }
        }
        this.floor[iz * GRID + ix] = y;
      }
    }
    restore.forEach((undo) => undo());
  }

  private resetPile() {
    this.pile.set(this.floor);
  }

  /** Every vertex of a model, relative to its origin (cached per model). */
  private vertices(proto: Proto, object: THREE.Object3D): Float32Array {
    const cached = this.vertexCache.get(proto);
    if (cached) return cached;
    const saved = object.quaternion.clone();
    object.quaternion.identity();
    object.position.set(0, 0, 0);
    object.updateMatrixWorld(true);
    const out: number[] = [];
    const v = new THREE.Vector3();
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const pos = mesh.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i += 1) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        out.push(v.x, v.y, v.z);
      }
    });
    object.quaternion.copy(saved);
    const verts = new Float32Array(out);
    this.vertexCache.set(proto, verts);
    return verts;
  }

  /** Rasterise a rotated model at (x, z) into grid cells; null if any part leaves the basin. */
  private rasterise(verts: Float32Array, q: THREE.Quaternion, x: number, z: number): Footprint | null {
    const lo = new Map<number, number>();
    const hi = new Map<number, number>();
    const v = new THREE.Vector3();
    for (let i = 0; i < verts.length; i += 3) {
      v.set(verts[i], verts[i + 1], verts[i + 2]).applyQuaternion(q);
      const c = this.index(x + v.x, z + v.z);
      if (c < 0 || Number.isNaN(this.floor[c])) return null;
      const a = lo.get(c);
      if (a === undefined || v.y < a) lo.set(c, v.y);
      const b = hi.get(c);
      if (b === undefined || v.y > b) hi.set(c, v.y);
    }
    const cells = new Int32Array(lo.size);
    const bottom = new Float32Array(lo.size);
    const top = new Float32Array(lo.size);
    let k = 0;
    for (const [c, y] of lo) {
      cells[k] = c;
      bottom[k] = y;
      top[k] = hi.get(c)!;
      k += 1;
    }
    return { cells, bottom, top };
  }

  /** Origin height at which the footprint's underside first touches what is below. */
  private restHeight(fp: Footprint): number {
    let y = -Infinity;
    for (let k = 0; k < fp.cells.length; k += 1) y = Math.max(y, this.pile[fp.cells[k]] - fp.bottom[k]);
    return y;
  }

  private stamp(fp: Footprint, originY: number) {
    for (let k = 0; k < fp.cells.length; k += 1) {
      const c = fp.cells[k];
      this.pile[c] = Math.max(this.pile[c], originY + fp.top[k]);
    }
  }

  /** Surface tilt at (x, z): the normal of the current heap (or bowl) there. */
  private normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const d = this.cell * 2;
    const h = (px: number, pz: number) => {
      const c = this.index(px, pz);
      return c < 0 || Number.isNaN(this.pile[c]) ? Number.NaN : this.pile[c];
    };
    const c0 = h(x, z);
    const gx = (Number.isNaN(h(x + d, z)) ? c0 : h(x + d, z)) - (Number.isNaN(h(x - d, z)) ? c0 : h(x - d, z));
    const gz = (Number.isNaN(h(x, z + d)) ? c0 : h(x, z + d)) - (Number.isNaN(h(x, z - d)) ? c0 : h(x, z - d));
    out.set(-gx / (2 * d), 1, -gz / (2 * d));
    if (Number.isNaN(out.x) || Number.isNaN(out.z)) out.set(0, 1, 0);
    out.normalize();
    // Limit the lean.
    const angle = out.angleTo(UP);
    if (angle > MAX_LEAN) out.lerp(UP, 1 - MAX_LEAN / angle).normalize();
    return out;
  }

  /** Reserve a resting spot for a new piece; null when the bowl is heaped full. */
  add(item: Ingredient, proto: Proto, grams: number): Piece | null {
    const object = proto.object.clone();
    const verts = this.vertices(proto, object);
    const reach = this.radius * 0.85;
    const normal = new THREE.Vector3();
    const lean = new THREE.Quaternion();
    const spin = new THREE.Quaternion();
    const wobble = new THREE.Euler();
    let best: { q: THREE.Quaternion; fp: Footprint; x: number; z: number; y: number; score: number } | null = null;

    for (let i = 0; i < 40; i += 1) {
      const r = reach * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const c = this.index(x, z);
      if (c < 0 || Number.isNaN(this.floor[c])) continue;
      // Lie with the slope beneath, any way round, with a little randomness.
      this.normalAt(x, z, normal);
      lean.setFromUnitVectors(UP, normal);
      wobble.set((Math.random() - 0.5) * 0.2, 0, (Math.random() - 0.5) * 0.2);
      spin.setFromAxisAngle(UP, Math.random() * Math.PI * 2);
      const q = lean.clone().multiply(spin).multiply(new THREE.Quaternion().setFromEuler(wobble));
      const fp = this.rasterise(verts, q, x, z);
      if (!fp) continue;
      const y = this.restHeight(fp);
      let peak = -Infinity;
      for (let k = 0; k < fp.top.length; k += 1) peak = Math.max(peak, y + fp.top[k]);
      if (peak > this.height + HEAP) continue;
      // Prefer the lowest resting spot, with a slight pull to the middle so the heap mounds.
      const score = peak + r * 0.05;
      if (!best || score < best.score) best = { q, fp, x, z, y, score };
    }
    if (!best) return null;

    object.quaternion.copy(best.q);
    const piece: Piece = {
      item,
      grams,
      object,
      rest: new THREE.Vector3(best.x, best.y, best.z),
      footprint: best.fp,
    };
    this.stamp(best.fp, best.y);
    this.pieces.push(piece);
    return piece;
  }

  /** Parent a piece to the bowl once its drop animation starts. */
  attach(piece: Piece) {
    this.contents.attach(piece.object);
  }

  remove(piece: Piece) {
    const i = this.pieces.indexOf(piece);
    if (i < 0) return;
    this.pieces.splice(i, 1);
    this.contents.remove(piece.object);
    // Everything above settles back down, in the order it went in.
    this.resetPile();
    for (const p of this.pieces) {
      p.rest.y = this.restHeight(p.footprint);
      this.stamp(p.footprint, p.rest.y);
    }
  }

  clear() {
    this.pieces.length = 0;
    this.contents.clear();
    this.resetPile();
  }

  get totalGrams(): number {
    return this.pieces.reduce((sum, piece) => sum + piece.grams, 0);
  }

  pieceFromObject(object: THREE.Object3D): Piece | undefined {
    let node: THREE.Object3D | null = object;
    while (node) {
      const hit = this.pieces.find((piece) => piece.object === node);
      if (hit) return hit;
      node = node.parent;
    }
    return undefined;
  }

  get pickTargets(): THREE.Object3D[] {
    return this.pieces.map((piece) => piece.object);
  }
}
