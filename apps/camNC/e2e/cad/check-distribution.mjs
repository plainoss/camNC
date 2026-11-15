import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const applicationLicensePath = fileURLToPath(new URL('../../../../LICENSE', import.meta.url));
const defaultDist = fileURLToPath(new URL('../../dist/', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function archivePaths(bytes) {
  const tar = gunzipSync(bytes);
  const paths = [];
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString().replace(/\0.*$/, '');
    if (!name) break;
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/, '').trim(), 8) || 0;
    paths.push(name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return paths;
}

async function wasmFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? wasmFiles(target) : entry.name.endsWith('.wasm') ? [target] : [];
  }));
  return nested.flat();
}

/** Each separately shipped LGPL WebAssembly library, with its canonical notices and the source files its archive must hold. */
const components = [
  {
    id: 'planegcs',
    name: 'PlaneGCS',
    owner: 'cad',
    wasm: ['@salusoft89/planegcs', 'dist/planegcs_dist/planegcs.wasm'],
    sourceFiles: ['planegcs/GCS.cpp', 'planegcs/Constraints.cpp', 'planegcs/CMakeLists.txt', 'build-bindings/process_all.sh', 'sketch/gcs_wrapper.ts', 'planegcs_dist/gcs_system.ts', 'Dockerfile', 'LICENSE'],
  },
  {
    id: 'occt-import-js',
    name: 'occt-import-js',
    owner: 'cam',
    wasm: ['occt-import-js', 'dist/occt-import-js.wasm'],
    sourceFiles: ['occt-import-js/src/importer-step.cpp', 'occt-import-js/src/js-interface.cpp', 'CMakeLists.txt', '.gitmodules', 'tools/build_wasm_win_release.bat', 'LICENSE.md'],
  },
];

async function verifyComponent(distDir, component, distributedHashes) {
  const packageDir = fileURLToPath(new URL(`../../../../packages/${component.owner}/`, import.meta.url));
  const canonicalDir = path.join(packageDir, 'licenses');
  const shipped = path.join(distDir, 'licenses', component.id);
  const manifestBytes = await readFile(path.join(canonicalDir, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  assert.deepEqual(await readFile(path.join(shipped, 'manifest.json')), manifestBytes, `Distribution ${component.name} license manifest is stale`);
  assert.deepEqual(await readFile(path.join(shipped, 'THIRD_PARTY_NOTICES.md')), await readFile(path.join(packageDir, 'THIRD_PARTY_NOTICES.md')), `Distribution ${component.name} notice is missing or stale`);
  for (const [filename, expectedHash] of Object.entries(manifest.files)) {
    assert.equal(sha256(await readFile(path.join(canonicalDir, filename))), expectedHash, `Canonical checksum mismatch: ${filename}`);
    assert.equal(sha256(await readFile(path.join(shipped, filename))), expectedHash, `Distribution checksum mismatch: ${filename}`);
  }
  const source = await readFile(path.join(shipped, manifest.sourceArchive));
  assert.equal(sha256(source), manifest.sourceArchiveSha256, `${component.name} corresponding source archive is stale`);
  const members = archivePaths(source);
  for (const required of component.sourceFiles) {
    assert(members.includes(`${component.id}-${manifest.version}/${required}`), `${component.name} corresponding source is incomplete: ${required}`);
  }
  const [packageName, wasmPath] = component.wasm;
  const require = createRequire(path.join(packageDir, 'package.json'));
  const installedWasm = path.join(path.dirname(require.resolve(`${packageName}/package.json`)), wasmPath);
  assert.equal(sha256(await readFile(installedWasm)), manifest.wasmSha256, `Installed ${component.name} changed: update provenance and licenses`);
  assert(distributedHashes.includes(manifest.wasmSha256), `Built distribution is missing the licensed ${component.name} WASM binary`);
  return { version: manifest.version, sourceFiles: members.length, licensedWasm: manifest.wasmSha256 };
}

/** Validate the actual deployable directory, rather than just repository notices. */
export async function verifyDistribution(distDir = defaultDist) {
  assert.deepEqual(await readFile(path.join(distDir, 'licenses/camNC-Apache-2.0.txt')), await readFile(applicationLicensePath), 'Distribution application license is missing or stale');
  const distributedHashes = await Promise.all((await wasmFiles(distDir)).map(async file => sha256(await readFile(file))));
  const result = {};
  for (const component of components) result[component.id] = await verifyComponent(distDir, component, distributedHashes);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyDistribution(process.argv[2] ? path.resolve(process.argv[2]) : defaultDist);
  const summary = components.map(({ id, name }) => `${name} ${result[id].version} (${result[id].sourceFiles} source files)`);
  console.log(`Distribution licenses verified: ${summary.join(', ')}`);
}
