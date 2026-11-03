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

export interface Post {
  composer: EffectComposer;
  render(): void;
  setSize(w: number, h: number): void;
}

/** `aoScale` < 1 runs AO at reduced resolution for laptops. */
export function makePost(r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.Camera, w: number, h: number, aoScale = 0.5): Post {
  const composer = new EffectComposer(r);
  composer.addPass(new RenderPass(scene, cam));
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
    render: () => composer.render(),
    setSize: (W, H) => composer.setSize(W, H),
  };
}
