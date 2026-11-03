// Crew turnaround + in-game camera check, rendered headless (no dev server).
// ?mode=sheet : 12 characters x 4 views (front, three-quarter, side, back)
// ?mode=game  : the game's orthographic 3/4 camera, lineup on a jungle-night floor
import * as THREE from 'three';
import { buildCrew, buildFallen, type CrewLook } from '../../src/game/three/crew3d';
import { setupRenderer, setupEnvironment } from '../../src/game/three/post';

const mode = new URLSearchParams(location.search).get('mode') ?? 'sheet';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
setupRenderer(renderer);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
setupEnvironment(renderer, scene);
scene.fog = null;
scene.background = new THREE.Color(0x0c2224);
scene.add(new THREE.HemisphereLight(0xcfe9e6, 0x142a28, 1.0));
const key = new THREE.DirectionalLight(0xffe2b8, 2.3);
key.position.set(-3, 5, 4);
scene.add(key);
const rim = new THREE.DirectionalLight(0x6ee8dc, 1.6);
rim.position.set(3, 0.5, -3);
scene.add(rim);

const looks: CrewLook[] = [];
for (let s = 0; s < 10; s++) looks.push({ seat: s, skin: s % 4, form: 'human' });
looks.push({ seat: 8, skin: 0, form: 'infected' }, { seat: 8, skin: 0, form: 'parasite' });

if (mode === 'sheet') {
  const n = looks.length, cw = 150, ch = 210, W = cw * n, H = ch * 4;
  renderer.setSize(W, H);
  renderer.setScissorTest(true);
  const views = [0, -Math.PI / 5, -Math.PI / 2, Math.PI];
  looks.forEach((lk, i) => {
    const rig = buildCrew(lk);
    rig.update(1.3, 0.016, false);
    scene.add(rig.root);
    views.forEach((yaw, r) => {
      rig.root.rotation.y = -yaw;
      const cam = new THREE.PerspectiveCamera(26, cw / ch, 0.1, 50);
      cam.position.set(0, 1.5, 6.4);
      cam.lookAt(0, 1.12, 0);
      const y = H - (r + 1) * ch;
      renderer.setViewport(i * cw, y, cw, ch);
      renderer.setScissor(i * cw, y, cw, ch);
      renderer.render(scene, cam);
    });
    scene.remove(rig.root);
  });
} else {
  const W = 1280, H = 720;
  renderer.setSize(W, H);
  // floor: dark teal deck plates
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), new THREE.MeshStandardMaterial({ color: 0x1d3b3c, roughness: 0.6, metalness: 0.4 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const grid = new THREE.GridHelper(40, 20, 0x2b5152, 0x2b5152);
  grid.position.y = 0.005;
  scene.add(grid);
  const all = [...looks];
  all.forEach((lk, i) => {
    const rig = buildCrew(lk);
    const row = i < 6 ? 0 : 1;
    const col = i % 6;
    rig.root.position.set(-7 + col * 2.8, 0, row * 3.6 - 2.4);
    const f = (['down', 'right', 'left', 'up'] as const)[i % 4]!;
    rig.setFacing(f, true);
    // half walk mid-stride, half idle, so both poses show at game scale
    for (let k = 0; k < 12; k++) rig.update(k * 0.05, 0.05, i % 2 === 0);
    scene.add(rig.root);
  });
  const fallen = buildFallen(3, 1);
  fallen.position.set(2.6, 0, 5.2);
  scene.add(fallen);
  // game camera: orthographic, fixed pitch, about 16 units across
  const view = 8.5;
  const cam = new THREE.OrthographicCamera(-view * W / H, view * W / H, view, -view, 0.1, 100);
  cam.position.set(0, 14, 12);
  cam.lookAt(0, 0.6, 0.5);
  renderer.render(scene, cam);
}
(window as unknown as { done: boolean }).done = true;
