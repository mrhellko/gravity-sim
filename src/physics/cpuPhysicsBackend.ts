import type {
  BodyInitialState,
  BodyRuntimeState,
  PhysicsBackend,
  PhysicsSettings,
  PhysicsSnapshot,
  Vec3,
} from './types';

const MIN_DISTANCE_SQUARED = 1e-12;

export class CpuPhysicsBackend implements PhysicsBackend {
  readonly label = 'CPU';

  private bodies: BodyRuntimeState[] = [];
  private elapsedSeconds = 0;

  constructor(initialBodies: BodyInitialState[]) {
    this.reset(initialBodies);
  }

  reset(initialBodies: BodyInitialState[]): void {
    this.bodies = initialBodies.map(cloneInitialBody);
    this.elapsedSeconds = 0;
  }

  loadSnapshot(snapshot: PhysicsSnapshot): void {
    this.bodies = snapshot.bodies.map(cloneRuntimeBody);
    this.elapsedSeconds = snapshot.elapsedSeconds;
  }

  async step(deltaSeconds: number, settings: PhysicsSettings): Promise<PhysicsSnapshot> {
    if (deltaSeconds <= 0 || this.bodies.length === 0) {
      return this.getSnapshot();
    }

    const currentAccelerations = computeAccelerations(this.bodies, settings);
    const halfDeltaSquared = 0.5 * deltaSeconds * deltaSeconds;

    for (let index = 0; index < this.bodies.length; index += 1) {
      const body = this.bodies[index];

      if (body.pinned) {
        body.velocity = [0, 0, 0];
        body.acceleration = [0, 0, 0];
        continue;
      }

      const acceleration = currentAccelerations[index];

      body.position[0] += body.velocity[0] * deltaSeconds + acceleration[0] * halfDeltaSquared;
      body.position[1] += body.velocity[1] * deltaSeconds + acceleration[1] * halfDeltaSquared;
      body.position[2] += body.velocity[2] * deltaSeconds + acceleration[2] * halfDeltaSquared;
    }

    const nextAccelerations = computeAccelerations(this.bodies, settings);
    const halfDelta = 0.5 * deltaSeconds;

    for (let index = 0; index < this.bodies.length; index += 1) {
      const body = this.bodies[index];

      if (body.pinned) {
        body.velocity = [0, 0, 0];
        body.acceleration = [0, 0, 0];
        continue;
      }

      const current = currentAccelerations[index];
      const next = nextAccelerations[index];

      body.velocity[0] += (current[0] + next[0]) * halfDelta;
      body.velocity[1] += (current[1] + next[1]) * halfDelta;
      body.velocity[2] += (current[2] + next[2]) * halfDelta;
      body.acceleration = next;
    }

    this.elapsedSeconds += deltaSeconds;
    return this.getSnapshot();
  }

  getSnapshot(): PhysicsSnapshot {
    return {
      bodies: this.bodies.map(cloneRuntimeBody),
      elapsedSeconds: this.elapsedSeconds,
    };
  }
}

export function computeAccelerations(
  bodies: Pick<BodyRuntimeState, 'mass' | 'position'>[],
  settings: PhysicsSettings,
): Vec3[] {
  const accelerations = bodies.map<Vec3>(() => [0, 0, 0]);
  const softeningSquared = settings.softening * settings.softening;

  for (let left = 0; left < bodies.length; left += 1) {
    for (let right = left + 1; right < bodies.length; right += 1) {
      const leftBody = bodies[left];
      const rightBody = bodies[right];
      const dx = rightBody.position[0] - leftBody.position[0];
      const dy = rightBody.position[1] - leftBody.position[1];
      const dz = rightBody.position[2] - leftBody.position[2];
      const distanceSquared = Math.max(
        dx * dx + dy * dy + dz * dz + softeningSquared,
        MIN_DISTANCE_SQUARED,
      );
      const inverseDistance = 1 / Math.sqrt(distanceSquared);
      const inverseDistanceCubed = inverseDistance * inverseDistance * inverseDistance;
      const leftScale = settings.gravitationalConstant * rightBody.mass * inverseDistanceCubed;
      const rightScale = settings.gravitationalConstant * leftBody.mass * inverseDistanceCubed;

      if (!('pinned' in leftBody) || !leftBody.pinned) {
        accelerations[left][0] += dx * leftScale;
        accelerations[left][1] += dy * leftScale;
        accelerations[left][2] += dz * leftScale;
      }

      if (!('pinned' in rightBody) || !rightBody.pinned) {
        accelerations[right][0] -= dx * rightScale;
        accelerations[right][1] -= dy * rightScale;
        accelerations[right][2] -= dz * rightScale;
      }
    }
  }

  return accelerations;
}

function cloneInitialBody(body: BodyInitialState): BodyRuntimeState {
  return {
    ...body,
    position: [...body.position],
    velocity: body.pinned ? [0, 0, 0] : [...body.velocity],
    acceleration: [0, 0, 0],
  };
}

function cloneRuntimeBody(body: BodyRuntimeState): BodyRuntimeState {
  return {
    ...body,
    position: [...body.position],
    velocity: [...body.velocity],
    acceleration: [...body.acceleration],
  };
}
