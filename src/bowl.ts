import * as THREE from 'three';
import type { Proto } from './assets';
import type { Ingredient } from './ingredients';

export interface Piece {
  item: Ingredient;
  grams: number;
  object: THREE.Object3D;
  /** Resting position, bowl-local. */
  rest: THREE.Vector3;
  footprint: number;
  halfHeight: number;
}

const GRID = 19;

/** The customer's bowl plus a height-field pile of everything dropped into it. */
export class Bowl {
  readonly group = new THREE.Group();
  readonly pieces: Piece[] = [];
  readonly radius: number;
  readonly height: number;
  private readonly contents = new THREE.Group();
  private readonly pile = new Float32Array(GRID * GRID);

  constructor(proto: Proto) {
    this.radius = Math.max(proto.size.x, proto.size.z) / 2;
    this.height = proto.size.y;
    const shell = proto.object;
    shell.position.y = this.height / 2;
    this.group.add(shell, this.contents);
    this.resetPile();
  }

  /** Inner surface height at distance r from the bowl axis. */
  private floor(r: number): number {
    const k = Math.min(1, r / (this.radius * 0.97));
    return this.height * 0.07 + this.height * 0.93 * (1 - Math.sqrt(1 - k * k));
  }

  private cellCoord(i: number): number {
    return ((i + 0.5) / GRID - 0.5) * 2 * this.radius;
  }

  private resetPile() {
    for (let iz = 0; iz < GRID; iz += 1) {
      for (let ix = 0; ix < GRID; ix += 1) {
        this.pile[iz * GRID + ix] = this.floor(Math.hypot(this.cellCoord(ix), this.cellCoord(iz)));
      }
    }
  }

  private surface(x: number, z: number, footprint: number): number {
    let top = -Infinity;
    for (let iz = 0; iz < GRID; iz += 1) {
      for (let ix = 0; ix < GRID; ix += 1) {
        const d = Math.hypot(this.cellCoord(ix) - x, this.cellCoord(iz) - z);
        if (d <= footprint) top = Math.max(top, this.pile[iz * GRID + ix]);
      }
    }
    if (top === -Infinity) top = this.floor(Math.hypot(x, z));
    return top;
  }

  private stamp(x: number, z: number, footprint: number, top: number) {
    for (let iz = 0; iz < GRID; iz += 1) {
      for (let ix = 0; ix < GRID; ix += 1) {
        const d = Math.hypot(this.cellCoord(ix) - x, this.cellCoord(iz) - z);
        if (d <= footprint) {
          const i = iz * GRID + ix;
          this.pile[i] = Math.max(this.pile[i], top);
        }
      }
    }
  }

  private settle(piece: Piece) {
    const base = this.surface(piece.rest.x, piece.rest.z, piece.footprint);
    piece.rest.y = base + piece.halfHeight * 0.8;
    this.stamp(piece.rest.x, piece.rest.z, piece.footprint, piece.rest.y + piece.halfHeight * 0.55);
  }

  /** Reserve a resting spot for a new piece; null when the bowl is heaped full. */
  add(item: Ingredient, proto: Proto, grams: number): Piece | null {
    const size = proto.size;
    const footprint = Math.max(0.012, ((size.x + size.z) / 2) * 0.36);
    const halfHeight = size.y / 2 + footprint * 0.12;
    const reach = Math.max(0.01, this.radius * 0.8 - footprint * 0.7);

    let best: { x: number; z: number; y: number } | null = null;
    for (let i = 0; i < 9; i += 1) {
      const r = reach * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = this.surface(x, z, footprint);
      if (!best || y < best.y) best = { x, z, y };
    }
    if (!best || best.y + halfHeight * 2 > this.height + 0.075) return null;

    const object = proto.object.clone();
    object.rotation.set((Math.random() - 0.5) * 0.7, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.7, 'YXZ');
    const piece: Piece = {
      item,
      grams,
      object,
      rest: new THREE.Vector3(best.x, 0, best.z),
      footprint,
      halfHeight,
    };
    this.settle(piece);
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
    this.resetPile();
    this.pieces.forEach((p) => this.settle(p));
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
