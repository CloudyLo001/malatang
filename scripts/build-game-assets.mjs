// Derives runtime variants from the Mint GLBs in public/assets/mint:
//   public/assets/game/<key>/model.glb  full mesh, textures resized for the game camera
//   public/assets/game/<key>/lod.glb    geometry-only low-poly mesh for instanced tray piles
// Run: node scripts/build-game-assets.mjs
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const SRC = 'public/assets/mint';
const OUT = 'public/assets/game';
const EQUIPMENT = new Set(['hot-pot-bowl', 'serving-tongs', 'digital-scale']);
const LOD_TRIS = 340;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
});
await MeshoptSimplifier.ready;

const dropDraco = (doc) =>
  doc.getRoot().listExtensionsUsed().filter((e) => e.extensionName === 'KHR_draco_mesh_compression').forEach((e) => e.dispose());
const tris = (doc) =>
  doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((n, p) => n + p.getIndices().getCount() / 3, 0);

for (const key of readdirSync(SRC)) {
  const big = EQUIPMENT.has(key);
  const doc = await io.read(`${SRC}/${key}/optimized_glb.glb`);
  dropDraco(doc);
  const compress = (slots, size, quality) =>
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots, resize: [size, size], quality });
  await doc.transform(
    compress(/^baseColorTexture$/, 1024, 86),
    compress(/^normalTexture$/, big ? 1024 : 512, 90),
    compress(/^(metallicRoughnessTexture|occlusionTexture)$/, 512, 82),
  );
  mkdirSync(`${OUT}/${key}`, { recursive: true });
  await io.write(`${OUT}/${key}/model.glb`, doc);
  let line = `${key.padEnd(24)} model ${tris(doc)} tris ${(statSync(`${OUT}/${key}/model.glb`).size / 1024) | 0}KB`;

  if (!big) {
    const full = tris(doc);
    await doc.transform(
      weld(),
      simplify({ simplifier: MeshoptSimplifier, ratio: LOD_TRIS / full, error: 0.4, lockBorder: false }),
    );
    // Meshes made of many loose pieces (shrimp legs, enoki stems) barely simplify; collapse them sloppily.
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const indices = prim.getIndices();
        if (indices.getCount() / 3 <= LOD_TRIS * 1.4) continue;
        const positions = prim.getAttribute('POSITION').getArray();
        const [sloppy] = MeshoptSimplifier.simplifySloppy(
          new Uint32Array(indices.getArray()),
          positions instanceof Float32Array ? positions : new Float32Array(positions),
          3,
          null,
          LOD_TRIS * 3,
          0.2,
        );
        indices.setArray(new Uint32Array(sloppy));
      }
    }
    for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) prim.setMaterial(null);
    await doc.transform(prune());
    await io.write(`${OUT}/${key}/lod.glb`, doc);
    line += ` | lod ${tris(doc)} tris ${(statSync(`${OUT}/${key}/lod.glb`).size / 1024) | 0}KB`;
  }
  console.log(line);
}
