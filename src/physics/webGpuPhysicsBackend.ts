import type {
  BodyInitialState,
  BodyRuntimeState,
  PhysicsBackend,
  PhysicsSettings,
  PhysicsSnapshot,
} from './types';

const FLOATS_PER_BODY = 4;
const BYTES_PER_FLOAT = 4;
const WORKGROUP_SIZE = 64;

const shaderCode = /* wgsl */ `
const MIN_DISTANCE_SQUARED = 1e-12;

struct Settings {
  deltaSeconds: f32,
  gravitationalConstant: f32,
  softeningSquared: f32,
  bodyCount: u32,
}

@group(0) @binding(0) var<storage, read_write> positionMass: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocity: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> acceleration: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> nextAcceleration: array<vec4<f32>>;
@group(0) @binding(4) var<uniform> settings: Settings;

fn computeAccelerationFor(index: u32) -> vec3<f32> {
  if (velocity[index].w > 0.5) {
    return vec3<f32>(0.0, 0.0, 0.0);
  }

  let origin = positionMass[index].xyz;
  var result = vec3<f32>(0.0, 0.0, 0.0);

  for (var other = 0u; other < settings.bodyCount; other = other + 1u) {
    if (other == index) {
      continue;
    }

    let otherBody = positionMass[other];
    let delta = otherBody.xyz - origin;
    let distanceSquared = max(dot(delta, delta) + settings.softeningSquared, MIN_DISTANCE_SQUARED);
    let inverseDistance = inverseSqrt(distanceSquared);
    let inverseDistanceCubed = inverseDistance * inverseDistance * inverseDistance;
    result = result + delta * settings.gravitationalConstant * otherBody.w * inverseDistanceCubed;
  }

  return result;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn compute_current(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let index = globalId.x;

  if (index >= settings.bodyCount) {
    return;
  }

  acceleration[index] = vec4<f32>(computeAccelerationFor(index), 0.0);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn integrate_position(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let index = globalId.x;

  if (index >= settings.bodyCount) {
    return;
  }

  let dt = settings.deltaSeconds;
  let body = positionMass[index];
  let pinned = velocity[index].w;

  if (pinned > 0.5) {
    velocity[index] = vec4<f32>(0.0, 0.0, 0.0, pinned);
    acceleration[index] = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    return;
  }

  let updatedPosition = body.xyz + velocity[index].xyz * dt + 0.5 * acceleration[index].xyz * dt * dt;
  positionMass[index] = vec4<f32>(updatedPosition, body.w);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn compute_next(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let index = globalId.x;

  if (index >= settings.bodyCount) {
    return;
  }

  nextAcceleration[index] = vec4<f32>(computeAccelerationFor(index), 0.0);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn integrate_velocity(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let index = globalId.x;

  if (index >= settings.bodyCount) {
    return;
  }

  let dt = settings.deltaSeconds;
  let pinned = velocity[index].w;

  if (pinned > 0.5) {
    velocity[index] = vec4<f32>(0.0, 0.0, 0.0, pinned);
    acceleration[index] = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    return;
  }

  let updatedVelocity = velocity[index].xyz + 0.5 * (acceleration[index].xyz + nextAcceleration[index].xyz) * dt;
  velocity[index] = vec4<f32>(updatedVelocity, pinned);
  acceleration[index] = nextAcceleration[index];
}
`;

export class WebGpuPhysicsBackend implements PhysicsBackend {
  readonly label = 'WebGPU';

  private readonly device: GPUDevice;
  private readonly pipelines: Record<WebGpuPipelineName, GPUComputePipeline>;
  private readonly bindGroup: GPUBindGroup;
  private readonly positionMassBuffer: GPUBuffer;
  private readonly velocityBuffer: GPUBuffer;
  private readonly accelerationBuffer: GPUBuffer;
  private readonly nextAccelerationBuffer: GPUBuffer;
  private readonly settingsBuffer: GPUBuffer;
  private readonly positionReadBuffer: GPUBuffer;
  private readonly velocityReadBuffer: GPUBuffer;
  private readonly accelerationReadBuffer: GPUBuffer;
  private readonly bodyBufferSize: number;
  private readonly metadata: BodyInitialState[];
  private snapshot: PhysicsSnapshot;

  private constructor(options: WebGpuPhysicsBackendOptions) {
    this.device = options.device;
    this.pipelines = options.pipelines;
    this.bindGroup = options.bindGroup;
    this.positionMassBuffer = options.positionMassBuffer;
    this.velocityBuffer = options.velocityBuffer;
    this.accelerationBuffer = options.accelerationBuffer;
    this.nextAccelerationBuffer = options.nextAccelerationBuffer;
    this.settingsBuffer = options.settingsBuffer;
    this.positionReadBuffer = options.positionReadBuffer;
    this.velocityReadBuffer = options.velocityReadBuffer;
    this.accelerationReadBuffer = options.accelerationReadBuffer;
    this.bodyBufferSize = options.bodyBufferSize;
    this.metadata = options.initialBodies.map(cloneInitialBodyMetadata);
    this.snapshot = createSnapshot(options.initialBodies, 0);
    this.reset(options.initialBodies);
  }

  static async create(initialBodies: BodyInitialState[]): Promise<WebGpuPhysicsBackend> {
    if (!window.isSecureContext) {
      throw new Error('WebGPU requires a secure context.');
    }

    if (!navigator.gpu) {
      throw new Error('navigator.gpu is not available.');
    }

    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });

    if (!adapter) {
      throw new Error('WebGPU adapter is not available.');
    }

    const device = await adapter.requestDevice();
    const bodyBufferSize = initialBodies.length * FLOATS_PER_BODY * BYTES_PER_FLOAT;
    const positionMassBuffer = createStorageBuffer(device, bodyBufferSize);
    const velocityBuffer = createStorageBuffer(device, bodyBufferSize);
    const accelerationBuffer = createStorageBuffer(device, bodyBufferSize);
    const nextAccelerationBuffer = createStorageBuffer(device, bodyBufferSize);
    const settingsBuffer = device.createBuffer({
      label: 'Physics settings',
      size: 4 * BYTES_PER_FLOAT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const positionReadBuffer = createReadBuffer(device, bodyBufferSize);
    const velocityReadBuffer = createReadBuffer(device, bodyBufferSize);
    const accelerationReadBuffer = createReadBuffer(device, bodyBufferSize);
    const shaderModule = device.createShaderModule({
      label: 'Gravity velocity Verlet compute shader',
      code: shaderCode,
    });
    const bindGroupLayout = device.createBindGroupLayout({
      label: 'Physics bind group layout',
      entries: [
        storageEntry(0),
        storageEntry(1),
        storageEntry(2),
        storageEntry(3),
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    const pipelineLayout = device.createPipelineLayout({
      label: 'Physics pipeline layout',
      bindGroupLayouts: [bindGroupLayout],
    });
    const pipelines: Record<WebGpuPipelineName, GPUComputePipeline> = {
      computeCurrent: await createPipeline(device, pipelineLayout, shaderModule, 'compute_current'),
      integratePosition: await createPipeline(
        device,
        pipelineLayout,
        shaderModule,
        'integrate_position',
      ),
      computeNext: await createPipeline(device, pipelineLayout, shaderModule, 'compute_next'),
      integrateVelocity: await createPipeline(
        device,
        pipelineLayout,
        shaderModule,
        'integrate_velocity',
      ),
    };
    const bindGroup = device.createBindGroup({
      label: 'Physics bind group',
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: positionMassBuffer } },
        { binding: 1, resource: { buffer: velocityBuffer } },
        { binding: 2, resource: { buffer: accelerationBuffer } },
        { binding: 3, resource: { buffer: nextAccelerationBuffer } },
        { binding: 4, resource: { buffer: settingsBuffer } },
      ],
    });

    return new WebGpuPhysicsBackend({
      device,
      pipelines,
      bindGroup,
      positionMassBuffer,
      velocityBuffer,
      accelerationBuffer,
      nextAccelerationBuffer,
      settingsBuffer,
      positionReadBuffer,
      velocityReadBuffer,
      accelerationReadBuffer,
      bodyBufferSize,
      initialBodies,
    });
  }

  reset(initialBodies: BodyInitialState[]): void {
    this.metadata.splice(0, this.metadata.length, ...initialBodies.map(cloneInitialBodyMetadata));
    this.snapshot = createSnapshot(initialBodies, 0);
    this.writeRuntimeState(this.snapshot.bodies);
  }

  loadSnapshot(snapshot: PhysicsSnapshot): void {
    this.metadata.splice(0, this.metadata.length, ...snapshot.bodies.map(cloneInitialBodyMetadata));
    this.snapshot = {
      elapsedSeconds: snapshot.elapsedSeconds,
      bodies: snapshot.bodies.map(cloneRuntimeBody),
    };
    this.writeRuntimeState(this.snapshot.bodies);
  }

  onDeviceLost(handler: (info: GPUDeviceLostInfo) => void): void {
    void this.device.lost.then(handler);
  }

  async step(deltaSeconds: number, settings: PhysicsSettings): Promise<PhysicsSnapshot> {
    if (deltaSeconds <= 0 || this.metadata.length === 0) {
      return this.getSnapshot();
    }

    this.writeSettings(deltaSeconds, settings);

    const encoder = this.device.createCommandEncoder({ label: 'Physics step encoder' });
    const workgroups = Math.ceil(this.metadata.length / WORKGROUP_SIZE);

    this.encodePass(encoder, this.pipelines.computeCurrent, workgroups);
    this.encodePass(encoder, this.pipelines.integratePosition, workgroups);
    this.encodePass(encoder, this.pipelines.computeNext, workgroups);
    this.encodePass(encoder, this.pipelines.integrateVelocity, workgroups);
    encoder.copyBufferToBuffer(
      this.positionMassBuffer,
      0,
      this.positionReadBuffer,
      0,
      this.bodyBufferSize,
    );
    encoder.copyBufferToBuffer(
      this.velocityBuffer,
      0,
      this.velocityReadBuffer,
      0,
      this.bodyBufferSize,
    );
    encoder.copyBufferToBuffer(
      this.accelerationBuffer,
      0,
      this.accelerationReadBuffer,
      0,
      this.bodyBufferSize,
    );

    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();
    this.snapshot = await this.readSnapshot(this.snapshot.elapsedSeconds + deltaSeconds);
    return this.getSnapshot();
  }

  getSnapshot(): PhysicsSnapshot {
    return {
      elapsedSeconds: this.snapshot.elapsedSeconds,
      bodies: this.snapshot.bodies.map(cloneRuntimeBody),
    };
  }

  private writeRuntimeState(bodies: BodyRuntimeState[]): void {
    const positionMass = new Float32Array(bodies.length * FLOATS_PER_BODY);
    const velocity = new Float32Array(bodies.length * FLOATS_PER_BODY);
    const acceleration = new Float32Array(bodies.length * FLOATS_PER_BODY);

    for (let index = 0; index < bodies.length; index += 1) {
      const body = bodies[index];
      const offset = index * FLOATS_PER_BODY;

      positionMass[offset] = body.position[0];
      positionMass[offset + 1] = body.position[1];
      positionMass[offset + 2] = body.position[2];
      positionMass[offset + 3] = body.mass;
      velocity[offset] = body.velocity[0];
      velocity[offset + 1] = body.velocity[1];
      velocity[offset + 2] = body.velocity[2];
      velocity[offset + 3] = body.pinned ? 1 : 0;
      acceleration[offset] = body.acceleration[0];
      acceleration[offset + 1] = body.acceleration[1];
      acceleration[offset + 2] = body.acceleration[2];
    }

    this.device.queue.writeBuffer(this.positionMassBuffer, 0, positionMass);
    this.device.queue.writeBuffer(this.velocityBuffer, 0, velocity);
    this.device.queue.writeBuffer(this.accelerationBuffer, 0, acceleration);
    this.device.queue.writeBuffer(this.nextAccelerationBuffer, 0, acceleration);
  }

  private writeSettings(deltaSeconds: number, settings: PhysicsSettings): void {
    const data = new ArrayBuffer(4 * BYTES_PER_FLOAT);
    const view = new DataView(data);

    view.setFloat32(0, deltaSeconds, true);
    view.setFloat32(4, settings.gravitationalConstant, true);
    view.setFloat32(8, settings.softening * settings.softening, true);
    view.setUint32(12, this.metadata.length, true);
    this.device.queue.writeBuffer(this.settingsBuffer, 0, data);
  }

  private encodePass(
    encoder: GPUCommandEncoder,
    pipeline: GPUComputePipeline,
    workgroups: number,
  ): void {
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(workgroups);
    pass.end();
  }

  private async readSnapshot(elapsedSeconds: number): Promise<PhysicsSnapshot> {
    const [positionMass, velocity, acceleration] = await Promise.all([
      readFloatBuffer(this.positionReadBuffer),
      readFloatBuffer(this.velocityReadBuffer),
      readFloatBuffer(this.accelerationReadBuffer),
    ]);
    const bodies = this.metadata.map<BodyRuntimeState>((body, index) => {
      const offset = index * FLOATS_PER_BODY;

      return {
        ...body,
        position: [positionMass[offset], positionMass[offset + 1], positionMass[offset + 2]],
        velocity: body.pinned
          ? [0, 0, 0]
          : [velocity[offset], velocity[offset + 1], velocity[offset + 2]],
        acceleration: [acceleration[offset], acceleration[offset + 1], acceleration[offset + 2]],
      };
    });

    return { bodies, elapsedSeconds };
  }
}

type WebGpuPipelineName =
  | 'computeCurrent'
  | 'integratePosition'
  | 'computeNext'
  | 'integrateVelocity';

interface WebGpuPhysicsBackendOptions {
  device: GPUDevice;
  pipelines: Record<WebGpuPipelineName, GPUComputePipeline>;
  bindGroup: GPUBindGroup;
  positionMassBuffer: GPUBuffer;
  velocityBuffer: GPUBuffer;
  accelerationBuffer: GPUBuffer;
  nextAccelerationBuffer: GPUBuffer;
  settingsBuffer: GPUBuffer;
  positionReadBuffer: GPUBuffer;
  velocityReadBuffer: GPUBuffer;
  accelerationReadBuffer: GPUBuffer;
  bodyBufferSize: number;
  initialBodies: BodyInitialState[];
}

function createStorageBuffer(device: GPUDevice, size: number): GPUBuffer {
  return device.createBuffer({
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
}

function createReadBuffer(device: GPUDevice, size: number): GPUBuffer {
  return device.createBuffer({
    size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
}

function storageEntry(binding: number): GPUBindGroupLayoutEntry {
  return {
    binding,
    visibility: GPUShaderStage.COMPUTE,
    buffer: { type: 'storage' },
  };
}

function createPipeline(
  device: GPUDevice,
  layout: GPUPipelineLayout,
  module: GPUShaderModule,
  entryPoint: string,
): Promise<GPUComputePipeline> {
  return device.createComputePipelineAsync({
    label: entryPoint,
    layout,
    compute: {
      module,
      entryPoint,
    },
  });
}

async function readFloatBuffer(buffer: GPUBuffer): Promise<Float32Array> {
  await buffer.mapAsync(GPUMapMode.READ);
  const copy = new Float32Array(buffer.getMappedRange().slice(0));
  buffer.unmap();
  return copy;
}

function createSnapshot(
  initialBodies: BodyInitialState[],
  elapsedSeconds: number,
): PhysicsSnapshot {
  return {
    elapsedSeconds,
    bodies: initialBodies.map((body) => ({
      ...body,
      position: [...body.position],
      velocity: body.pinned ? [0, 0, 0] : [...body.velocity],
      acceleration: [0, 0, 0],
    })),
  };
}

function cloneInitialBodyMetadata(body: BodyInitialState): BodyInitialState {
  return {
    ...body,
    position: [...body.position],
    velocity: [...body.velocity],
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
