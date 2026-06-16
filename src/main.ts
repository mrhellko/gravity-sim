import './styles.css';

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { CpuPhysicsBackend } from './physics/cpuPhysicsBackend';
import { WebGpuPhysicsBackend } from './physics/webGpuPhysicsBackend';
import type { BodyInitialState, BodyRuntimeState, PhysicsBackend } from './physics/types';

type SimulationStatus = 'stopped' | 'running' | 'paused';
type BackendMode = 'auto' | 'cpu' | 'webgpu';

const FIXED_TIME_STEP_SECONDS = 1 / 120;
const MAX_FRAME_STEPS = 6;
const SOFTENING = 0.18;
const DEFAULT_GRAVITY = 6;
const DEFAULT_TIME_SCALE = 1;
const DEFAULT_TRAIL_POINT_LIMIT = 240;
const MIN_TRAIL_POINT_LIMIT = 30;
const MAX_TRAIL_POINT_LIMIT = 900;
const MAX_REASONABLE_ABS_VALUE = 1_000_000;
const generatedNameParts = [
  'Atlas',
  'Vega',
  'Orion',
  'Nova',
  'Kepler',
  'Lumen',
  'Aster',
  'Helio',
  'Nyx',
  'Pulsar',
] as const;

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('App root was not found.');
}

app.innerHTML = `
  <canvas class="scene-canvas" aria-label="3D сцена симуляции гравитации"></canvas>
  <aside class="hud hud-left" aria-label="Панель управления симуляцией">
    <section class="panel">
      <div class="panel-heading">
        <span class="panel-title">Gravity Sim</span>
        <span id="statusBadge" class="badge">stopped</span>
      </div>
      <div class="button-row">
        <button id="startButton" type="button">Start</button>
        <button id="pauseButton" type="button">Pause</button>
        <button id="resetButton" type="button">Reset</button>
      </div>
      <label class="control-line">
        <span>G</span>
        <input id="gravityInput" type="range" min="0" max="20" value="${DEFAULT_GRAVITY}" step="0.1" />
        <output id="gravityValue">6.0</output>
      </label>
      <label class="control-line">
        <span>Time</span>
        <input id="timeScaleInput" type="range" min="0.1" max="5" value="${DEFAULT_TIME_SCALE}" step="0.1" />
        <output id="timeScaleValue">1.0x</output>
      </label>
      <label class="control-line">
        <span>Trail</span>
        <input id="trailEnabledInput" type="checkbox" checked />
        <output id="trailEnabledValue">On</output>
      </label>
      <label class="control-line">
        <span>Length</span>
        <input id="trailLengthInput" type="range" min="${MIN_TRAIL_POINT_LIMIT}" max="${MAX_TRAIL_POINT_LIMIT}" value="${DEFAULT_TRAIL_POINT_LIMIT}" step="30" />
        <output id="trailLengthValue">${DEFAULT_TRAIL_POINT_LIMIT}</output>
      </label>
      <label class="control-line">
        <span>Backend</span>
        <select id="backendModeSelect">
          <option value="auto" selected>Auto</option>
          <option value="cpu">CPU</option>
          <option value="webgpu">WebGPU</option>
        </select>
        <output id="backendModeValue">Auto</output>
      </label>
      <div class="button-row compact editor-actions">
        <button id="addBodyButton" type="button">Add</button>
        <button id="focusBodyButton" type="button" aria-pressed="false">Focus</button>
        <button id="deleteBodyButton" type="button">Delete</button>
        <button id="clearBodiesButton" type="button">Clear</button>
      </div>
      <section id="bodyInspector" class="inspector" aria-label="Инспектор выбранного тела">
        <div class="inspector-title" id="selectedBodyTitle">No body selected</div>
        <label>
          <span>Name</span>
          <input id="bodyNameInput" type="text" />
        </label>
        <label>
          <span>Color</span>
          <input id="bodyColorInput" type="color" />
        </label>
        <label>
          <span>Mass</span>
          <input id="bodyMassInput" type="text" inputmode="decimal" />
        </label>
        <label>
          <span>Radius</span>
          <input id="bodyRadiusInput" type="number" min="0.05" max="10" step="0.05" />
        </label>
        <label class="checkbox-line">
          <input id="bodyPinnedInput" type="checkbox" />
          <span>Pinned</span>
        </label>
        <div class="vector-grid">
          <label><span>X</span><input id="bodyXInput" type="number" step="0.1" /></label>
          <label><span>Y</span><input id="bodyYInput" type="number" step="0.1" /></label>
          <label><span>Z</span><input id="bodyZInput" type="number" step="0.1" /></label>
          <label><span>VX</span><input id="bodyVxInput" type="number" step="0.1" /></label>
          <label><span>VY</span><input id="bodyVyInput" type="number" step="0.1" /></label>
          <label><span>VZ</span><input id="bodyVzInput" type="number" step="0.1" /></label>
          <label><span>AX</span><input id="bodyAxInput" type="number" readonly /></label>
          <label><span>AY</span><input id="bodyAyInput" type="number" readonly /></label>
          <label><span>AZ</span><input id="bodyAzInput" type="number" readonly /></label>
        </div>
      </section>
    </section>
  </aside>
  <aside class="hud body-list-panel" aria-label="Список тел">
    <section class="panel body-list-shell">
      <div class="panel-heading compact-heading">
        <span class="panel-title">Bodies</span>
        <span id="bodyCountBadge" class="badge">0</span>
      </div>
      <div id="bodyList" class="body-list"></div>
    </section>
  </aside>
  <aside class="hud hud-right" aria-label="Метрики сцены">
    <section class="panel metrics">
      <div><span>FPS</span><strong id="fpsValue">0</strong></div>
      <div><span>Objects</span><strong id="objectCount">3</strong></div>
      <div><span>Sim time</span><strong id="simulationTime">0.0s</strong></div>
      <div><span>Step</span><strong>${FIXED_TIME_STEP_SECONDS.toFixed(4)}s</strong></div>
      <div><span>Physics</span><strong id="physicsBackend">CPU</strong></div>
      <div><span>WebGPU</span><strong id="webGpuStatus">checking</strong></div>
      <div><span>Context</span><strong id="secureContextStatus">checking</strong></div>
      <div><span>Last event</span><strong id="lastEventStatus">boot</strong></div>
    </section>
  </aside>
`;

const canvas = requiredElement<HTMLCanvasElement>('.scene-canvas');
const statusBadge = requiredElement<HTMLSpanElement>('#statusBadge');
const startButton = requiredElement<HTMLButtonElement>('#startButton');
const pauseButton = requiredElement<HTMLButtonElement>('#pauseButton');
const resetButton = requiredElement<HTMLButtonElement>('#resetButton');
const gravityInput = requiredElement<HTMLInputElement>('#gravityInput');
const gravityValue = requiredElement<HTMLOutputElement>('#gravityValue');
const timeScaleInput = requiredElement<HTMLInputElement>('#timeScaleInput');
const timeScaleValue = requiredElement<HTMLOutputElement>('#timeScaleValue');
const trailEnabledInput = requiredElement<HTMLInputElement>('#trailEnabledInput');
const trailEnabledValue = requiredElement<HTMLOutputElement>('#trailEnabledValue');
const trailLengthInput = requiredElement<HTMLInputElement>('#trailLengthInput');
const trailLengthValue = requiredElement<HTMLOutputElement>('#trailLengthValue');
const backendModeSelect = requiredElement<HTMLSelectElement>('#backendModeSelect');
const backendModeValue = requiredElement<HTMLOutputElement>('#backendModeValue');
const addBodyButton = requiredElement<HTMLButtonElement>('#addBodyButton');
const focusBodyButton = requiredElement<HTMLButtonElement>('#focusBodyButton');
const deleteBodyButton = requiredElement<HTMLButtonElement>('#deleteBodyButton');
const clearBodiesButton = requiredElement<HTMLButtonElement>('#clearBodiesButton');
const bodyInspector = requiredElement<HTMLElement>('#bodyInspector');
const bodyList = requiredElement<HTMLElement>('#bodyList');
const bodyCountBadge = requiredElement<HTMLElement>('#bodyCountBadge');
const selectedBodyTitle = requiredElement<HTMLElement>('#selectedBodyTitle');
const bodyNameInput = requiredElement<HTMLInputElement>('#bodyNameInput');
const bodyColorInput = requiredElement<HTMLInputElement>('#bodyColorInput');
const bodyMassInput = requiredElement<HTMLInputElement>('#bodyMassInput');
const bodyRadiusInput = requiredElement<HTMLInputElement>('#bodyRadiusInput');
const bodyPinnedInput = requiredElement<HTMLInputElement>('#bodyPinnedInput');
const bodyXInput = requiredElement<HTMLInputElement>('#bodyXInput');
const bodyYInput = requiredElement<HTMLInputElement>('#bodyYInput');
const bodyZInput = requiredElement<HTMLInputElement>('#bodyZInput');
const bodyVxInput = requiredElement<HTMLInputElement>('#bodyVxInput');
const bodyVyInput = requiredElement<HTMLInputElement>('#bodyVyInput');
const bodyVzInput = requiredElement<HTMLInputElement>('#bodyVzInput');
const bodyAxInput = requiredElement<HTMLInputElement>('#bodyAxInput');
const bodyAyInput = requiredElement<HTMLInputElement>('#bodyAyInput');
const bodyAzInput = requiredElement<HTMLInputElement>('#bodyAzInput');
const fpsValue = requiredElement<HTMLElement>('#fpsValue');
const objectCount = requiredElement<HTMLElement>('#objectCount');
const simulationTime = requiredElement<HTMLElement>('#simulationTime');
const webGpuStatus = requiredElement<HTMLElement>('#webGpuStatus');
const physicsBackend = requiredElement<HTMLElement>('#physicsBackend');
const secureContextStatus = requiredElement<HTMLElement>('#secureContextStatus');
const lastEventStatus = requiredElement<HTMLElement>('#lastEventStatus');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07090d);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.up.set(0, 0, 1);
camera.position.set(18, -18, 12);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, 0, 0);

const ambientLight = new THREE.AmbientLight(0xb7c7ff, 0.35);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
keyLight.position.set(14, -16, 18);
scene.add(keyLight);

const grid = new THREE.GridHelper(42, 42, 0x24405f, 0x132033);
grid.rotation.x = Math.PI / 2;
grid.position.z = -0.02;
scene.add(grid);

const axes = new THREE.AxesHelper(5);
scene.add(axes);

let initialBodies: BodyInitialState[] = [
  {
    id: 'primary',
    name: 'Primary',
    mass: 120,
    radius: 1.6,
    color: 0xffcc66,
    position: [0, 0, 0],
    velocity: [0, 0, 0],
    pinned: true,
  },
  {
    id: 'orbiter-a',
    name: 'Orbiter A',
    mass: 8,
    radius: 0.55,
    color: 0x75b8ff,
    position: [7, 0, 0],
    velocity: [0, 13.1, 0],
    pinned: false,
  },
  {
    id: 'orbiter-b',
    name: 'Orbiter B',
    mass: 4,
    radius: 0.42,
    color: 0xdf8cff,
    position: [-4, 5, 0],
    velocity: [-9.8, -7.8, 0],
    pinned: false,
  },
];

let backend: PhysicsBackend = new CpuPhysicsBackend(initialBodies);
const bodyMeshes = new Map<string, THREE.Mesh>();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const selectionMarker = createSelectionMarker();
scene.add(selectionMarker);
const trailLines = new Map<string, THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>>();
const trailPoints = new Map<string, THREE.Vector3[]>();

let status: SimulationStatus = 'stopped';
let gravity = Number(gravityInput.value);
let timeScale = Number(timeScaleInput.value);
let trailsEnabled = trailEnabledInput.checked;
let trailPointLimit = Number(trailLengthInput.value);
let frameCount = 0;
let fpsWindowStart = performance.now();
let lastFrameTime = performance.now();
let physicsAccumulator = 0;
let stepInFlight = false;
let selectedBodyId: string | null = null;
let bodySequence = initialBodies.length + 1;
let currentBackendMode: BackendMode = 'auto';
let focusFollowEnabled = false;

startButton.addEventListener('click', () => setStatus('running'));
pauseButton.addEventListener('click', () => setStatus(status === 'paused' ? 'running' : 'paused'));
resetButton.addEventListener('click', () => {
  resetSimulation();
});

gravityInput.addEventListener('input', () => {
  gravity = Number(gravityInput.value);
  gravityValue.value = gravity.toFixed(1);
});

timeScaleInput.addEventListener('input', () => {
  timeScale = Number(timeScaleInput.value);
  timeScaleValue.value = `${timeScale.toFixed(1)}x`;
});

backendModeSelect.addEventListener('change', () => {
  void setBackendMode(backendModeSelect.value as BackendMode);
});

addBodyButton.addEventListener('click', addBody);
focusBodyButton.addEventListener('click', toggleFocusFollow);
deleteBodyButton.addEventListener('click', deleteSelectedBody);
clearBodiesButton.addEventListener('click', clearBodies);
canvas.addEventListener('pointerdown', selectBodyFromPointer);

trailEnabledInput.addEventListener('change', () => {
  trailsEnabled = trailEnabledInput.checked;
  trailEnabledValue.value = trailsEnabled ? 'On' : 'Off';
  updateTrailVisibility();
});

trailLengthInput.addEventListener('input', () => {
  trailPointLimit = Number(trailLengthInput.value);
  trailLengthValue.value = trailPointLimit.toString();
  trimAllTrails();
});

for (const input of [
  bodyNameInput,
  bodyColorInput,
  bodyMassInput,
  bodyRadiusInput,
  bodyPinnedInput,
  bodyXInput,
  bodyYInput,
  bodyZInput,
  bodyVxInput,
  bodyVyInput,
  bodyVzInput,
]) {
  input.addEventListener('change', applyInspectorChanges);
}

window.addEventListener('resize', resize);

rebuildBodyMeshes();
rebuildTrailLines();
selectBody(initialBodies[0]?.id ?? null);
applySnapshot(backend.getSnapshot().bodies);
resetTrails(backend.getSnapshot().bodies);
void setBackendMode('auto');
animate();

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Required UI element was not found: ${selector}`);
  }

  return element;
}

function createBody(body: BodyInitialState): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(body.radius, 48, 24);
  const material = new THREE.MeshStandardMaterial({
    color: body.color,
    roughness: 0.52,
    metalness: 0.08,
    emissive: body.color,
    emissiveIntensity: Math.min(body.mass / 600, 0.18),
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...body.position);
  mesh.userData.id = body.id;
  mesh.userData.mass = body.mass;
  mesh.userData.name = body.name;
  return mesh;
}

function createSelectionMarker(): THREE.Group {
  const marker = new THREE.Group();
  const material = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
  });
  const cornerLength = 0.42;
  const cornerPositions = [-1, 1] as const;

  for (const x of cornerPositions) {
    for (const y of cornerPositions) {
      for (const z of cornerPositions) {
        addCornerSegment(marker, material, [x, y, z], [x - x * cornerLength, y, z]);
        addCornerSegment(marker, material, [x, y, z], [x, y - y * cornerLength, z]);
        addCornerSegment(marker, material, [x, y, z], [x, y, z - z * cornerLength]);
      }
    }
  }

  marker.visible = false;
  return marker;
}

function addCornerSegment(
  marker: THREE.Group,
  material: THREE.LineBasicMaterial,
  start: [number, number, number],
  end: [number, number, number],
): void {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(...start),
    new THREE.Vector3(...end),
  ]);
  marker.add(new THREE.Line(geometry, material));
}

function createTrailLine(
  body: BodyInitialState,
): THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> {
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.LineBasicMaterial({
    color: body.color,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
  });
  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false;
  line.visible = trailsEnabled;
  return line;
}

function setStatus(nextStatus: SimulationStatus): void {
  status = nextStatus;
  statusBadge.textContent = status;
  statusBadge.dataset.status = status;
  pauseButton.textContent = status === 'paused' ? 'Resume' : 'Pause';
  syncInspector();
}

async function setBackendMode(nextMode: BackendMode): Promise<void> {
  currentBackendMode = nextMode;
  backendModeSelect.value = nextMode;
  backendModeValue.value = formatBackendMode(nextMode);
  setStatus('stopped');
  physicsAccumulator = 0;
  lastFrameTime = performance.now();
  secureContextStatus.textContent = window.isSecureContext ? 'secure' : 'insecure';
  physicsBackend.textContent = 'initializing';

  if (nextMode === 'cpu') {
    setLastEvent('CPU selected');
    switchToCpu('disabled');
    return;
  }

  if (initialBodies.length === 0) {
    webGpuStatus.textContent = 'empty scene';
    setLastEvent('empty scene');
    switchToCpu('empty scene');
    return;
  }

  const webGpuError = getWebGpuPreflightError();

  if (webGpuError) {
    webGpuStatus.textContent = webGpuError;
    setLastEvent(webGpuError);
    switchToCpu(nextMode === 'webgpu' ? 'fallback' : webGpuError);
    return;
  }

  try {
    const webGpuBackend = await WebGpuPhysicsBackend.create(initialBodies);
    webGpuBackend.onDeviceLost(() => {
      webGpuStatus.textContent = 'device lost';
      switchToCpu('device lost');
    });
    backend = webGpuBackend;
    backend.reset(initialBodies);
    webGpuStatus.textContent = 'available';
    physicsBackend.textContent = backend.label;
    setLastEvent('WebGPU ready');
    simulationTime.textContent = '0.0s';
    applySnapshot(backend.getSnapshot().bodies);
    resetTrails(backend.getSnapshot().bodies);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'error';
    webGpuStatus.textContent = compactStatus(message);
    setLastEvent(message);
    switchToCpu('fallback');
  }
}

function switchToCpu(reason: string): void {
  backend = new CpuPhysicsBackend(initialBodies);
  backend.reset(initialBodies);
  physicsBackend.textContent = reason === 'disabled' ? 'CPU' : `CPU (${reason})`;
  simulationTime.textContent = '0.0s';
  applySnapshot(backend.getSnapshot().bodies);
  resetTrails(backend.getSnapshot().bodies);
}

function rebuildBodyMeshes(): void {
  for (const mesh of bodyMeshes.values()) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    const material = mesh.material;

    if (Array.isArray(material)) {
      for (const item of material) {
        item.dispose();
      }
    } else {
      material.dispose();
    }
  }

  bodyMeshes.clear();

  for (const body of initialBodies) {
    const mesh = createBody(body);
    bodyMeshes.set(body.id, mesh);
    scene.add(mesh);
  }

  objectCount.textContent = initialBodies.length.toString();
  bodyCountBadge.textContent = initialBodies.length.toString();
  renderBodyList();
}

function rebuildTrailLines(): void {
  const activeBodyIds = new Set(initialBodies.map((body) => body.id));

  for (const [bodyId, line] of trailLines) {
    if (!activeBodyIds.has(bodyId)) {
      scene.remove(line);
      line.geometry.dispose();
      line.material.dispose();
      trailLines.delete(bodyId);
      trailPoints.delete(bodyId);
    }
  }

  for (const body of initialBodies) {
    let line = trailLines.get(body.id);

    if (!line) {
      line = createTrailLine(body);
      trailLines.set(body.id, line);
      scene.add(line);
    } else {
      line.material.color.set(body.color);
      line.visible = trailsEnabled;
    }

    updateTrailLine(body.id);
  }
}

function getWebGpuPreflightError(): string | null {
  if (!window.isSecureContext) {
    return 'insecure context';
  }

  if (!navigator.gpu) {
    return 'navigator.gpu missing';
  }

  return null;
}

function formatBackendMode(mode: BackendMode): string {
  if (mode === 'webgpu') {
    return 'WebGPU';
  }

  if (mode === 'cpu') {
    return 'CPU';
  }

  return 'Auto';
}

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function animate(): void {
  requestAnimationFrame(animate);

  void stepSimulation(performance.now());
  updateCameraFollow();
  controls.update();
  renderer.render(scene, camera);
  updateFps();
}

async function stepSimulation(now: number): Promise<void> {
  if (stepInFlight) {
    return;
  }

  const frameDeltaSeconds = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;

  if (status !== 'running') {
    return;
  }

  physicsAccumulator += frameDeltaSeconds * timeScale;
  let steps = 0;

  try {
    stepInFlight = true;

    while (physicsAccumulator >= FIXED_TIME_STEP_SECONDS && steps < MAX_FRAME_STEPS) {
      await backend.step(FIXED_TIME_STEP_SECONDS, {
        gravitationalConstant: gravity,
        softening: SOFTENING,
      });
      physicsAccumulator -= FIXED_TIME_STEP_SECONDS;
      steps += 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'runtime error';
    webGpuStatus.textContent = compactStatus(message);
    setLastEvent(message);
    switchToCpu('runtime fallback');
    return;
  } finally {
    stepInFlight = false;
  }

  if (steps === MAX_FRAME_STEPS) {
    physicsAccumulator = 0;
  }

  const snapshot = backend.getSnapshot();
  const invalidSnapshotReason = getInvalidSnapshotReason(snapshot.bodies);

  if (invalidSnapshotReason) {
    webGpuStatus.textContent = invalidSnapshotReason;
    setLastEvent(invalidSnapshotReason);
    switchToCpu('invalid GPU result');
    return;
  }

  applySnapshot(snapshot.bodies);
  appendTrailPoints(snapshot.bodies);
  simulationTime.textContent = `${snapshot.elapsedSeconds.toFixed(1)}s`;
}

function applySnapshot(bodies: BodyRuntimeState[]): void {
  for (const body of bodies) {
    const mesh = bodyMeshes.get(body.id);

    if (mesh) {
      mesh.position.set(...body.position);
    }
  }

  updateSelectionMarker();
  syncRuntimeInspectorFields();
}

function resetSimulation(): void {
  setStatus('stopped');
  gravity = DEFAULT_GRAVITY;
  timeScale = DEFAULT_TIME_SCALE;
  gravityInput.value = DEFAULT_GRAVITY.toString();
  timeScaleInput.value = DEFAULT_TIME_SCALE.toString();
  gravityValue.value = gravity.toFixed(1);
  timeScaleValue.value = `${timeScale.toFixed(1)}x`;
  physicsAccumulator = 0;
  lastFrameTime = performance.now();
  backend.reset(initialBodies);
  const snapshot = backend.getSnapshot();
  applySnapshot(snapshot.bodies);
  resetTrails(snapshot.bodies);
  simulationTime.textContent = `${snapshot.elapsedSeconds.toFixed(1)}s`;
  controls.reset();
}

function selectBodyFromPointer(event: PointerEvent): void {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  raycaster.setFromCamera(pointer, camera);

  const hits = raycaster.intersectObjects([...bodyMeshes.values()], false);
  selectBody(hits[0]?.object.userData.id ?? null);
}

function selectBody(bodyId: string | null): void {
  selectedBodyId = bodyId;
  syncInspector();
  updateSelectionMarker();
  renderBodyList();
}

function syncInspector(): void {
  const body = getSelectedInitialBody();
  const disabled = !body;
  const editable = Boolean(body && status !== 'running');
  const sceneEditable = status !== 'running';

  bodyInspector.classList.toggle('hidden', !body);
  selectedBodyTitle.textContent = body ? body.name : 'No body selected';
  bodyNameInput.disabled = !editable;
  bodyColorInput.disabled = !editable;
  bodyMassInput.disabled = !editable;
  bodyRadiusInput.disabled = !editable;
  bodyPinnedInput.disabled = !editable;
  const pinned = Boolean(body?.pinned);
  bodyXInput.disabled = !editable;
  bodyYInput.disabled = !editable;
  bodyZInput.disabled = !editable;
  bodyVxInput.disabled = !editable || pinned;
  bodyVyInput.disabled = !editable || pinned;
  bodyVzInput.disabled = !editable || pinned;
  bodyAxInput.disabled = disabled;
  bodyAyInput.disabled = disabled;
  bodyAzInput.disabled = disabled;
  focusBodyButton.disabled = disabled;
  deleteBodyButton.disabled = !editable;
  addBodyButton.disabled = !sceneEditable;
  clearBodiesButton.disabled = !sceneEditable || initialBodies.length === 0;
  updateFocusButtonState();

  if (!body) {
    bodyAxInput.value = '';
    bodyAyInput.value = '';
    bodyAzInput.value = '';
    return;
  }

  bodyNameInput.value = body.name;
  bodyColorInput.value = colorNumberToHex(body.color);
  bodyMassInput.value = body.mass.toExponential(3);
  bodyRadiusInput.value = body.radius.toString();
  bodyPinnedInput.checked = body.pinned;
  bodyXInput.value = body.position[0].toString();
  bodyYInput.value = body.position[1].toString();
  bodyZInput.value = body.position[2].toString();
  bodyVxInput.value = body.velocity[0].toString();
  bodyVyInput.value = body.velocity[1].toString();
  bodyVzInput.value = body.velocity[2].toString();
  syncRuntimeInspectorFields();
}

function applyInspectorChanges(): void {
  const body = getSelectedInitialBody();

  if (!body) {
    return;
  }

  if (status === 'running') {
    setLastEvent('Pause before editing body parameters');
    syncInspector();
    return;
  }

  const pinned = bodyPinnedInput.checked;
  const snapshot = backend.getSnapshot();
  const runtimeBody = snapshot.bodies.find((item) => item.id === body.id);
  body.name = bodyNameInput.value.trim() || body.name;
  body.color = Number.parseInt(bodyColorInput.value.slice(1), 16);
  body.mass = parsePositiveNumber(bodyMassInput.value, body.mass);
  body.radius = parsePositiveNumber(bodyRadiusInput.value, body.radius);
  body.position = [
    parseFiniteNumber(bodyXInput.value, body.position[0]),
    parseFiniteNumber(bodyYInput.value, body.position[1]),
    parseFiniteNumber(bodyZInput.value, body.position[2]),
  ];
  body.pinned = pinned;
  body.velocity = pinned
    ? [0, 0, 0]
    : [
        parseFiniteNumber(bodyVxInput.value, body.velocity[0]),
        parseFiniteNumber(bodyVyInput.value, body.velocity[1]),
        parseFiniteNumber(bodyVzInput.value, body.velocity[2]),
      ];

  if (runtimeBody) {
    runtimeBody.name = body.name;
    runtimeBody.color = body.color;
    runtimeBody.mass = body.mass;
    runtimeBody.radius = body.radius;
    runtimeBody.position = [...body.position];
    runtimeBody.velocity = [...body.velocity];
    runtimeBody.pinned = body.pinned;
    runtimeBody.acceleration = body.pinned ? [0, 0, 0] : runtimeBody.acceleration;
    backend.loadSnapshot(snapshot);
  }

  rebuildBodyMeshes();
  rebuildTrailLines();
  applySnapshot(backend.getSnapshot().bodies);
  resetTrails(backend.getSnapshot().bodies);
  selectBody(body.id);
  setLastEvent(`Updated ${body.name}`);
}

function addBody(): void {
  const body: BodyInitialState = {
    id: `body-${crypto.randomUUID()}`,
    name: generateBodyName(),
    mass: 5,
    radius: 0.45,
    color: randomPaletteColor(),
    position: [randomBetween(-5, 5), randomBetween(-5, 5), 0],
    velocity: [randomBetween(-3, 3), randomBetween(-3, 3), 0],
    pinned: false,
  };

  initialBodies = [...initialBodies, body];
  rebuildBodyMeshes();
  rebuildTrailLines();
  seedTrailFromBody(body);
  selectBody(body.id);
  setLastEvent(`Added ${body.name}`);
  void setBackendMode(currentBackendMode);
}

function deleteSelectedBody(): void {
  const body = getSelectedInitialBody();

  if (!body) {
    return;
  }

  initialBodies = initialBodies.filter((item) => item.id !== body.id);
  rebuildBodyMeshes();
  rebuildTrailLines();
  selectBody(initialBodies[0]?.id ?? null);
  setLastEvent(`Deleted ${body.name}`);
  void setBackendMode(currentBackendMode);
}

function clearBodies(): void {
  if (status === 'running') {
    setLastEvent('Pause before clearing the scene');
    return;
  }

  initialBodies = [];
  rebuildBodyMeshes();
  rebuildTrailLines();
  clearAllTrails();
  selectBody(null);
  setLastEvent('Cleared scene');
  void setBackendMode(currentBackendMode);
}

function toggleFocusFollow(): void {
  if (!selectedBodyId) {
    return;
  }

  focusFollowEnabled = !focusFollowEnabled;
  updateFocusButtonState();
  updateCameraFollow();
}

function updateCameraFollow(): void {
  const mesh = selectedBodyId ? bodyMeshes.get(selectedBodyId) : null;

  if (!mesh || !focusFollowEnabled) {
    return;
  }

  controls.target.copy(mesh.position);
}

function getSelectedInitialBody(): BodyInitialState | null {
  return initialBodies.find((body) => body.id === selectedBodyId) ?? null;
}

function renderBodyList(): void {
  bodyList.replaceChildren();

  for (const body of initialBodies) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'body-list-item';
    button.dataset.active = body.id === selectedBodyId ? 'true' : 'false';
    button.innerHTML = `
      <span class="body-list-color" style="background:${colorNumberToHex(body.color)}"></span>
      <span class="body-list-name">${body.name}</span>
      <span class="body-list-meta">${body.pinned ? 'Pinned' : body.mass.toExponential(1)}</span>
    `;
    button.addEventListener('click', () => selectBody(body.id));
    bodyList.append(button);
  }
}

function updateFocusButtonState(): void {
  if (!selectedBodyId) {
    focusFollowEnabled = false;
  }

  focusBodyButton.classList.toggle('is-active', focusFollowEnabled);
  focusBodyButton.ariaPressed = focusFollowEnabled ? 'true' : 'false';
  focusBodyButton.textContent = focusFollowEnabled ? 'Follow' : 'Focus';
}

function updateSelectionMarker(): void {
  const body = getSelectedInitialBody();
  const mesh = selectedBodyId ? bodyMeshes.get(selectedBodyId) : null;

  if (!body || !mesh) {
    selectionMarker.visible = false;
    return;
  }

  selectionMarker.visible = true;
  selectionMarker.position.copy(mesh.position);
  const size = Math.max(body.radius * 1.45, 0.45);
  selectionMarker.scale.setScalar(size);
}

function syncRuntimeInspectorFields(): void {
  const runtimeBody = backend.getSnapshot().bodies.find((body) => body.id === selectedBodyId);

  if (!runtimeBody) {
    bodyAxInput.value = '';
    bodyAyInput.value = '';
    bodyAzInput.value = '';
    return;
  }

  if (status === 'running') {
    bodyXInput.value = runtimeBody.position[0].toFixed(3);
    bodyYInput.value = runtimeBody.position[1].toFixed(3);
    bodyZInput.value = runtimeBody.position[2].toFixed(3);
    bodyVxInput.value = runtimeBody.velocity[0].toFixed(3);
    bodyVyInput.value = runtimeBody.velocity[1].toFixed(3);
    bodyVzInput.value = runtimeBody.velocity[2].toFixed(3);
  }

  bodyAxInput.value = runtimeBody.acceleration[0].toExponential(2);
  bodyAyInput.value = runtimeBody.acceleration[1].toExponential(2);
  bodyAzInput.value = runtimeBody.acceleration[2].toExponential(2);
}

function appendTrailPoints(bodies: BodyRuntimeState[]): void {
  if (!trailsEnabled) {
    return;
  }

  for (const body of bodies) {
    const points = trailPoints.get(body.id) ?? [];
    const position = new THREE.Vector3(...body.position);
    const lastPoint = points.at(-1);

    if (!lastPoint || lastPoint.distanceToSquared(position) > 0.000001) {
      points.push(position);
    }

    while (points.length > trailPointLimit) {
      points.shift();
    }

    trailPoints.set(body.id, points);
    updateTrailLine(body.id);
  }
}

function resetTrails(bodies: BodyRuntimeState[]): void {
  clearAllTrails();

  for (const body of bodies) {
    trailPoints.set(body.id, [new THREE.Vector3(...body.position)]);
    updateTrailLine(body.id);
  }
}

function seedTrailFromBody(body: BodyInitialState): void {
  trailPoints.set(body.id, [new THREE.Vector3(...body.position)]);
  updateTrailLine(body.id);
}

function clearAllTrails(): void {
  trailPoints.clear();

  for (const bodyId of trailLines.keys()) {
    updateTrailLine(bodyId);
  }
}

function trimAllTrails(): void {
  for (const [bodyId, points] of trailPoints) {
    while (points.length > trailPointLimit) {
      points.shift();
    }

    updateTrailLine(bodyId);
  }
}

function updateTrailLine(bodyId: string): void {
  const line = trailLines.get(bodyId);

  if (!line) {
    return;
  }

  const points = trailPoints.get(bodyId) ?? [];
  line.geometry.dispose();
  line.geometry = new THREE.BufferGeometry().setFromPoints(points);
}

function updateTrailVisibility(): void {
  for (const line of trailLines.values()) {
    line.visible = trailsEnabled;
  }
}

function generateBodyName(): string {
  const part = generatedNameParts[(bodySequence - 1) % generatedNameParts.length];
  const name = `${part} ${bodySequence.toString().padStart(2, '0')}`;
  bodySequence += 1;
  return name;
}

function colorNumberToHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function randomPaletteColor(): number {
  const colors = [0x75b8ff, 0xffcc66, 0xdf8cff, 0x8ff0c9, 0xff7a90, 0xd8f36a];
  return colors[Math.floor(Math.random() * colors.length)];
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function parseFiniteNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePositiveNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getInvalidSnapshotReason(bodies: BodyRuntimeState[]): string | null {
  for (const body of bodies) {
    const values = [...body.position, ...body.velocity, ...body.acceleration];

    for (const value of values) {
      if (!Number.isFinite(value)) {
        return 'invalid GPU result';
      }

      if (Math.abs(value) > MAX_REASONABLE_ABS_VALUE) {
        return 'unstable GPU result';
      }
    }
  }

  return null;
}

function setLastEvent(message: string): void {
  lastEventStatus.textContent = compactStatus(message);
  lastEventStatus.title = message;
}

function compactStatus(message: string): string {
  return message.length > 48 ? `${message.slice(0, 45)}...` : message;
}

function updateFps(): void {
  frameCount += 1;
  const now = performance.now();
  const elapsed = now - fpsWindowStart;

  if (elapsed >= 500) {
    fpsValue.textContent = Math.round((frameCount * 1000) / elapsed).toString();
    frameCount = 0;
    fpsWindowStart = now;
  }
}
