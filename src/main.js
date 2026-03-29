import './styles.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
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
import { laplacianSmooth } from './geometry/laplacianSmoothing.js';

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

          <label class="control">
            <div class="control-row">
              <span>Smoothing</span>
              <span id="smoothing-value">${initial.smoothing}</span>
            </div>
            <input type="range" id="smoothing" min="0" max="3" step="1" value="${initial.smoothing}" />
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

      <section class="panel-section">
        <div class="panel-section-header">
          <span class="panel-section-label">Material</span>
        </div>
        <div class="panel-section-content panel-controls-stack">
          <div class="control control-grid-2">
            <label class="control compact">
              <div class="control-row">
                <span>Gradient Start</span>
              </div>
              <input type="color" id="gradient-start-color" class="color-picker" value="${initial.gradientStart}" />
            </label>
            <label class="control compact">
              <div class="control-row">
                <span>Gradient End</span>
              </div>
              <input type="color" id="gradient-end-color" class="color-picker" value="${initial.gradientEnd}" />
            </label>
          </div>

          <label class="control">
            <div class="control-row">
              <span>Fresnel</span>
              <span id="fresnel-value">${initial.fresnel.toFixed(2)}</span>
            </div>
            <input type="range" id="fresnel" min="0" max="2" step="0.01" value="${initial.fresnel}" />
          </label>

          <label class="control">
            <div class="control-row">
              <span>Specular</span>
              <span id="specular-value">${initial.specular.toFixed(2)}</span>
            </div>
            <input type="range" id="specular" min="0" max="2" step="0.01" value="${initial.specular}" />
          </label>

          <label class="control">
            <div class="control-row">
              <span>Bloom</span>
              <span id="bloom-value">${initial.bloom.toFixed(2)}</span>
            </div>
            <input type="range" id="bloom" min="0" max="2" step="0.01" value="${initial.bloom}" />
          </label>
        </div>
      </section>

      <section class="panel-section">
        <div class="panel-section-header">
          <span class="panel-section-label">Export</span>
        </div>
        <div class="panel-section-content panel-controls-stack">
          <div class="control">
            <button type="button" id="export-obj" class="pill-button control-button-wide">Export OBJ</button>
          </div>
          <div class="control">
            <button type="button" id="export-glb" class="pill-button control-button-wide">Export GLB</button>
          </div>
          <div class="control">
            <button type="button" id="export-screenshot" class="pill-button control-button-wide">Export Screenshot</button>
          </div>
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
    smoothing: requireIn(panel, '#smoothing'),
    xResValue: requireIn(panel, '#x-res-value'),
    yResValue: requireIn(panel, '#y-res-value'),
    zResValue: requireIn(panel, '#z-res-value'),
    isoValueValue: requireIn(panel, '#iso-value-value'),
    amountValue: requireIn(panel, '#amount-value'),
    offsetValue: requireIn(panel, '#offset-value'),
    subdivisionValue: requireIn(panel, '#subdivision-value'),
    smoothingValue: requireIn(panel, '#smoothing-value'),
    pointCountValue: requireIn(panel, '#point-count-value'),
    gradientStart: requireIn(panel, '#gradient-start-color'),
    gradientEnd: requireIn(panel, '#gradient-end-color'),
    fresnel: requireIn(panel, '#fresnel'),
    specular: requireIn(panel, '#specular'),
    bloom: requireIn(panel, '#bloom'),
    fresnelValue: requireIn(panel, '#fresnel-value'),
    specularValue: requireIn(panel, '#specular-value'),
    bloomValue: requireIn(panel, '#bloom-value'),
    clearAll: requireIn(panel, '#clear-all'),
    exportObj: requireIn(panel, '#export-obj'),
    exportGlb: requireIn(panel, '#export-glb'),
    exportScreenshot: requireIn(panel, '#export-screenshot'),
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
  smoothing: 0,
  gradientStart: '#7eafd0',
  gradientEnd: '#7ce7de',
  fresnel: 0.48,
  specular: 0.42,
  bloom: 0.34,
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

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  settings.bloom,
  0.72,
  0.16,
);
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

function createIsosurfaceMaterial(baseColor) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
    uniforms: {
      uBaseColor: { value: baseColor.clone() },
      uLightDirA: { value: lightDirA },
      uLightDirB: { value: lightDirB },
      uFresnel: { value: settings.fresnel },
      uSpecular: { value: settings.specular },
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
const SMOOTHING_VERTEX_LIMIT = 120000;
const SMOOTHING_VERTEX_ITERATION_BUDGET = 240000;
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
  const start = new THREE.Color(settings.gradientStart);
  const end = new THREE.Color(settings.gradientEnd);
  if (totalCount <= 1) {
    return start;
  }

  const t = index / (totalCount - 1);
  return start.lerp(end, t);
}

function applyMaterialSettingsToMeshes() {
  const meshCount = isoGroup.children.length;
  for (let i = 0; i < meshCount; i += 1) {
    const mesh = isoGroup.children[i];
    if (!(mesh.material instanceof THREE.ShaderMaterial)) {
      continue;
    }

    mesh.material.uniforms.uBaseColor.value.copy(getIsosurfaceColor(i, meshCount));
    mesh.material.uniforms.uFresnel.value = settings.fresnel;
    mesh.material.uniforms.uSpecular.value = settings.specular;
  }
}

function getEffectiveSmoothingIterations(geometry, requestedIterations) {
  const requested = Math.max(0, Math.floor(requestedIterations));
  if (requested === 0) {
    return 0;
  }

  const position = geometry.getAttribute('position');
  const vertexCount = position ? position.count : 0;
  if (vertexCount <= 0 || vertexCount > SMOOTHING_VERTEX_LIMIT) {
    return 0;
  }

  const byBudget = Math.floor(SMOOTHING_VERTEX_ITERATION_BUDGET / vertexCount);
  if (byBudget <= 0) {
    return 0;
  }

  return Math.min(requested, byBudget);
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

  for (let i = 0; i < surfaces.length; i += 1) {
    let renderGeometry = surfaces[i].geometry;
    if (settings.subdivision > 0) {
      const subdivided = subdivideCatmullClark(renderGeometry, settings.subdivision);
      if (subdivided !== renderGeometry) {
        renderGeometry.dispose();
        renderGeometry = subdivided;
      }
    }
    const smoothingIterations =
      settings.subdivision > 0 ? getEffectiveSmoothingIterations(renderGeometry, settings.smoothing) : 0;
    if (smoothingIterations > 0) {
      const smoothed = laplacianSmooth(renderGeometry, smoothingIterations, 0.5);
      if (smoothed !== renderGeometry) {
        renderGeometry.dispose();
        renderGeometry = smoothed;
      }
    }

    const material = createIsosurfaceMaterial(getIsosurfaceColor(i, surfaces.length));
    const mesh = new THREE.Mesh(renderGeometry, material);
    isoGroup.add(mesh);
  }

  applyMaterialSettingsToMeshes();
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

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

function getMeshBaseColor(mesh) {
  if (mesh.material instanceof THREE.ShaderMaterial) {
    const uniform = mesh.material.uniforms.uBaseColor;
    if (uniform?.value instanceof THREE.Color) {
      return uniform.value.clone();
    }
  }
  return new THREE.Color(0xffffff);
}

function buildExportGroup() {
  const group = new THREE.Group();
  const ownedGeometries = [];
  const ownedMaterials = [];

  for (const child of isoGroup.children) {
    if (!(child instanceof THREE.Mesh) || !(child.geometry instanceof THREE.BufferGeometry)) {
      continue;
    }

    const geometry = child.geometry.clone();
    geometry.applyMatrix4(child.matrixWorld);
    const material = new THREE.MeshStandardMaterial({
      color: getMeshBaseColor(child),
      roughness: 0.35,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });

    group.add(new THREE.Mesh(geometry, material));
    ownedGeometries.push(geometry);
    ownedMaterials.push(material);
  }

  return {
    group,
    dispose: () => {
      for (const geometry of ownedGeometries) {
        geometry.dispose();
      }
      for (const material of ownedMaterials) {
        material.dispose();
      }
    },
  };
}

function exportIsosurfacesAsObj() {
  if (isoGroup.children.length === 0) {
    return;
  }

  const lines = ['# Scalar Isosurface OBJ export'];
  let vertexOffset = 1;

  const worldPosition = new THREE.Vector3();
  const worldNormal = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();

  for (let meshIndex = 0; meshIndex < isoGroup.children.length; meshIndex += 1) {
    const mesh = isoGroup.children[meshIndex];
    if (!(mesh instanceof THREE.Mesh) || !(mesh.geometry instanceof THREE.BufferGeometry)) {
      continue;
    }

    const position = mesh.geometry.getAttribute('position');
    if (!(position instanceof THREE.BufferAttribute)) {
      continue;
    }

    let normal = mesh.geometry.getAttribute('normal');
    if (!(normal instanceof THREE.BufferAttribute)) {
      mesh.geometry.computeVertexNormals();
      normal = mesh.geometry.getAttribute('normal');
    }
    if (!(normal instanceof THREE.BufferAttribute)) {
      continue;
    }

    normalMatrix.getNormalMatrix(mesh.matrixWorld);
    lines.push(`o layer_${meshIndex + 1}`);

    for (let i = 0; i < position.count; i += 1) {
      worldPosition.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      lines.push(`v ${worldPosition.x.toFixed(6)} ${worldPosition.y.toFixed(6)} ${worldPosition.z.toFixed(6)}`);
    }

    for (let i = 0; i < normal.count; i += 1) {
      worldNormal.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
      lines.push(`vn ${worldNormal.x.toFixed(6)} ${worldNormal.y.toFixed(6)} ${worldNormal.z.toFixed(6)}`);
    }

    const index = mesh.geometry.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i) + vertexOffset;
        const b = index.getX(i + 1) + vertexOffset;
        const c = index.getX(i + 2) + vertexOffset;
        lines.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
      }
    } else {
      for (let i = 0; i < position.count; i += 3) {
        const a = vertexOffset + i;
        const b = vertexOffset + i + 1;
        const c = vertexOffset + i + 2;
        lines.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
      }
    }

    vertexOffset += position.count;
  }

  downloadBlob('isosurface.obj', new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
}

const gltfExporter = new GLTFExporter();
function exportIsosurfacesAsGlb() {
  if (isoGroup.children.length === 0) {
    return;
  }

  const { group, dispose } = buildExportGroup();
  gltfExporter.parse(
    group,
    (result) => {
      if (result instanceof ArrayBuffer) {
        downloadBlob('isosurface.glb', new Blob([result], { type: 'model/gltf-binary' }));
      } else {
        console.error('GLB export expected ArrayBuffer output.');
      }
      dispose();
    },
    (error) => {
      console.error('GLB export failed.', error);
      dispose();
    },
    { binary: true, onlyVisible: true },
  );
}

function exportScreenshot() {
  composer.render();
  renderer.domElement.toBlob((blob) => {
    if (!blob) {
      console.error('Screenshot export failed.');
      return;
    }
    downloadBlob('isosurface.png', blob);
  }, 'image/png');
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

const updateSmoothingUi = () => {
  const value = Math.round(Number.parseFloat(ui.smoothing.value));
  settings.smoothing = value;
  ui.smoothingValue.textContent = `${value}`;
  updateRangeProgress(ui.smoothing);
};
ui.smoothing.addEventListener('input', updateSmoothingUi);
ui.smoothing.addEventListener('change', scheduleRebuild);
ui.smoothing.addEventListener('pointerup', scheduleRebuild);
updateSmoothingUi();

bindRange(ui.fresnel, ui.fresnelValue, (value) => `${value.toFixed(2)}`, (value) => {
  settings.fresnel = value;
  applyMaterialSettingsToMeshes();
});

bindRange(ui.specular, ui.specularValue, (value) => `${value.toFixed(2)}`, (value) => {
  settings.specular = value;
  applyMaterialSettingsToMeshes();
});

bindRange(ui.bloom, ui.bloomValue, (value) => `${value.toFixed(2)}`, (value) => {
  settings.bloom = value;
  bloomPass.strength = value;
});

ui.gradientStart.addEventListener('input', () => {
  settings.gradientStart = ui.gradientStart.value;
  applyMaterialSettingsToMeshes();
});

ui.gradientEnd.addEventListener('input', () => {
  settings.gradientEnd = ui.gradientEnd.value;
  applyMaterialSettingsToMeshes();
});

ui.clearAll.addEventListener('click', () => {
  points.length = 0;
  pointGroup.clear();
  settings.pointCount = 0;
  updatePointCountLabel();
  scheduleRebuild();
});

ui.exportObj.addEventListener('click', exportIsosurfacesAsObj);
ui.exportGlb.addEventListener('click', exportIsosurfacesAsGlb);
ui.exportScreenshot.addEventListener('click', exportScreenshot);

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
