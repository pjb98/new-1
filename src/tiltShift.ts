import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

/**
 * Tilt-shift: blurs the top and bottom of the frame while keeping a sharp
 * horizontal band, which reads as a "miniature / diorama." Two 9-tap gaussian
 * passes (horizontal + vertical); the vertical pass also adds a soft vignette.
 * This is the single biggest lever for the cozy toy look.
 */
const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 direction;   // texel step along the blur axis (in UV units)
  uniform float focus;      // screen-y center of the sharp band (0..1)
  uniform float band;       // half-height of the sharp region
  uniform float strength;   // max blur, in texels
  uniform float vignette;   // 0 = off
  uniform float saturation; // 1 = unchanged; >1 = punchier colors
  uniform float warmth;     // gentle warm color grade (0 = off)
  varying vec2 vUv;

  void main() {
    float d = abs(vUv.y - focus);
    float blur = clamp((d - band) / band, 0.0, 1.0);
    blur = pow(blur, 1.4) * strength;
    vec2 off = direction * blur;

    vec4 c  = texture2D(tDiffuse, vUv) * 0.227027;
    c += texture2D(tDiffuse, vUv + off * 1.0) * 0.1945946;
    c += texture2D(tDiffuse, vUv - off * 1.0) * 0.1945946;
    c += texture2D(tDiffuse, vUv + off * 2.0) * 0.1216216;
    c += texture2D(tDiffuse, vUv - off * 2.0) * 0.1216216;
    c += texture2D(tDiffuse, vUv + off * 3.0) * 0.0540541;
    c += texture2D(tDiffuse, vUv - off * 3.0) * 0.0540541;
    c += texture2D(tDiffuse, vUv + off * 4.0) * 0.0162162;
    c += texture2D(tDiffuse, vUv - off * 4.0) * 0.0162162;

    // Color grade (applied once, on the vertical pass): lift saturation for the
    // punchy, cheerful toy-diorama palette and nudge the highlights warm.
    if (saturation != 1.0) {
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, saturation);
    }
    if (warmth > 0.0) {
      c.rgb += warmth * vec3(0.025, 0.012, -0.02);
    }

    if (vignette > 0.0) {
      vec2 q = vUv - 0.5;
      float v = smoothstep(0.9, 0.34, length(q));
      c.rgb *= mix(1.0, v, vignette);
    }
    gl_FragColor = c;
  }
`;

function makePass(
  direction: THREE.Vector2,
  vignette: number,
  focus: number,
  band: number,
  strength: number,
  saturation: number,
  warmth: number,
) {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      direction: { value: direction },
      focus: { value: focus },
      band: { value: band },
      strength: { value: strength },
      vignette: { value: vignette },
      saturation: { value: saturation },
      warmth: { value: warmth },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
}

export class TiltShift {
  readonly horizontal: ShaderPass;
  readonly vertical: ShaderPass;

  constructor(
    width: number,
    height: number,
    opts: { focus?: number; band?: number; strength?: number; vignette?: number; saturation?: number; warmth?: number } = {},
  ) {
    const focus = opts.focus ?? 0.56;
    const band = opts.band ?? 0.16;
    const strength = opts.strength ?? 4.0;
    const vignette = opts.vignette ?? 0.45;
    const saturation = opts.saturation ?? 1.0;
    const warmth = opts.warmth ?? 0.0;
    // Grade (saturation/warmth) is applied once, on the vertical (final) pass.
    this.horizontal = makePass(new THREE.Vector2(1 / width, 0), 0, focus, band, strength, 1.0, 0.0);
    this.vertical = makePass(new THREE.Vector2(0, 1 / height), vignette, focus, band, strength, saturation, warmth);
  }

  setSize(width: number, height: number) {
    (this.horizontal.uniforms.direction.value as THREE.Vector2).set(1 / width, 0);
    (this.vertical.uniforms.direction.value as THREE.Vector2).set(0, 1 / height);
  }

  /** Live-adjust the max blur (texels). Used to ease off the diorama defocus when
   *  the player zooms the camera in close, so magnified views stay crisp. */
  setStrength(strength: number) {
    this.horizontal.uniforms.strength.value = strength;
    this.vertical.uniforms.strength.value = strength;
  }
}
