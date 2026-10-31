// Renderer + post stack: scene -> bloom -> tone map -> final grade pass.
// The final pass does colour grading, a black & white mode that keeps reds
// (the underside), tilt-shift, grain, vignette, and two transitions:
// op-art rings (Beach House) and digi-cut slices (McGloughlin).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.045 },
    uSat: { value: 1.0 },
    uContrast: { value: 1.04 },
    uBW: { value: 0 },
    uLift: { value: new THREE.Vector3(0.0, 0.0, 0.0) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uTilt: { value: 0.6 },
    uOp: { value: 0 },
    uSlice: { value: 0 },
    uFade: { value: 0 },
    uFadeColor: { value: new THREE.Color('#f7efe6') },
    uFlash: { value: 0 },
    uAberr: { value: 0.0012 },
    uHue: { value: 0 },
    uWarp: { value: 0 },
    uInvert: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform float uTime, uVignette, uGrain, uSat, uContrast, uBW, uTilt, uOp, uSlice, uFade, uFlash, uAberr, uHue, uWarp, uInvert;
    vec3 hueRotate(vec3 c, float a) {
      const mat3 toY = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
      const mat3 toR = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
      vec3 yiq = toY * c;
      float s = sin(a), co = cos(a);
      yiq.yz = mat2(co, s, -s, co) * yiq.yz;
      return toR * yiq;
    }
    uniform vec3 uLift, uGain, uFadeColor;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float aaStep(float ph) { float s = sin(ph * 6.2831853); float w = fwidth(ph) * 6.2831853 + 1e-4; return smoothstep(-w, w, s); }
    vec3 tap(vec2 uv) {
      vec2 c = uv - 0.5;
      float a = uAberr * (1.0 + uSlice * 6.0 + uOp * 4.0);
      return vec3(
        texture2D(tDiffuse, uv + c * a).r,
        texture2D(tDiffuse, uv).g,
        texture2D(tDiffuse, uv - c * a).b);
    }
    void main() {
      vec2 uv = vUv;
      // stretchy warp (Beach House-ish), strongest toward the edges
      if (uWarp > 0.001) {
        vec2 c = uv - 0.5;
        float e = 0.35 + dot(c, c) * 2.5;
        uv.x += sin(uv.y * 9.0 + uTime * 1.1) * uWarp * 0.012 * e;
        uv.y += sin(uv.x * 7.0 - uTime * 0.9) * uWarp * 0.009 * e;
      }
      // digi-cut: horizontal strata sliding sideways
      if (uSlice > 0.001) {
        float bands = 18.0 + 30.0 * uSlice;
        float b = floor(uv.y * bands);
        float h = hash(vec2(b, floor(uTime * 8.0) * 0.0 + 3.0));
        float h2 = hash(vec2(b, 7.0));
        uv.x += (h - 0.5) * uSlice * uSlice * 0.6 + sin(uTime * 3.0 + h2 * 20.0) * uSlice * 0.03;
        uv.x = fract(uv.x);
      }
      // tilt-shift blur toward top and bottom
      float blur = smoothstep(0.18, 0.5, abs(uv.y - 0.5)) * uTilt;
      vec3 col = tap(uv);
      if (blur > 0.01) {
        vec2 px = blur * 2.4 / uRes;
        vec3 acc = col;
        acc += tap(uv + px * vec2(1.0, 0.0));
        acc += tap(uv + px * vec2(-1.0, 0.0));
        acc += tap(uv + px * vec2(0.0, 1.0));
        acc += tap(uv + px * vec2(0.0, -1.0));
        acc += tap(uv + px * vec2(0.7, 0.7) * 1.6);
        acc += tap(uv + px * vec2(-0.7, 0.7) * 1.6);
        acc += tap(uv + px * vec2(0.7, -0.7) * 1.6);
        acc += tap(uv + px * vec2(-0.7, -0.7) * 1.6);
        col = acc / 9.0;
      }
      // grade
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      float red = smoothstep(0.4, 0.55, col.r - max(col.g, col.b)) * smoothstep(0.3, 0.5, col.r);
      vec3 bw = vec3(l);
      bw = (bw - 0.5) * 1.25 + 0.5;
      col = mix(col, bw, uBW * (1.0 - red));
      l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSat);
      col = (col - 0.5) * uContrast + 0.5;
      col = col * uGain + uLift;
      if (abs(uHue) > 0.001) col = hueRotate(col, uHue);
      if (uInvert > 0.001) {
        vec3 inv = vec3(1.0) - col;
        inv = hueRotate(inv, 3.14159);   // invert brightness, keep the hues roughly where they were
        col = mix(col, inv, uInvert * (1.0 - red));
      }
      // op-art transition: stretchy black and white rings
      if (uOp > 0.001) {
        vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
        float r = length(p);
        float a = atan(p.y, p.x);
        float ph = r * (10.0 + 16.0 * uOp) - uTime * 1.6 + sin(a * 4.0 + uTime * 0.8) * 0.5 * uOp + sin(r * 8.0 - uTime) * 0.3;
        float ring = aaStep(ph);
        vec3 op = vec3(mix(0.03, 0.95, ring));
        float m = smoothstep(0.0, 1.0, uOp * 1.6 - r * 0.6);
        col = mix(col, op, clamp(m, 0.0, 1.0));
      }
      // vignette
      vec2 q = vUv - 0.5;
      col *= 1.0 - uVignette * smoothstep(0.25, 0.85, length(q * vec2(1.1, 1.0)));
      // grain
      float n = hash(vUv * uRes + fract(uTime * 13.7) * 100.0) - 0.5;
      col += n * uGrain;
      col += uFlash;
      col = mix(col, uFadeColor, uFade);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export class Renderer {
  constructor(canvas) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.localClippingEnabled = true;
    this.renderer = r;
    this.pixelRatio = r.getPixelRatio();
    const w = window.innerWidth, h = window.innerHeight;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(null, null);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.32, 0.65, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.u = this.final.uniforms;
    this.resize(w, h);
  }

  resize(w, h) {
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
    this.u.uRes.value.set(w * this.pixelRatio, h * this.pixelRatio);
  }

  setPixelRatio(pr) {
    if (Math.abs(pr - this.pixelRatio) < 0.01) return;
    this.pixelRatio = pr;
    this.resize(window.innerWidth, window.innerHeight);
  }

  render(scene, camera, t) {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.u.uTime.value = t;
    this.composer.render();
  }
}
