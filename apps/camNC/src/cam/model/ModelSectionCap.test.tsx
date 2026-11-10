import { Canvas, useThree, type RootState } from '@react-three/fiber';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BufferGeometry, Color, Matrix4, Mesh, MeshStandardMaterial, ShaderMaterial, Raycaster, Vector3, WebGLRenderTarget } from 'three';
import type { BodyMesh } from '../camTypes';
import { ModelBody } from './ModelBody';
import { ModelSectionCap } from './ModelSectionCap';

let state: RootState | null = null;
function Probe() {
  state = useThree();
  return null;
}
afterEach(() => {
  cleanup();
  state = null;
});

// A square ring with a real through-hole. Top vertices 0..7 lie on the section; 8..15 form its retained underside.
const capIndices = [0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
const retainedIndices = [
  // Outer walls.
  0, 8, 9, 0, 9, 1, 1, 9, 10, 1, 10, 2, 2, 10, 11, 2, 11, 3, 3, 11, 8, 3, 8, 0,
  // Through-hole walls.
  4, 5, 13, 4, 13, 12, 5, 6, 14, 5, 14, 13, 6, 7, 15, 6, 15, 14, 7, 4, 12, 7, 12, 15,
  // Underside, leaving the same hole open.
  13, 9, 8, 12, 13, 8, 14, 10, 9, 13, 14, 9, 15, 11, 10, 14, 15, 10, 12, 8, 11, 15, 12, 11,
];
const mesh: BodyMesh = {
  name: 'Sectioned ring',
  partId: 'ring',
  positions: new Float32Array([
    -2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0, -0.7, -0.7, 0, 0.7, -0.7, 0, 0.7, 0.7, 0, -0.7, 0.7, 0, -2, -2, -0.5, 2, -2, -0.5, 2, 2, -0.5,
    -2, 2, -0.5, -0.7, -0.7, -0.5, 0.7, -0.7, -0.5, 0.7, 0.7, -0.5, -0.7, 0.7, -0.5,
    // A retained triangle after the cap range detects accidentally coloring through the end of the index buffer.
    2.5, -0.2, 0, 2.9, -0.2, 0, 2.7, 0.2, 0,
  ]),
  indices: new Uint32Array([...retainedIndices, ...capIndices, 16, 17, 18]),
  flat: new Matrix4().toArray(),
};
const range = { start: retainedIndices.length, count: capIndices.length };

function View({
  matrix = new Matrix4(),
  color,
  opacity = 1,
  dpr = 1,
  sectioned = true,
  edges = false,
}: {
  matrix?: Matrix4;
  color?: string;
  opacity?: number;
  dpr?: number;
  sectioned?: boolean;
  edges?: boolean;
}) {
  return (
    <div style={{ width: 400, height: 300 }}>
      <Canvas dpr={dpr} orthographic camera={{ position: [0, 0, 5], zoom: 60, near: 0.1, far: 50 }}>
        <ambientLight intensity={1} />
        <directionalLight position={[0, 0, 5]} intensity={2} />
        <group name="combined-body">
          <ModelBody
            mesh={mesh}
            matrix={matrix}
            sectionCap={sectioned ? range : null}
            color={color ?? '#b8c0c9'}
            opacity={opacity}
            edges={edges}
            onSelect={() => {}}
            onHover={() => {}}
          />
        </group>
        <group name="section-color">
          {sectioned && <ModelSectionCap mesh={mesh} range={range} matrix={matrix} color={color} opacity={opacity} />}
        </group>
        <mesh name="behind-hole" position={[0, 0, -1]}>
          <planeGeometry args={[6, 4]} />
          <meshBasicMaterial color="#245bc3" />
        </mesh>
        <mesh name="foreground" position={[1.25, 0, 0.5]}>
          <planeGeometry args={[0.6, 1.2]} />
          <meshBasicMaterial color="#28a34b" />
        </mesh>
        <Probe />
      </Canvas>
    </div>
  );
}

async function readyBody() {
  await waitFor(() => {
    expect(state?.size.width).toBe(400);
    expect(state?.size.height).toBe(300);
    expect(state?.scene.getObjectByName('combined-body')?.children[0]).toBeInstanceOf(Mesh);
  });
  state!.scene.updateMatrixWorld(true);
  state!.camera.updateMatrixWorld(true);
  return state!.scene.getObjectByName('combined-body')!.children[0] as Mesh;
}

async function ready() {
  const body = await readyBody();
  await waitFor(() => expect(state?.scene.getObjectByName('section-color')?.children[0]).toBeInstanceOf(Mesh));
  const cap = state!.scene.getObjectByName('section-color')!.children[0] as Mesh;
  return { body, cap };
}

it('hatches precisely the cap index range with its source color and opaque depth-tested material', async () => {
  render(<View />);
  const { body, cap } = await ready();
  expect(Array.from(cap.geometry.index!.array)).toEqual(capIndices);
  expect(cap.geometry.index!.count).toBe(24);
  expect(cap.geometry.getAttribute('position').count).toBe(mesh.positions.length / 3);
  expect(body.geometry.getAttribute('position').count).toBe(mesh.indices.length);
  expect(cap.material).toBeInstanceOf(ShaderMaterial);
  const material = cap.material as ShaderMaterial;
  expect((material.uniforms.fillColor!.value as Color).getHexString()).toBe('b8c0c9');
  expect(material.uniforms.alpha!.value).toBe(1);
  expect(material.uniforms.pixelRatio!.value).toBe(1);
  expect(material.toneMapped).toBe(false);
  expect(material.depthTest).toBe(true);
  expect(material.depthWrite).toBe(true);
  expect(material.transparent).toBe(false);
  expect(material.polygonOffset).toBe(true);
  expect(material.polygonOffsetFactor).toBeLessThan(0);
  expect(material.polygonOffsetUnits).toBeLessThan(0);
});

function coordinates(geometry: BufferGeometry, names: string[]) {
  return names
    .flatMap(name => {
      const attribute = geometry.getAttribute(name);
      return Array.from({ length: attribute.count }, (_, index) =>
        [attribute.getX(index), attribute.getY(index), attribute.getZ(index)].join(',')
      );
    })
    .sort();
}

function edgeCoordinates(body: Mesh) {
  const edges = body.children.find(child => 'geometry' in child) as Mesh | undefined;
  return edges?.geometry.getAttribute('instanceStart') ? coordinates(edges.geometry, ['instanceStart', 'instanceEnd']) : [];
}

it('keeps every triangle and visible edge through off-on-off while hidden cap groups still raycast', async () => {
  const view = render(<View sectioned={false} edges />);
  let body = await readyBody();
  const positions = coordinates(body.geometry, ['position']);
  await waitFor(() => expect(edgeCoordinates(body).length).toBeGreaterThan(0));
  const edges = edgeCoordinates(body);
  expect(body.material).toBeInstanceOf(MeshStandardMaterial);
  expect(body.geometry.groups).toEqual([]);
  for (const sectioned of [true, false]) {
    view.rerender(<View sectioned={sectioned} edges />);
    body = await readyBody();
    expect(coordinates(body.geometry, ['position'])).toEqual(positions);
    expect(body.geometry.drawRange).toEqual({ start: 0, count: Infinity });
    await waitFor(() => expect(edgeCoordinates(body)).toEqual(edges));
    const hit = new Raycaster(new Vector3(-1.25, 0, 5), new Vector3(0, 0, -1)).intersectObject(body)[0]!;
    expect(hit.object).toBe(body);
    expect(hit.point.toArray()).toEqual([-1.25, 0, 0]);
    expect(hit.faceIndex).toBeGreaterThanOrEqual(range.start / 3);
    expect(hit.faceIndex).toBeLessThan((range.start + range.count) / 3);
    if (sectioned) {
      expect(body.geometry.groups).toEqual([
        { start: 0, count: range.start, materialIndex: 0 },
        { start: range.start, count: range.count, materialIndex: 1 },
        { start: range.start + range.count, count: 3, materialIndex: 0 },
      ]);
      expect(Array.isArray(body.material)).toBe(true);
      const materials = body.material as MeshStandardMaterial[];
      expect(materials[0]!.visible).toBe(true);
      expect(materials[1]!.visible).toBe(false);
      expect(hit.face!.materialIndex).toBe(1);
      const trailing = new Raycaster(new Vector3(2.7, 0, 5), new Vector3(0, 0, -1)).intersectObject(body)[0]!;
      expect(trailing.face!.materialIndex).toBe(0);
    } else {
      expect(body.material).toBeInstanceOf(MeshStandardMaterial);
      expect(body.geometry.groups).toEqual([]);
      expect(hit.face!.materialIndex).toBe(0);
    }
  }
});

it('updates source color and opacity without discarding the shared cap geometry', async () => {
  const view = render(<View />);
  const { cap } = await ready();
  const geometry = cap.geometry;
  const disposeGeometry = vi.spyOn(geometry, 'dispose');
  const oldMaterial = cap.material as ShaderMaterial;
  const disposeMaterial = vi.spyOn(oldMaterial, 'dispose');
  view.rerender(<View color="#237aa5" opacity={0.3} />);
  const updated = (await ready()).cap;
  const material = updated.material as ShaderMaterial;
  expect((material.uniforms.fillColor!.value as Color).getHexString()).toBe('237aa5');
  expect(material.uniforms.alpha!.value).toBe(0.3);
  expect(material.opacity).toBe(0.3);
  expect(material.transparent).toBe(true);
  expect(material.depthWrite).toBe(false);
  expect(material.depthTest).toBe(true);
  expect(updated.geometry).toBe(geometry);
  expect(disposeGeometry).not.toHaveBeenCalled();
  expect(disposeMaterial).toHaveBeenCalledOnce();
});

it('leaves real body geometry and the hole pickable while the color overlay never intercepts a hit', async () => {
  const view = render(<View />);
  let { body, cap } = await ready();
  const hits = new Raycaster(new Vector3(-1.25, 0, 5), new Vector3(0, 0, -1)).intersectObjects(state!.scene.children, true);
  expect(hits[0]!.object).toBe(body);
  expect(hits[0]!.point.toArray()).toEqual([-1.25, 0, 0]);
  expect(hits.every(hit => hit.object !== cap)).toBe(true);
  const holeHits = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1)).intersectObjects(state!.scene.children, true);
  expect(holeHits.length).toBeGreaterThan(0);
  expect(holeHits.every(hit => hit.object.name === 'behind-hole')).toBe(true);

  const matrix = new Matrix4().makeTranslation(4, 3, 2).multiply(new Matrix4().makeRotationY(0.4));
  view.rerender(<View matrix={matrix} />);
  ({ body, cap } = await ready());
  const point = new Vector3(-1.25, 0, 0).applyMatrix4(matrix);
  const normal = new Vector3(0, 0, 1).transformDirection(matrix);
  const transformedHits = new Raycaster(point.clone().addScaledVector(normal, 5), normal.clone().negate()).intersectObjects(
    state!.scene.children,
    true
  );
  expect(body.matrix.equals(matrix)).toBe(true);
  expect(cap.matrix.equals(matrix)).toBe(true);
  expect(transformedHits[0]!.object).toBe(body);
  expect(transformedHits[0]!.point.distanceTo(point)).toBeLessThan(1e-6);
  expect(transformedHits.every(hit => hit.object !== cap)).toBe(true);
});

it.each([1, 2])('renders a flat source-color diagonal hatch while retaining the hole and foreground occlusion (DPR%s)', async dpr => {
  render(<View dpr={dpr} />);
  await ready();
  const { gl, scene, camera } = state!;
  const target = new WebGLRenderTarget(128, 96);
  const previous = gl.getRenderTarget();
  try {
    gl.setRenderTarget(target);
    gl.clear();
    gl.render(scene, camera);
    const pixels = new Uint8Array(128 * 96 * 4);
    gl.readRenderTargetPixels(target, 0, 0, 128, 96, pixels);
    const at = (x: number, y: number) => Array.from(pixels.slice((y * 128 + x) * 4, (y * 128 + x) * 4 + 3));
    const projectedPixel = (point: Vector3) => {
      const projected = point.project(camera);
      return { x: Math.floor((projected.x + 1) * 64), y: Math.floor((projected.y + 1) * 48) };
    };
    const pixelAt = (point: Vector3) => {
      const { x, y } = projectedPixel(point);
      return at(x, y);
    };
    const center = projectedPixel(new Vector3(-1.25, 0, 0));
    const patch = Array.from({ length: 81 }, (_, index) => {
      const x = center.x + (index % 9) - 4,
        y = center.y + Math.floor(index / 9) - 4;
      const rgb = at(x, y);
      return { x, y, rgb, brightness: rgb.reduce((sum, value) => sum + value, 0) };
    });
    const darkest = patch.reduce((a, b) => (a.brightness < b.brightness ? a : b));
    const brightest = patch.reduce((a, b) => (a.brightness > b.brightness ? a : b));
    expect(brightest.brightness - darkest.brightness).toBeGreaterThan(90);
    // This render target uses a linear color space: the unlit fill should preserve the supplied sRGB source color.
    const source = new Color('#b8c0c9');
    const fill = [source.r, source.g, source.b].map(value => Math.round(value * 255));
    brightest.rgb.forEach((value, index) => expect(value).toBeCloseTo(fill[index]!, 0));
    // Constant diagonal phase and a period scaled by DPR prove a screen-space hatch instead of a flat fill.
    const diagonal = at(darkest.x + 1, darkest.y - 1);
    diagonal.forEach((value, index) => expect(value).toBeCloseTo(darkest.rgb[index]!, 0));
    const repeated = at(darkest.x, darkest.y + 10 * dpr);
    repeated.forEach((value, index) => expect(value).toBeCloseTo(darkest.rgb[index]!, 0));
    const hole = pixelAt(new Vector3(0, 0, 0));
    expect(hole[2]!).toBeGreaterThan(50);
    expect(hole[2]!).toBeGreaterThan(hole[0]! * 2);
    const covered = pixelAt(new Vector3(1.25, 0, 0));
    expect(covered[1]!).toBeGreaterThan(50);
    expect(covered[1]!).toBeGreaterThan(covered[0]! * 2);
    expect(covered[1]!).toBeGreaterThan(covered[2]! * 2);
  } finally {
    gl.setRenderTarget(previous);
    target.dispose();
  }
});

it('blends a translucent cut once over the background instead of adding a second body-cap layer', async () => {
  render(<View opacity={0.3} />);
  await ready();
  const { gl, scene, camera } = state!;
  const target = new WebGLRenderTarget(128, 96);
  const previous = gl.getRenderTarget();
  try {
    gl.setRenderTarget(target);
    gl.clear();
    gl.render(scene, camera);
    const pixels = new Uint8Array(128 * 96 * 4);
    gl.readRenderTargetPixels(target, 0, 0, 128, 96, pixels);
    const point = new Vector3(-1.25, 0, 0).project(camera);
    const center = { x: Math.floor((point.x + 1) * 64), y: Math.floor((point.y + 1) * 48) };
    const patch = Array.from({ length: 81 }, (_, index) => {
      const x = center.x + (index % 9) - 4,
        y = center.y + Math.floor(index / 9) - 4;
      return Array.from(pixels.slice((y * 128 + x) * 4, (y * 128 + x) * 4 + 3));
    });
    const fillPixel = patch.reduce((a, b) => (a.reduce((sum, value) => sum + value, 0) > b.reduce((sum, value) => sum + value, 0) ? a : b));
    const source = new Color('#b8c0c9'),
      background = new Color('#245bc3');
    const expected = source
      .clone()
      .multiplyScalar(0.3)
      .add(background.clone().multiplyScalar(0.7))
      .toArray()
      .map(value => Math.round(value * 255));
    fillPixel.forEach((value, index) => expect(Math.abs(value - expected[index]!)).toBeLessThanOrEqual(1));
    const double = source
      .clone()
      .multiplyScalar(0.51)
      .add(background.clone().multiplyScalar(0.49))
      .toArray()
      .map(value => Math.round(value * 255));
    expect(fillPixel.reduce((difference, value, index) => difference + Math.abs(value - double[index]!), 0)).toBeGreaterThan(20);
  } finally {
    gl.setRenderTarget(previous);
    target.dispose();
  }
});
