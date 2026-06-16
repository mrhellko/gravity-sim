import { describe, expect, it } from 'vitest';

import { CpuPhysicsBackend, computeAccelerations } from './cpuPhysicsBackend';
import type { BodyInitialState } from './types';

const baseBodies: BodyInitialState[] = [
  {
    id: 'a',
    name: 'A',
    mass: 10,
    radius: 1,
    color: 0xffffff,
    position: [-1, 0, 0],
    velocity: [0, 0, 0],
    pinned: false,
  },
  {
    id: 'b',
    name: 'B',
    mass: 20,
    radius: 1,
    color: 0xffffff,
    position: [1, 0, 0],
    velocity: [0, 0, 0],
    pinned: false,
  },
];

describe('CpuPhysicsBackend', () => {
  it('computes symmetric Newtonian accelerations scaled by the other body mass', () => {
    const accelerations = computeAccelerations(baseBodies, {
      gravitationalConstant: 1,
      softening: 0,
    });

    expect(accelerations[0][0]).toBeCloseTo(5);
    expect(accelerations[1][0]).toBeCloseTo(-2.5);
    expect(accelerations[0][1]).toBeCloseTo(0);
    expect(accelerations[1][1]).toBeCloseTo(0);
  });

  it('moves bodies toward each other with velocity Verlet integration', async () => {
    const backend = new CpuPhysicsBackend(baseBodies);
    const snapshot = await backend.step(0.1, {
      gravitationalConstant: 1,
      softening: 0,
    });

    expect(snapshot.elapsedSeconds).toBeCloseTo(0.1);
    expect(snapshot.bodies[0].position[0]).toBeGreaterThan(baseBodies[0].position[0]);
    expect(snapshot.bodies[1].position[0]).toBeLessThan(baseBodies[1].position[0]);
  });

  it('reset restores initial positions, velocities and elapsed time', async () => {
    const backend = new CpuPhysicsBackend(baseBodies);

    await backend.step(0.2, {
      gravitationalConstant: 1,
      softening: 0.05,
    });
    backend.reset(baseBodies);

    const snapshot = backend.getSnapshot();
    expect(snapshot.elapsedSeconds).toBe(0);
    expect(snapshot.bodies[0].position).toEqual(baseBodies[0].position);
    expect(snapshot.bodies[0].velocity).toEqual(baseBodies[0].velocity);
    expect(snapshot.bodies[1].position).toEqual(baseBodies[1].position);
    expect(snapshot.bodies[1].velocity).toEqual(baseBodies[1].velocity);
  });

  it('keeps pinned bodies static while they affect other bodies', async () => {
    const backend = new CpuPhysicsBackend([
      { ...baseBodies[0], pinned: true },
      { ...baseBodies[1], velocity: [0, 0, 0] },
    ]);

    const snapshot = await backend.step(0.1, {
      gravitationalConstant: 1,
      softening: 0,
    });

    expect(snapshot.bodies[0].position).toEqual(baseBodies[0].position);
    expect(snapshot.bodies[0].velocity).toEqual([0, 0, 0]);
    expect(snapshot.bodies[0].acceleration).toEqual([0, 0, 0]);
    expect(snapshot.bodies[1].position[0]).toBeLessThan(baseBodies[1].position[0]);
  });
});
