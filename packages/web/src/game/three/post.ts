/**
 * The look pipeline shared by the game and the previews: ACES tone mapping,
 * a dim PMREM room environment (so metal and glass reflect), exponential
 * fog, and a composer with GTAO, selective bloom (only HDR emissives above
 * 1.0 glow: lamps, screens, fireflies, toxic green), vignette and SMAA.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

export const NIGHT = 0x07161a;

export function setupRenderer(r: THREE.WebGLRenderer): void {
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.05;
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
}

export function setupEnvironment(r: THREE.WebGLRenderer, scene: THREE.Scene): void {
  const pm = new THREE.PMREMGenerator(r);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.3; // night: reflections, not fill
  pm.dispose();
  scene.background = new THREE.Color(NIGHT);
  scene.fog = new THREE.FogExp2(NIGHT, 0.012);
}

const Vignette = {
  uniforms: { tDiffuse: { value: null }, uK: { value: 0.42 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uK; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = (vUv - 0.5) * vec2(1.25, 1.0);
      c.rgb *= 1.0 - uK * smoothstep(0.22, 0.78, length(d));
      gl_FragColor = c;
    }`,
};

/**
 * Sinks everything the player cannot see into dark fog. Rebuilds each pixel's
 * world position from the scene depth and looks it up in the top-down sight
 * mask (vision.ts), so walls, crew and props darken by where they stand, not
 * by where they land on screen. Runs on linear HDR before AO and bloom, so
 * lamps out of sight stop blooming too.
 */
export class VisionPass extends Pass {
  readonly uniforms = {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    tMask: { value: null as THREE.Texture | null },
    uRect: { value: new THREE.Vector4() },
    uProjInv: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uMe: { value: new THREE.Vector2() },
    uRange: { value: 20 },
    uTexel: { value: new THREE.Vector2(1 / 512, 1 / 384) },
    uFog: { value: new THREE.Color(NIGHT) }, // hex is converted to linear on construction
  };
  private quad: FullScreenQuad;
  constructor(private cam: THREE.Camera) {
    super();
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse, tDepth, tMask; uniform vec4 uRect; uniform mat4 uProjInv, uCamWorld;
        uniform vec2 uMe, uTexel; uniform float uRange; uniform vec3 uFog; varying vec2 vUv;
        float mask(vec2 uv){ return texture2D(tMask, uv).r; }
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          float d = texture2D(tDepth, vUv).x;
          vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
          vec3 wp = (uCamWorld * vec4(v.xyz / v.w, 1.0)).xyz;
          vec2 uv = (wp.xz - uRect.xy) / uRect.zw;
          // two rings of taps: a soft penumbra about one metre wide
          float m = mask(uv) * 0.2;
          for (int i = 0; i < 8; i++) {
            float a = float(i) * 0.785398;
            vec2 o = vec2(cos(a), sin(a)) * uTexel;
            m += mask(uv + o * 3.0) * 0.05 + mask(uv + o * 6.5) * 0.05;
          }
          float far = 1.0 - smoothstep(uRange * 0.72, uRange, length(wp.xz - uMe));
          float vis = d >= 1.0 ? 0.0 : smoothstep(0.0, 1.0, m) * far;
          gl_FragColor = vec4(mix(c.rgb * 0.03 + uFog * 0.8, c.rgb, vis), c.a);
        }`,
      depthTest: false,
      depthWrite: false,
    }));
  }
  render(r: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    const u = this.uniforms;
    u.tDiffuse.value = read.texture;
    u.tDepth.value = read.depthTexture;
    u.uProjInv.value.copy(this.cam.projectionMatrixInverse);
    u.uCamWorld.value.copy(this.cam.matrixWorld);
    r.setRenderTarget(this.renderToScreen ? null : write);
    this.quad.render(r);
  }
  dispose(): void {
    this.quad.dispose();
  }
}

export interface Post {
  composer: EffectComposer;
  /** Disabled until the scene turns it on; ghosts never get it. */
  vision: VisionPass;
  render(): void;
  setSize(w: number, h: number): void;
}

/** `aoScale` < 1 runs AO at reduced resolution for laptops. */
export function makePost(r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.Camera, w: number, h: number, aoScale = 0.5): Post {
  const composer = new EffectComposer(r);
  // the vision pass reads scene depth straight from whichever buffer RenderPass wrote
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) rt.depthTexture = new THREE.DepthTexture(rt.width, rt.height);
  composer.addPass(new RenderPass(scene, cam));
  const vision = new VisionPass(cam);
  vision.enabled = false;
  composer.addPass(vision);
  const ao = new GTAOPass(scene, cam, Math.round(w * aoScale), Math.round(h * aoScale));
  ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1.0 });
  ao.blendIntensity = 0.9;
  composer.addPass(ao);
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.6, 0.5, 1.0));
  composer.addPass(new OutputPass());
  composer.addPass(new ShaderPass(Vignette));
  composer.addPass(new SMAAPass());
  composer.setSize(w, h);
  return {
    composer,
    vision,
    render: () => composer.render(),
    setSize: (W, H) => composer.setSize(W, H),
  };
}
