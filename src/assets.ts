import * as THREE from 'three';
import { createMintGltfLoader } from './gltf-runtime';
import { ALL, EQUIPMENT, modelUrl, type Ingredient } from './ingredients';

/** A loaded model, re-centred on its bounding-box centre and scaled to real size. */
export interface Proto {
  /** Template object; clone it (geometry and materials are shared). */
  object: THREE.Group;
  /** The single source mesh, for instancing. */
  mesh: THREE.Mesh;
  /** Transform of `mesh` relative to `object`. */
  meshMatrix: THREE.Matrix4;
  /** Bounding-box size after normalisation, metres. */
  size: THREE.Vector3;
  /** Low-poly geometry (same node transform and UVs) for instanced piles. */
  lodGeometry?: THREE.BufferGeometry;
}

export interface NormalizeOptions {
  /** Target length of the longest dimension, metres. */
  longest: number;
  /** Rotate so the thinnest axis is vertical and the longest runs along X. */
  layFlat: boolean;
}

function findMesh(root: THREE.Object3D): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  root.traverse((child) => {
    if (!found && (child as THREE.Mesh).isMesh) found = child as THREE.Mesh;
  });
  if (!found) throw new Error('Model has no mesh');
  return found;
}

export function normalize(scene: THREE.Object3D, options: NormalizeOptions): Proto {
  const pivot = new THREE.Group();
  pivot.add(scene);
  scene.updateMatrixWorld(true);

  const dims = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());

  if (options.layFlat) {
    const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
    const thin = axes.reduce((a, b) => (dims[a] <= dims[b] ? a : b));
    if (thin === 'x') pivot.rotation.z = Math.PI / 2;
    else if (thin === 'z') pivot.rotation.x = Math.PI / 2;
    pivot.updateMatrixWorld(true);
    const flat = new THREE.Box3().setFromObject(pivot).getSize(new THREE.Vector3());
    if (flat.z > flat.x) {
      // Spin about the (now vertical) thin axis so the long side runs along X.
      const spin = new THREE.Group();
      spin.add(pivot);
      spin.rotation.y = Math.PI / 2;
      spin.updateMatrixWorld(true);
      return finish(spin, options.longest);
    }
  }
  return finish(pivot, options.longest);
}

function finish(inner: THREE.Object3D, longest: number): Proto {
  const object = new THREE.Group();
  object.add(inner);
  inner.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  const dims = box.getSize(new THREE.Vector3());
  const scale = longest / Math.max(dims.x, dims.y, dims.z);
  const centre = box.getCenter(new THREE.Vector3());
  inner.scale.multiplyScalar(scale);
  inner.position.sub(centre.multiplyScalar(scale));
  object.updateMatrixWorld(true);

  const mesh = findMesh(object);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return {
    object,
    mesh,
    meshMatrix: mesh.matrixWorld.clone(),
    size: dims.multiplyScalar(scale),
  };
}

export interface Assets {
  food: Map<string, Proto>;
  bowl: Proto;
  tongs: Proto;
  scale: Proto;
}

export const BOWL_DIAMETER = 0.34;

export async function loadAssets(onProgress: (done: number, total: number) => void): Promise<Assets> {
  const loader = createMintGltfLoader();
  const total = ALL.length + 3;
  let done = 0;
  const load = async (key: string, options: NormalizeOptions) => {
    const gltf = await loader.loadAsync(modelUrl(key));
    done += 1;
    onProgress(done, total);
    return normalize(gltf.scene, options);
  };

  const foodEntries = ALL.map(async (item: Ingredient) => {
    const [proto, lod] = await Promise.all([
      load(item.key, { longest: item.size, layFlat: !item.upright }),
      loader.loadAsync(modelUrl(item.key, 'lod')),
    ]);
    proto.lodGeometry = findMesh(lod.scene).geometry;
    return [item.key, proto] as const;
  });
  const [food, bowl, tongs, scale] = await Promise.all([
    Promise.all(foodEntries),
    load(EQUIPMENT.bowl, { longest: BOWL_DIAMETER, layFlat: false }),
    load(EQUIPMENT.tongs, { longest: 0.27, layFlat: true }),
    load(EQUIPMENT.scale, { longest: 0.36, layFlat: false }),
  ]);
  return { food: new Map(food), bowl, tongs, scale };
}
