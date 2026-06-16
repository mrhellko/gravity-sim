export type Vec3 = [number, number, number];

export interface BodyInitialState {
  id: string;
  name: string;
  mass: number;
  radius: number;
  color: number;
  position: Vec3;
  velocity: Vec3;
  pinned: boolean;
}

export interface BodyRuntimeState extends BodyInitialState {
  acceleration: Vec3;
}

export interface PhysicsSettings {
  gravitationalConstant: number;
  softening: number;
}

export interface PhysicsSnapshot {
  bodies: BodyRuntimeState[];
  elapsedSeconds: number;
}

export interface PhysicsBackend {
  readonly label: string;
  reset(initialBodies: BodyInitialState[]): void;
  loadSnapshot(snapshot: PhysicsSnapshot): void;
  step(deltaSeconds: number, settings: PhysicsSettings): Promise<PhysicsSnapshot>;
  getSnapshot(): PhysicsSnapshot;
}
