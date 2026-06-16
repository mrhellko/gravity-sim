import { describe, expect, it } from 'vitest';

import { CpuPhysicsBackend } from './physics/cpuPhysicsBackend';
import type { Vec3 } from './physics/types';
import {
  createSolarSystemInitialBodies,
  SOLAR_SYSTEM_GRAVITY,
  SOLAR_SYSTEM_SOFTENING,
} from './solarSystemPreset';

describe('solar system preset', () => {
  it('starts with the Moon separated from Earth', () => {
    const bodies = createSolarSystemInitialBodies();
    const earth = requiredBody(bodies, 'earth');
    const moon = requiredBody(bodies, 'moon');
    const earthMoonDistance = distance(earth.position, moon.position);

    expect(earthMoonDistance).toBeGreaterThan(0.35);
    expect(earthMoonDistance).toBeLessThan(0.45);
  });

  it('keeps planet state finite and away from the Sun over one simulated year', async () => {
    const backend = new CpuPhysicsBackend(createSolarSystemInitialBodies());
    const deltaDays = 1 / 24;
    const steps = 365 * 24;

    for (let index = 0; index < steps; index += 1) {
      await backend.step(deltaDays, {
        gravitationalConstant: SOLAR_SYSTEM_GRAVITY,
        softening: SOLAR_SYSTEM_SOFTENING,
      });
    }

    const snapshot = backend.getSnapshot();
    const sun = requiredBody(snapshot.bodies, 'sun');

    for (const body of snapshot.bodies) {
      const values = [...body.position, ...body.velocity, ...body.acceleration];
      expect(values.every(Number.isFinite)).toBe(true);

      if (body.id !== 'sun') {
        const distanceFromSun = distance(body.position, sun.position);
        expect(distanceFromSun).toBeGreaterThan(20);
        expect(distanceFromSun).toBeLessThan(6000);
      }
    }
  });
});

function requiredBody<T extends { id: string; position: Vec3 }>(bodies: T[], id: string): T {
  const body = bodies.find((item) => item.id === id);

  if (!body) {
    throw new Error(`Missing body: ${id}`);
  }

  return body;
}

function distance(left: Vec3, right: Vec3): number {
  const dx = left[0] - right[0];
  const dy = left[1] - right[1];
  const dz = left[2] - right[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
