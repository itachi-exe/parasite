type Light = { position: { x: number; z: number }; visible: boolean };

/** Fixed light count avoids recompiling shaders every time the player changes rooms. */
export function limitNearbyLights(lights: Light[], x: number, z: number, budget: number): void {
  const nearest = new Set([...lights].sort((a, b) =>
    (a.position.x - x) ** 2 + (a.position.z - z) ** 2 -
    (b.position.x - x) ** 2 - (b.position.z - z) ** 2,
  ).slice(0, Math.max(0, budget)));
  for (const light of lights) light.visible = nearest.has(light);
}
