import { animated, useSpring } from '@react-spring/three';
import { Edges, Line, PivotControls, Plane, Text } from '@react-three/drei';
import React, { Suspense, useMemo, useRef } from 'react';
import { Matrix4, Object3D, Vector3 } from 'three';
import { useIsToolpathHovered, useSetIsToolpathDragging, useStore, useToolDiameter, useMachineBounds } from '../store/store';
import { useCamMachine } from '@/cam/machine/camMachine';
import { LineAxesHelper } from './LineAxesHelper';
import { ToolpathCanvasPlane } from './ToolpathCanvasPlane';

// Save z position above stock (live cam) plane.
const kAboveStockZ = 500;

const AnimatedPlane = animated(Plane);

function ToolpathBackgroundPlane() {
  const isToolpathHovered = useIsToolpathHovered();
  const toolpath = useStore(s => s.toolpath);
  const { opacity } = useSpring({ opacity: isToolpathHovered ? 0.05 : 0.02 });
  const bounds = toolpath?.getBounds();
  const toolDiameter = useToolDiameter();
  // A CAM board shown: its outline (turned with it) is what's lined up, not the program's box square to the axes.
  const camBoard = useCamMachine(s => !!s.overlay);
  const boundingSize = useMemo(() => {
    if (!bounds) return null;
    const size = new Vector3();
    bounds.getSize(size);
    size.add(new Vector3(toolDiameter, toolDiameter, 0));
    return size;
  }, [bounds, toolDiameter]);

  if (!boundingSize || !bounds || camBoard) return null;

  return (
    <group>
      <AnimatedPlane
        args={[boundingSize.x, boundingSize.y]}
        position={[
          boundingSize.x / 2 + bounds.min.x - toolDiameter / 2,
          boundingSize.y / 2 + bounds.min.y - toolDiameter / 2,
          bounds.min.z,
        ]}
        material-color="white"
        material-transparent={true}
        material-opacity={opacity}>
        <Edges
          position={[0, 0, 0]}
          linewidth={1}
          color="white"
          depthTest={false}
          renderOrder={100}
          dashed
          dashSize={10}
          gapSize={10}
          visible={isToolpathHovered}
        />
      </AnimatedPlane>
    </group>
  );
}

function UseableMachineSpaceOutline() {
  const machineBounds = useMachineBounds();
  const corners = useMemo(() => {
    return [
      [machineBounds.min.x, machineBounds.min.y],
      [machineBounds.min.x, machineBounds.max.y],
      [machineBounds.max.x, machineBounds.max.y],
      [machineBounds.max.x, machineBounds.min.y],
      [machineBounds.min.x, machineBounds.min.y],
    ] as [number, number][];
  }, [machineBounds]);
  return <Line depthTest={false} renderOrder={1000} points={corners} color="#0cd20c" linewidth={1} dashed dashSize={5} gapSize={5} />;
}

function ToolpathPositionText() {
  const toolpathOffset = useStore(s => s.toolpathOffset);
  const isHovered = useIsToolpathHovered();
  if (!isHovered) return null;
  return (
    <Suspense fallback={null}>
      <Text
        position-z={100}
        position-x={-5}
        position-y={-5}
        rotation={[0, 0, -Math.PI / 2]}
        fontSize={10}
        color="white"
        outlineColor="black"
        outlineWidth={0.5}
        outlineBlur={0.5}
        anchorX="left"
        anchorY="top">
        {toolpathOffset.x.toFixed(2)}, {toolpathOffset.y.toFixed(2)}
      </Text>
    </Suspense>
  );
}

export const GCodeVisualizer: React.FC = () => {
  const toolpath = useStore(s => s.toolpath);
  const setIsToolpathSelected = useStore(s => s.setIsToolpathSelected);
  const setIsToolpathHovered = useStore(s => s.setIsToolpathHovered);

  const boundingSize = useMemo(() => {
    const size = new Vector3();
    const bounds = toolpath?.getBounds();
    if (!bounds) return null;
    bounds.getSize(size);
    return size;
  }, [toolpath]);

  if (!boundingSize) return null;

  return (
    <>
      <LineAxesHelper size={100} position-z={kAboveStockZ + 100} />
      <UseableMachineSpaceOutline />
      <ToolpathTransformControls>
        <group
          position-z={kAboveStockZ}
          onPointerMissed={e => e.type === 'click' && setIsToolpathSelected(false)}
          onClick={e => {
            e.stopPropagation();
            setIsToolpathSelected(true);
          }}
          onPointerEnter={() => setIsToolpathHovered(true)}
          onPointerLeave={() => setIsToolpathHovered(false)}>
          <ToolpathCanvasPlane />
          <ToolpathBackgroundPlane />
          <ToolpathPositionText />
        </group>
      </ToolpathTransformControls>
    </>
  );
};

function ToolpathTransformControls({ children }: { children: React.ReactElement<Object3D> }) {
  const toolpathOffset = useStore(s => s.toolpathOffset);
  const matrix = useRef<Matrix4>(new Matrix4());
  matrix.current.makeTranslation(toolpathOffset.x, toolpathOffset.y, 0);

  const setIsToolpathDragging = useSetIsToolpathDragging();
  const setToolpathOffset = useStore(s => s.setToolpathOffset);
  const isToolpathHovered = useIsToolpathHovered();
  const camBoard = useCamMachine(s => !!s.overlay);
  function onDrag(l: Matrix4, deltaL: Matrix4, w: Matrix4) {
    setToolpathOffset(new Vector3().setFromMatrixPosition(w));
  }
  // A CAM board shown: it's moved by dragging the board itself (`CamBedLayer`). The arrows would lie on its edges,
  // over the clamps there.
  if (camBoard) return <group position={[toolpathOffset.x, toolpathOffset.y, 0]}>{children}</group>;
  return (
    <PivotControls
      matrix={matrix.current}
      autoTransform={false}
      depthTest={false}
      disableScaling
      disableRotations
      lineWidth={1}
      visible={isToolpathHovered}
      scale={100}
      activeAxes={[true, true, false]}
      onDrag={onDrag}
      onDragStart={() => setIsToolpathDragging(true)}
      onDragEnd={() => setIsToolpathDragging(false)}>
      {children}
    </PivotControls>
  );
}
