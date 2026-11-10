import { Color, ShaderMaterial } from 'three';

/** Flat part color and a constant-size diagonal hatch, independent of model scale and scene lighting. */
export function sectionCapMaterial(color: string, opacity: number, pixelRatio: number) {
  const fill = new Color(color);
  const luminance = fill.r * 0.2126 + fill.g * 0.7152 + fill.b * 0.0722;
  const ink = fill.clone().lerp(new Color(luminance < 0.12 ? '#ffffff' : '#000000'), 0.55);
  const alpha = Math.max(0, Math.min(1, opacity));
  return new ShaderMaterial({
    name: 'Section cap hatch',
    uniforms: {
      fillColor: { value: fill },
      hatchColor: { value: ink },
      alpha: { value: alpha },
      pixelRatio: { value: pixelRatio },
    },
    vertexShader: /* glsl */ `
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 fillColor;
      uniform vec3 hatchColor;
      uniform float alpha;
      uniform float pixelRatio;
      void main() {
        float phase = (gl_FragCoord.x + gl_FragCoord.y) / pixelRatio;
        float distanceToLine = abs(mod(phase + 5.0, 10.0) - 5.0);
        float hatch = 1.0 - smoothstep(0.65, 1.25, distanceToLine);
        gl_FragColor = vec4(mix(fillColor, hatchColor, hatch), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    // Flat cut colors should not change with the renderer's exposure or scene lights.
    toneMapped: false,
    transparent: alpha < 1,
    opacity: alpha,
    depthTest: true,
    depthWrite: alpha >= 1,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}
