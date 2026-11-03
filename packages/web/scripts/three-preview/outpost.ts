// Outpost map check, rendered headless (no dev server).
// ?mode=overview : the whole outpost from high up
// ?mode=meeting|specimen|greenhouse : the game's orthographic 3/4 camera there, with crew
import * as THREE from 'three';
import { buildCrew, buildFallen } from '../../src/game/three/crew3d';
import { buildOutpost, addNightLights, toScene } from '../../src/game/three/outpost3d';
import { setupRenderer, setupEnvironment, makePost } from '../../src/game/three/post';
const qs = new URLSearchParams(location.search);

const mode = new URLSearchParams(location.search).get('mode') ?? 'overview';
const W = innerWidth, H = innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
setupRenderer(renderer);
renderer.shadowMap.enabled = !qs.has('noshadow');
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
setupEnvironment(renderer, scene);
addNightLights(scene);
const outpost = buildOutpost();
scene.add(outpost.root);
outpost.update(2.0);

const focus: Record<string, [number, number]> = { meeting: [800, 600], specimen: [1260, 930], greenhouse: [320, 930], 'lab-a': [300, 260] };
const noCrew = new URLSearchParams(location.search).has('nocrew');
const only = qs.get('only');
const put = (seat: number, x: number, y: number, f: 'down' | 'up' | 'left' | 'right', walk: boolean, form: 'human' | 'parasite' = 'human') => {
  if (noCrew || (only !== null && +only !== seat)) return;
  const rig = buildCrew({ seat, skin: seat % 4, form });
  rig.root.position.copy(toScene(x, y));
  rig.setFacing(f, true);
  for (let k = 0; k < 12; k++) rig.update(k * 0.05, 0.05, walk);
  scene.add(rig.root);
};
put(0, 760, 560, 'down', false); put(2, 850, 580, 'left', true); put(5, 700, 650, 'right', true);
put(7, 900, 680, 'up', false); put(3, 1200, 900, 'right', true); put(8, 1330, 1000, 'left', false, 'parasite');
put(1, 260, 900, 'down', true); put(4, 400, 1000, 'up', false); put(6, 330, 300, 'down', false);
const body = buildFallen(9, 1);
body.position.copy(toScene(1180, 1010));
scene.add(body);

let cam: THREE.OrthographicCamera;
if (mode === 'overview') {
  const v = 40;
  cam = new THREE.OrthographicCamera(-v * W / H, v * W / H, v, -v, 0.1, 400);
  cam.position.set(0, 90, 50);
  cam.lookAt(0, 0, 2);
} else {
  const [fx, fy] = focus[mode] ?? [800, 600];
  const p = toScene(fx, fy);
  const v = 8.5;
  cam = new THREE.OrthographicCamera(-v * W / H, v * W / H, v, -v, 0.1, 200);
  cam.position.set(p.x, 14, p.z + 12);
  cam.lookAt(p.x, 0.6, p.z + 0.5);
}
if (qs.has('nopost')) renderer.render(scene, cam);
else {
  const post = makePost(renderer, scene, cam, W, H, 1);
  if (qs.has('noao')) post.composer.passes[1]!.enabled = false;
  if (qs.has('nobloom')) post.composer.passes[2]!.enabled = false;
  if (qs.has('nosmaa')) post.composer.passes[5]!.enabled = false;
  post.render();
}
if (qs.get('pick')) {
  // debug: name every mesh under a pixel, printed as a console error
  const [px, py] = qs.get('pick')!.split(',').map(Number);
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2((px! / W) * 2 - 1, -(py! / H) * 2 + 1), cam);
  for (const h of rc.intersectObjects(scene.children, true).slice(0, 6)) {
    const m = h.object as THREE.Mesh;
    console.error('pick', m.geometry?.type, (m.material as THREE.Material)?.type, ((m.material as THREE.MeshBasicMaterial)?.color)?.getHexString(), h.distance.toFixed(2), m.parent?.name, m.name);
  }
}
(window as unknown as { done: boolean }).done = true;
