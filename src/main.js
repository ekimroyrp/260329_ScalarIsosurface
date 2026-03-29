import './styles.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { generateIsosurfaces } from './isosurface/marchingCubes.js';
import { subdivideCatmullClark } from './geometry/catmullClarkSubdivision.js';

const ISOSURFACE_VERTEX_SHADER = `
  varying vec3 vWorldPos;
  varying vec3 vNormal;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const ISOSURFACE_FRAGMENT_SHADER = `
  precision highp float;

  varying vec3 vWorldPos;
  varying vec3 vNormal;

  uniform vec3 uBaseColor;
  uniform vec3 uLightDirA;
  uniform vec3 uLightDirB;
  uniform float uFresnel;
  uniform float uSpecular;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    vec3 lightA = normalize(uLightDirA);
    vec3 lightB = normalize(uLightDirB);

    float wrap = 0.34;
    float diffA = max((dot(n, lightA) + wrap) / (1.0 + wrap), 0.0);
    float diffB = max((dot(n, lightB) + wrap) / (1.0 + wrap), 0.0);

    float specA = pow(max(dot(reflect(-lightA, n), viewDir), 0.0), 72.0);
    float specB = pow(max(dot(reflect(-lightB, n), viewDir), 0.0), 34.0);
    float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);

    vec3 color = uBaseColor * (0.16 + 0.86 * (diffA * 0.92 + diffB * 0.48));
    color += vec3(1.0) * (specA + specB * 0.35) * uSpecular;
    color += uBaseColor * fresnel * uFresnel;
    color = mix(color, color * color * 1.22, 0.24);

    gl_FragColor = vec4(color, 1.0);
  }
`;

function requireIn(root, selector) {
  const element = root.querySelector(selector);
  if (!element) {
    throw new Error(`Missing UI element: ${selector}`);
  }
  return element;
}

function revealUiWhenStyled(maxWaitMs = 1500) {
  const start = performance.now();

  const tryReveal = () => {
    const styled = getComputedStyle(document.documentElement).getPropertyValue('--ui-size-scale').trim().length > 0;
    if (styled || performance.now() - start >= maxWaitMs) {
      document.documentElement.classList.add('ui-ready');
      return;
    }

    requestAnimationFrame(tryReveal);
  };

  tryReveal();
}

function buildControlPanel(initial) {
  const panel = document.createElement('div');
  panel.id = 'ui-panel';
  panel.className = 'apple-panel';
  panel.innerHTML = `
    <div id="ui-handle" class="panel-drag-handle">
      <button
        type="button"
        id="collapse-toggle"
        class="collapse-button panel-collapse-toggle"
        aria-label="Collapse controls"
        aria-expanded="true"
      >
        <span class="collapse-icon" aria-hidden="true"></span>
      </button>
    </div>

    <div class="ui-body panel-sections">
      <div class="control-hint">Wheel = Zoom, MMB = Pan, RMB = Orbit</div>

      <section class="panel-section">
        <div class="panel-section-header">
          <span class="panel-section-label">Grid Density</span>
        </div>
        <div class="panel-section-content panel-controls-stack">
          <label class="control">
            <div class="control-row">
              <span>X res</span>
              <span id="x-res-value">${initial.xRes}</span>
            </div>
            <input type="range" id="x-res" min="8" max="48" step="1" value="${initial.xRes}" />
          </label>

          <label class="control">
            <div class="control-row">
              <span>Y res</span>
              <span id="y-res-value">${initial.yRes}</span>
            </div>
            <input type="range" id="y-res" min="8" max="48" step="1" value="${initial.yRes}" />
          </label>

          <label class="control">
            <div class="control-row">
              <span>Z res</span>
              <span id="z-res-value">${initial.zRes}</span>
            </div>
            <input type="range" id="z-res" min="8" max="48" step="1" value="${initial.zRes}" />
          </label>
        </div>
      </section>

      <section class="panel-section">
        <div class="panel-section-header">
          <span class="panel-section-label">Surface</span>
        </div>
        <div class="panel-section-content panel-controls-stack">
          <label class="control">
            <div class="control-row">
              <span>isoValue</span>
              <span id="iso-value-value">${initial.isoValue.toFixed(2)}</span>
            </div>
            <input type="range" id="iso-value" min="0.05" max="3.0" step="0.01" value="${initial.isoValue}" />
          </label>

          <label class="control">
            <div class="control-row">
              <span>Amount</span>
              <span id="amount-value">${initial.amount}</span>
            </div>
            <input type="range" id="amount" min="1" max="12" step="1" value="${initial.amount}" />
          </label>

          <label class="control">
            <div class="control-row">
              <span>offset</span>
              <span id="offset-value">${initial.offset.toFixed(2)}</span>
            </div>
            <input type="range" id="offset" min="0" max="1" step="0.01" value="${initial.offset}" />
          </label>

          <label class="control">
            <div class="control-row">
              <span>Subdivision</span>
              <span id="subdivision-value">${initial.subdivision}</span>
            </div>
            <input type="range" id="subdivision" min="0" max="2" step="1" value="${initial.subdivision}" />
          </label>
        </div>
      </section>

      <section class="panel-section">
        <div class="panel-section-header">
          <span class="panel-section-label">Points</span>
        </div>
        <div class="panel-section-content panel-controls-stack">
          <div class="control compact">
            <div class="control-row">
              <span>Count</span>
              <span id="point-count-value">0</span>
            </div>
          </div>
          <button type="button" id="clear-all" class="pill-button control-button-wide">Clear All</button>
        </div>
      </section>
    </div>
    <div id="ui-handle-bottom"></div>
  `;

  document.body.appendChild(panel);

  return {
    panel,
    handleTop: requireIn(panel, '#ui-handle'),
    handleBottom: requireIn(panel, '#ui-handle-bottom'),
    collapseToggle: requireIn(panel, '#collapse-toggle'),
    sectionHeaders: Array.from(panel.querySelectorAll('.panel-section-header')),
    xRes: requireIn(panel, '#x-res'),
    yRes: requireIn(panel, '#y-res'),
    zRes: requireIn(panel, '#z-res'),
    isoValue: requireIn(panel, '#iso-value'),
    amount: requireIn(panel, '#amount'),
    offset: requireIn(panel, '#offset'),
    subdivision: requireIn(panel, '#subdivision'),
    xResValue: requireIn(panel, '#x-res-value'),
    yResValue: requireIn(panel, '#y-res-value'),
    zResValue: requireIn(panel, '#z-res-value'),
    isoValueValue: requireIn(panel, '#iso-value-value'),
    amountValue: requireIn(panel, '#amount-value'),
    offsetValue: requireIn(panel, '#offset-value'),
    subdivisionValue: requireIn(panel, '#subdivision-value'),
    pointCountValue: requireIn(panel, '#point-count-value'),
    clearAll: requireIn(panel, '#clear-all'),
    rangeInputs: Array.from(panel.querySelectorAll('input[type="range"]')),
  };
}

function updateRangeProgress(range) {
  const min = Number.parseFloat(range.min);
  const max = Number.parseFloat(range.max);
  const value = Number.parseFloat(range.value);
  const span = max - min;
  const progress = span > 1e-8 ? ((value - min) / span) * 100 : 100;
  range.style.setProperty('--range-progress', `${progress}%`);
}

function bindRange(input, valueEl, format, onInput) {
  const apply = () => {
    const value = Number.parseFloat(input.value);
    valueEl.textContent = format(value);
    updateRangeProgress(input);
    onInput(value);
  };

  input.addEventListener('input', apply);
  apply();
}

const settings = {
  xRes: 24,
  yRes: 24,
  zRes: 24,
  isoValue: 0.55,
  amount: 1,
  offset: 0.08,
  subdivision: 0,
  pointCount: 0,
};

const ui = buildControlPanel(settings);
revealUiWhenStyled();

function bindSectionCollapseToggles(panel) {
  const headers = panel.querySelectorAll('.panel-section-header');
  headers.forEach((header) => {
    const section = header.closest('.panel-section');
    if (!section) {
      return;
    }

    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', section.classList.contains('is-collapsed') ? 'false' : 'true');

    const toggle = () => {
      const collapsed = section.classList.toggle('is-collapsed');
      header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    };

    header.addEventListener('click', toggle);
    header.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
  });
}

bindSectionCollapseToggles(ui.panel);

ui.collapseToggle.addEventListener('pointerdown', (event) => {
  event.stopPropagation();
});
ui.collapseToggle.addEventListener('click', () => {
  const collapsed = ui.panel.classList.toggle('is-collapsed');
  ui.collapseToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
});

let draggingPanel = false;
const dragOffset = { x: 0, y: 0 };

function clampPanelToViewport() {
  const margin = 10;
  const rootStyles = getComputedStyle(document.documentElement);
  const menuScaleRaw = rootStyles.getPropertyValue('--menu-scale').trim();
  const parsedMenuScale = Number.parseFloat(menuScaleRaw);
  const menuScale = Number.isFinite(parsedMenuScale) && parsedMenuScale > 0 ? parsedMenuScale : 1;
  const scaledPanelHeight = ui.panel.offsetHeight * menuScale;
  const scaledPanelWidth = ui.panel.offsetWidth * menuScale;
  const maxTop = Math.max(margin, window.innerHeight - scaledPanelHeight - margin);
  const maxLeft = Math.max(margin, window.innerWidth - scaledPanelWidth - margin);
  const top = Math.min(Math.max(ui.panel.offsetTop, margin), maxTop);
  const left = Math.min(Math.max(ui.panel.offsetLeft, margin), maxLeft);
  ui.panel.style.top = `${top}px`;
  ui.panel.style.left = `${left}px`;
  ui.panel.style.right = 'auto';
}

const beginPanelDrag = (event) => {
  if (event.target instanceof Element && event.target.closest('.collapse-button')) {
    return;
  }

  draggingPanel = true;
  const rect = ui.panel.getBoundingClientRect();
  ui.panel.style.left = `${rect.left}px`;
  ui.panel.style.top = `${rect.top}px`;
  ui.panel.style.right = 'auto';
  ui.panel.style.bottom = 'auto';
  dragOffset.x = event.clientX - rect.left;
  dragOffset.y = event.clientY - rect.top;
};

ui.handleTop.addEventListener('pointerdown', beginPanelDrag);
ui.handleBottom.addEventListener('pointerdown', beginPanelDrag);
window.addEventListener('pointermove', (event) => {
  if (!draggingPanel) {
    return;
  }

  ui.panel.style.left = `${event.clientX - dragOffset.x}px`;
  ui.panel.style.top = `${event.clientY - dragOffset.y}px`;
  clampPanelToViewport();
});
window.addEventListener('pointerup', () => {
  draggingPanel = false;
});
window.addEventListener('pointercancel', () => {
  draggingPanel = false;
});

for (const rangeInput of ui.rangeInputs) {
  updateRangeProgress(rangeInput);
}

const app = document.querySelector('#app');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111622);

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(3.8, 2.7, 4.1);

const getPixelRatio = () => Math.min(window.devicePixelRatio * 1.5, 3);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(getPixelRatio());
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
app.appendChild(renderer.domElement);

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.34, 0.72, 0.16);
composer.addPass(bloomPass);

const fxaaPass = new ShaderPass(FXAAShader);
composer.addPass(fxaaPass);

function updateFxaaResolution() {
  const pixelRatio = renderer.getPixelRatio();
  fxaaPass.material.uniforms.resolution.value.set(
    1 / (window.innerWidth * pixelRatio),
    1 / (window.innerHeight * pixelRatio),
  );
}

updateFxaaResolution();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);
controls.mouseButtons = {
  LEFT: null,
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: THREE.MOUSE.ROTATE,
};
controls.update();

renderer.domElement.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});
window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

const ambientLight = new THREE.AmbientLight(0xffffff, 0.26);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0x3d5074, 0x121824, 0.42);
scene.add(hemiLight);

const keyLightA = new THREE.DirectionalLight(0xd6e5ff, 1.25);
keyLightA.position.set(2.6, 3.2, 1.8);
scene.add(keyLightA);

const keyLightB = new THREE.DirectionalLight(0x7fb2ff, 0.65);
keyLightB.position.set(-3.0, 1.7, 2.8);
scene.add(keyLightB);

const bounds = {
  min: new THREE.Vector3(-1, -1, -1),
  max: new THREE.Vector3(1, 1, 1),
};

const boxSize = new THREE.Vector3().subVectors(bounds.max, bounds.min);
const boxGeometry = new THREE.BoxGeometry(boxSize.x, boxSize.y, boxSize.z);
const boxEdgesThinGeometry = new THREE.EdgesGeometry(boxGeometry);
const boxEdgesGeometry = new LineSegmentsGeometry();
boxEdgesGeometry.setPositions(boxEdgesThinGeometry.getAttribute('position').array);
boxEdgesThinGeometry.dispose();

const boxEdgesMaterial = new LineMaterial({
  color: 0xffffff,
  linewidth: 1.6,
  transparent: false,
  depthTest: true,
  depthWrite: true,
});
boxEdgesMaterial.resolution.set(window.innerWidth, window.innerHeight);

const boxEdges = new LineSegments2(boxEdgesGeometry, boxEdgesMaterial);
boxEdges.computeLineDistances();
scene.add(boxEdges);

const raycastBox = new THREE.Mesh(
  boxGeometry.clone(),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
);
scene.add(raycastBox);
boxGeometry.dispose();

const lightDirA = keyLightA.position.clone().normalize();
const lightDirB = keyLightB.position.clone().normalize();

function createIsosurfaceMaterial(baseColor, layerFactor) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
    uniforms: {
      uBaseColor: { value: baseColor.clone() },
      uLightDirA: { value: lightDirA },
      uLightDirB: { value: lightDirB },
      uFresnel: { value: 0.48 + layerFactor * 0.22 },
      uSpecular: { value: 0.42 + layerFactor * 0.18 },
    },
    vertexShader: ISOSURFACE_VERTEX_SHADER,
    fragmentShader: ISOSURFACE_FRAGMENT_SHADER,
  });
}

const isoGroup = new THREE.Group();
scene.add(isoGroup);

const points = [];
const pointGroup = new THREE.Group();
scene.add(pointGroup);

const pointGeometry = new THREE.SphereGeometry(0.045, 16, 12);
const pointMaterial = new THREE.MeshStandardMaterial({
  color: 0xdd6f3f,
  emissive: 0x4f1f0e,
  emissiveIntensity: 0.6,
  roughness: 0.38,
  metalness: 0.12,
});

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

let pointerDown = null;
const clickMoveThresholdSq = 16;
const sigma = 0.22;
let rebuildTimer = null;

function updatePointCountLabel() {
  ui.pointCountValue.textContent = String(settings.pointCount);
}

function clearIsosurfaceMeshes() {
  for (let i = isoGroup.children.length - 1; i >= 0; i -= 1) {
    const mesh = isoGroup.children[i];
    isoGroup.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
}

function getIsosurfaceColor(index, totalCount) {
  const color = new THREE.Color();
  if (totalCount <= 1) {
    color.set(0x5a90d1);
    return color;
  }

  const t = index / (totalCount - 1);
  color.setHSL(0.58 - 0.1 * t, 0.5 + t * 0.1, 0.42 + t * 0.08);
  return color;
}

function rebuildIsosurfaces() {
  clearIsosurfaceMeshes();

  const surfaces = generateIsosurfaces({
    bounds,
    resolution: {
      x: settings.xRes,
      y: settings.yRes,
      z: settings.zRes,
    },
    isoValue: settings.isoValue,
    points,
    sigma,
    amount: settings.amount,
    offset: settings.offset,
  });

  const total = Math.max(surfaces.length - 1, 1);
  for (let i = 0; i < surfaces.length; i += 1) {
    let renderGeometry = surfaces[i].geometry;
    if (settings.subdivision > 0) {
      const subdivided = subdivideCatmullClark(renderGeometry, settings.subdivision);
      if (subdivided !== renderGeometry) {
        renderGeometry.dispose();
        renderGeometry = subdivided;
      }
    }

    const layerFactor = i / total;
    const material = createIsosurfaceMaterial(getIsosurfaceColor(i, surfaces.length), layerFactor);
    const mesh = new THREE.Mesh(renderGeometry, material);
    isoGroup.add(mesh);
  }
}

function scheduleRebuild() {
  if (rebuildTimer !== null) {
    clearTimeout(rebuildTimer);
  }

  rebuildTimer = window.setTimeout(() => {
    rebuildTimer = null;
    rebuildIsosurfaces();
  }, 100);
}

bindRange(ui.xRes, ui.xResValue, (value) => `${Math.round(value)}`, (value) => {
  settings.xRes = Math.round(value);
  scheduleRebuild();
});

bindRange(ui.yRes, ui.yResValue, (value) => `${Math.round(value)}`, (value) => {
  settings.yRes = Math.round(value);
  scheduleRebuild();
});

bindRange(ui.zRes, ui.zResValue, (value) => `${Math.round(value)}`, (value) => {
  settings.zRes = Math.round(value);
  scheduleRebuild();
});

bindRange(ui.isoValue, ui.isoValueValue, (value) => `${value.toFixed(2)}`, (value) => {
  settings.isoValue = value;
  scheduleRebuild();
});

bindRange(ui.amount, ui.amountValue, (value) => `${Math.round(value)}`, (value) => {
  settings.amount = Math.round(value);
  scheduleRebuild();
});

bindRange(ui.offset, ui.offsetValue, (value) => `${value.toFixed(2)}`, (value) => {
  settings.offset = value;
  scheduleRebuild();
});

bindRange(ui.subdivision, ui.subdivisionValue, (value) => `${Math.round(value)}`, (value) => {
  settings.subdivision = Math.round(value);
  scheduleRebuild();
});

ui.clearAll.addEventListener('click', () => {
  points.length = 0;
  pointGroup.clear();
  settings.pointCount = 0;
  updatePointCountLabel();
  scheduleRebuild();
});

function setMouseFromEvent(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function addPointFromEvent(event) {
  setMouseFromEvent(event);
  raycaster.setFromCamera(mouse, camera);

  const hits = raycaster.intersectObject(raycastBox, false);
  if (hits.length === 0) {
    return;
  }

  const point = hits[0].point.clone();
  points.push(point);

  const marker = new THREE.Mesh(pointGeometry, pointMaterial);
  marker.position.copy(point);
  pointGroup.add(marker);

  settings.pointCount = points.length;
  updatePointCountLabel();
  scheduleRebuild();
}

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) {
    return;
  }

  pointerDown = {
    x: event.clientX,
    y: event.clientY,
  };
});

renderer.domElement.addEventListener('pointerup', (event) => {
  if (event.button !== 0 || pointerDown === null) {
    return;
  }

  const dx = event.clientX - pointerDown.x;
  const dy = event.clientY - pointerDown.y;
  pointerDown = null;

  if (dx * dx + dy * dy > clickMoveThresholdSq) {
    return;
  }

  addPointFromEvent(event);
});

renderer.domElement.addEventListener('pointercancel', () => {
  pointerDown = null;
});

renderer.domElement.addEventListener('pointerleave', () => {
  pointerDown = null;
});

function onResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  const pixelRatio = getPixelRatio();
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height);
  composer.setSize(width, height);
  bloomPass.setSize(width, height);
  updateFxaaResolution();
  boxEdgesMaterial.resolution.set(width, height);
  clampPanelToViewport();
}

window.addEventListener('resize', onResize);

let animationFrame = 0;
function renderLoop() {
  animationFrame = requestAnimationFrame(renderLoop);
  controls.update();
  composer.render();
}

updatePointCountLabel();
renderLoop();
rebuildIsosurfaces();
clampPanelToViewport();

window.addEventListener('beforeunload', () => {
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
  }

  if (rebuildTimer !== null) {
    clearTimeout(rebuildTimer);
  }

  controls.dispose();
  clearIsosurfaceMeshes();

  pointGeometry.dispose();
  pointMaterial.dispose();

  boxEdges.geometry.dispose();
  boxEdges.material.dispose();

  raycastBox.geometry.dispose();
  raycastBox.material.dispose();

  if (typeof bloomPass.dispose === 'function') {
    bloomPass.dispose();
  }
  if (fxaaPass.material) {
    fxaaPass.material.dispose();
  }
  if (typeof composer.dispose === 'function') {
    composer.dispose();
  }
  renderer.dispose();
});
