import './styles.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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
          <span class="panel-section-label">Simulation</span>
        </div>
        <div class="panel-section-content panel-controls-stack">
          <div class="control control-grid-2">
            <button type="button" id="start-sim" class="pill-button control-button-wide is-start-state">Start</button>
            <button type="button" id="reset-sim" class="pill-button control-button-wide">Reset</button>
          </div>

          <label class="control">
            <div class="control-row">
              <span>Simulation Timeline</span>
              <span id="simulation-timeline-value">0</span>
            </div>
            <input type="range" id="simulation-timeline" min="0" max="1000" step="1" value="0" disabled />
          </label>

          <label class="control">
            <div class="control-row">
              <span>Simulation Rate</span>
              <input
                type="number"
                id="simulation-rate-value"
                class="value-editor"
                min="0.1"
                max="3"
                step="0.01"
                value="${initial.simulationRate.toFixed(2)}"
              />
            </div>
            <input type="range" id="simulation-rate" min="0.1" max="3" step="0.01" value="${initial.simulationRate}" />
          </label>
        </div>
      </section>

      <section class="panel-section">
        <div class="panel-section-header">
          <span class="panel-section-label">Boundary</span>
        </div>
        <div class="panel-section-content panel-controls-stack">
          <label class="control">
            <div class="control-row">
              <span>Size X</span>
              <input type="number" id="size-x-value" class="value-editor" min="0.5" max="10" step="0.01" value="${initial.sizeX.toFixed(2)}" />
            </div>
            <input type="range" id="size-x" min="0.5" max="10" step="0.01" value="${initial.sizeX}" />
          </label>

          <label class="control">
            <div class="control-row">
              <span>Size Y</span>
              <input type="number" id="size-y-value" class="value-editor" min="0.5" max="10" step="0.01" value="${initial.sizeY.toFixed(2)}" />
            </div>
            <input type="range" id="size-y" min="0.5" max="10" step="0.01" value="${initial.sizeY}" />
          </label>

          <label class="control">
            <div class="control-row">
              <span>Size Z</span>
              <input type="number" id="size-z-value" class="value-editor" min="0.5" max="10" step="0.01" value="${initial.sizeZ.toFixed(2)}" />
            </div>
            <input type="range" id="size-z" min="0.5" max="10" step="0.01" value="${initial.sizeZ}" />
          </label>

          <label class="control">
            <div class="control-row">
              <span>X Resolution</span>
              <input type="number" id="x-res-value" class="value-editor" min="8" max="48" step="1" value="${initial.xRes}" />
            </div>
            <input type="range" id="x-res" min="8" max="48" step="1" value="${initial.xRes}" />
          </label>

          <label class="control">
            <div class="control-row">
              <span>Y Resolution</span>
              <input type="number" id="y-res-value" class="value-editor" min="8" max="48" step="1" value="${initial.yRes}" />
            </div>
            <input type="range" id="y-res" min="8" max="48" step="1" value="${initial.yRes}" />
          </label>

          <label class="control">
            <div class="control-row">
              <span>Z Resolution</span>
              <input type="number" id="z-res-value" class="value-editor" min="8" max="48" step="1" value="${initial.zRes}" />
            </div>
            <input type="range" id="z-res" min="8" max="48" step="1" value="${initial.zRes}" />
          </label>

          <label class="toggle-control toggle-control-stacked" for="show-boundary">
            <span>Show Boundary</span>
            <input type="checkbox" id="show-boundary" checked />
          </label>
        </div>
      </section>

      <section class="panel-section">
        <div class="panel-section-header">
          <span class="panel-section-label">Points</span>
        </div>
        <div class="panel-section-content panel-controls-stack">
          <div class="control-hint">LMB = Add Custom Point</div>
          <button type="button" id="clear-all" class="pill-button control-button-wide">Clear Custom Points</button>

          <label class="control">
            <div class="control-row">
              <span>Random Points</span>
              <input
                type="number"
                id="random-points-value"
                class="value-editor"
                min="0"
                max="200"
                step="1"
                value="${initial.randomPoints}"
              />
            </div>
            <input
              type="range"
              id="random-points"
              min="0"
              max="200"
              step="1"
              value="${initial.randomPoints}"
            />
          </label>

          <label class="control">
            <div class="control-row">
              <span>Random Seed</span>
              <input
                type="number"
                id="random-seed-value"
                class="value-editor"
                min="0"
                max="9999"
                step="1"
                value="${initial.randomSeed}"
              />
            </div>
            <input
              type="range"
              id="random-seed"
              min="0"
              max="9999"
              step="1"
              value="${initial.randomSeed}"
            />
          </label>

          <label class="toggle-control toggle-control-stacked" for="show-points">
            <span>Show Points</span>
            <input type="checkbox" id="show-points" checked />
          </label>
        </div>
      </section>

      <section class="panel-section">
        <div class="panel-section-header">
          <span class="panel-section-label">IsoSurface</span>
        </div>
        <div class="panel-section-content panel-controls-stack">
          <div class="control-hint">Shift+LMB = Cut IsoSurface</div>
          <button type="button" id="clear-cuts" class="pill-button control-button-wide">Clear IsoSurface Cuts</button>
          <label class="control">
            <div class="control-row">
              <span>IsoValue</span>
              <input
                type="number"
                id="iso-value-value"
                class="value-editor"
                min="0.05"
                max="3.0"
                step="0.01"
                value="${initial.isoValue.toFixed(2)}"
              />
            </div>
            <input type="range" id="iso-value" min="0.05" max="3.0" step="0.01" value="${initial.isoValue}" />
          </label>

          <label class="control">
            <div class="control-row">
              <span>Layers</span>
              <input type="number" id="amount-value" class="value-editor" min="1" max="20" step="1" value="${initial.amount}" />
            </div>
            <input type="range" id="amount" min="1" max="20" step="1" value="${initial.amount}" />
          </label>

          <label class="control">
            <div class="control-row">
              <span>Offset</span>
              <input
                type="number"
                id="offset-value"
                class="value-editor"
                min="0"
                max="1"
                step="0.01"
                value="${initial.offset.toFixed(2)}"
              />
            </div>
            <input type="range" id="offset" min="0" max="1" step="0.01" value="${initial.offset}" />
          </label>

          <label class="control">
            <div class="control-row">
              <span>Subdivision</span>
              <input
                type="number"
                id="subdivision-value"
                class="value-editor"
                min="0"
                max="3"
                step="1"
                value="${initial.subdivision}"
              />
            </div>
            <input type="range" id="subdivision" min="0" max="3" step="1" value="${initial.subdivision}" />
          </label>

          <label class="control">
            <div class="control-row">
              <span>Smoothing</span>
              <input
                type="number"
                id="smoothing-value"
                class="value-editor"
                min="0"
                max="3"
                step="1"
                value="${initial.smoothing}"
              />
            </div>
            <input type="range" id="smoothing" min="0" max="3" step="1" value="${initial.smoothing}" />
          </label>

          <label class="control">
            <div class="control-row">
              <span>Thickness</span>
              <input
                type="number"
                id="thickness-value"
                class="value-editor"
                min="0"
                max="0.2"
                step="0.005"
                value="${initial.thickness.toFixed(3)}"
              />
            </div>
            <input type="range" id="thickness" min="0" max="0.2" step="0.005" value="${initial.thickness}" />
          </label>

          <label class="toggle-control toggle-control-stacked" for="show-isosurface">
            <span>Show IsoSurface</span>
            <input type="checkbox" id="show-isosurface" checked />
          </label>
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
              <input
                type="number"
                id="fresnel-value"
                class="value-editor"
                min="0"
                max="2"
                step="0.01"
                value="${initial.fresnel.toFixed(2)}"
              />
            </div>
            <input type="range" id="fresnel" min="0" max="2" step="0.01" value="${initial.fresnel}" />
          </label>

          <label class="control">
            <div class="control-row">
              <span>Specular</span>
              <input
                type="number"
                id="specular-value"
                class="value-editor"
                min="0"
                max="2"
                step="0.01"
                value="${initial.specular.toFixed(2)}"
              />
            </div>
            <input type="range" id="specular" min="0" max="2" step="0.01" value="${initial.specular}" />
          </label>

          <label class="control">
            <div class="control-row">
              <span>Bloom</span>
              <input
                type="number"
                id="bloom-value"
                class="value-editor"
                min="0"
                max="2"
                step="0.01"
                value="${initial.bloom.toFixed(2)}"
              />
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
    startSim: requireIn(panel, '#start-sim'),
    resetSim: requireIn(panel, '#reset-sim'),
    simulationTimeline: requireIn(panel, '#simulation-timeline'),
    simulationTimelineValue: requireIn(panel, '#simulation-timeline-value'),
    simulationRate: requireIn(panel, '#simulation-rate'),
    sizeX: requireIn(panel, '#size-x'),
    sizeY: requireIn(panel, '#size-y'),
    sizeZ: requireIn(panel, '#size-z'),
    xRes: requireIn(panel, '#x-res'),
    yRes: requireIn(panel, '#y-res'),
    zRes: requireIn(panel, '#z-res'),
    isoValue: requireIn(panel, '#iso-value'),
    amount: requireIn(panel, '#amount'),
    offset: requireIn(panel, '#offset'),
    subdivision: requireIn(panel, '#subdivision'),
    smoothing: requireIn(panel, '#smoothing'),
    thickness: requireIn(panel, '#thickness'),
    showBoundary: requireIn(panel, '#show-boundary'),
    showIsoSurface: requireIn(panel, '#show-isosurface'),
    clearCuts: requireIn(panel, '#clear-cuts'),
    randomPoints: requireIn(panel, '#random-points'),
    randomSeed: requireIn(panel, '#random-seed'),
    showPoints: requireIn(panel, '#show-points'),
    sizeXValue: requireIn(panel, '#size-x-value'),
    sizeYValue: requireIn(panel, '#size-y-value'),
    sizeZValue: requireIn(panel, '#size-z-value'),
    xResValue: requireIn(panel, '#x-res-value'),
    yResValue: requireIn(panel, '#y-res-value'),
    zResValue: requireIn(panel, '#z-res-value'),
    isoValueValue: requireIn(panel, '#iso-value-value'),
    amountValue: requireIn(panel, '#amount-value'),
    offsetValue: requireIn(panel, '#offset-value'),
    subdivisionValue: requireIn(panel, '#subdivision-value'),
    smoothingValue: requireIn(panel, '#smoothing-value'),
    thicknessValue: requireIn(panel, '#thickness-value'),
    randomPointsValue: requireIn(panel, '#random-points-value'),
    randomSeedValue: requireIn(panel, '#random-seed-value'),
    simulationRateValue: requireIn(panel, '#simulation-rate-value'),
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

function clampAndSnapRangeValue(value, rangeInput) {
  const min = Number.parseFloat(rangeInput.min);
  const max = Number.parseFloat(rangeInput.max);
  const step = Number.parseFloat(rangeInput.step);
  let next = value;

  if (Number.isFinite(min)) {
    next = Math.max(min, next);
  }
  if (Number.isFinite(max)) {
    next = Math.min(max, next);
  }
  if (Number.isFinite(step) && step > 0) {
    const base = Number.isFinite(min) ? min : 0;
    next = base + Math.round((next - base) / step) * step;
  }
  if (Number.isFinite(min)) {
    next = Math.max(min, next);
  }
  if (Number.isFinite(max)) {
    next = Math.min(max, next);
  }

  return next;
}

function bindRange(input, valueEl, format, onInput) {
  const applyFromSlider = () => {
    const value = Number.parseFloat(input.value);
    valueEl.value = format(value);
    updateRangeProgress(input);
    onInput(value);
  };

  const commitFromField = () => {
    const parsed = Number.parseFloat(valueEl.value);
    if (!Number.isFinite(parsed)) {
      valueEl.value = format(Number.parseFloat(input.value));
      return;
    }

    const next = clampAndSnapRangeValue(parsed, input);
    input.value = `${next}`;
    applyFromSlider();
  };

  input.addEventListener('input', applyFromSlider);
  valueEl.addEventListener('change', commitFromField);
  valueEl.addEventListener('blur', commitFromField);
  valueEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      valueEl.blur();
    }
  });
  applyFromSlider();
}

const settings = {
  simulationRate: 1,
  sizeX: 2,
  sizeY: 2,
  sizeZ: 2,
  xRes: 15,
  yRes: 15,
  zRes: 15,
  isoValue: 0.55,
  amount: 4,
  offset: 0.2,
  subdivision: 1,
  smoothing: 2,
  thickness: 0.015,
  randomPoints: 6,
  randomSeed: 0,
  gradientStart: '#febee0',
  gradientEnd: '#7af0ff',
  fresnel: 0.1,
  specular: 0.42,
  bloom: 0,
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

const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.setMode('translate');
transformControls.setSpace('world');
transformControls.size = 0.43;
const transformHelper = transformControls.getHelper();
transformHelper.visible = false;
scene.add(transformHelper);

function axisIndexFromHandleName(name) {
  if (name === 'X') {
    return 0;
  }
  if (name === 'Y') {
    return 1;
  }
  if (name === 'Z') {
    return 2;
  }
  return -1;
}

function handleAxisCenter(handle, axisIndex) {
  const geometry = handle.geometry;
  if (!geometry || typeof geometry.computeBoundingBox !== 'function') {
    return 0;
  }

  if (!geometry.boundingBox) {
    geometry.computeBoundingBox();
  }

  const box = geometry.boundingBox;
  if (!box) {
    return 0;
  }

  if (axisIndex === 0) {
    return (box.min.x + box.max.x) * 0.5;
  }
  if (axisIndex === 1) {
    return (box.min.y + box.max.y) * 0.5;
  }
  return (box.min.z + box.max.z) * 0.5;
}

function handleAxisExtent(handle, axisIndex) {
  const geometry = handle.geometry;
  if (!geometry || typeof geometry.computeBoundingBox !== 'function') {
    return 0;
  }

  if (!geometry.boundingBox) {
    geometry.computeBoundingBox();
  }

  const box = geometry.boundingBox;
  if (!box) {
    return 0;
  }

  if (axisIndex === 0) {
    return box.max.x - box.min.x;
  }
  if (axisIndex === 1) {
    return box.max.y - box.min.y;
  }
  return box.max.z - box.min.z;
}

function pruneTranslateHandles(group, { keepPositiveOnly, arrowsOnly }) {
  const removeByName = new Set(['XY', 'YZ', 'XZ', 'XYZ', 'XYZE', 'E', 'AXIS', 'START', 'END', 'DELTA']);

  for (const child of [...group.children]) {
    if (removeByName.has(child.name)) {
      group.remove(child);
      continue;
    }

    const axisIndex = axisIndexFromHandleName(child.name);
    if (axisIndex === -1) {
      continue;
    }

    const center = handleAxisCenter(child, axisIndex);
    if (keepPositiveOnly && center < -1e-5) {
      group.remove(child);
      continue;
    }

    if (arrowsOnly) {
      const extent = handleAxisExtent(child, axisIndex);
      if (extent > 0.26) {
        group.remove(child);
      }
    }
  }
}

function configureTransformControlsVisuals() {
  const gizmo = transformControls._gizmo;
  if (!gizmo) {
    return;
  }

  const translateGizmo = gizmo.gizmo?.translate;
  if (translateGizmo) {
    pruneTranslateHandles(translateGizmo, {
      keepPositiveOnly: true,
      arrowsOnly: false,
    });
  }

  const translatePicker = gizmo.picker?.translate;
  if (translatePicker) {
    pruneTranslateHandles(translatePicker, {
      keepPositiveOnly: true,
      arrowsOnly: false,
    });
  }

  const translateHelper = gizmo.helper?.translate;
  if (translateHelper) {
    for (const child of [...translateHelper.children]) {
      translateHelper.remove(child);
    }
  }
}

configureTransformControlsVisuals();

let isTransformDragging = false;
let isPointerOverGizmo = false;
let selectedPointIndex = -1;
let transformDragStartPoint = null;
transformControls.addEventListener('dragging-changed', (event) => {
  isTransformDragging = Boolean(event.value);
  controls.enabled = !event.value;
  if (event.value) {
    pointerDown = null;
    if (selectedPointIndex >= 0 && selectedPointIndex < userPoints.length) {
      transformDragStartPoint = userPoints[selectedPointIndex].clone();
    } else {
      transformDragStartPoint = null;
    }
  } else {
    scheduleRebuild();
    if (
      transformDragStartPoint instanceof THREE.Vector3 &&
      selectedPointIndex >= 0 &&
      selectedPointIndex < userPoints.length
    ) {
      const movedPoint = userPoints[selectedPointIndex];
      if (movedPoint.distanceToSquared(transformDragStartPoint) > 1e-12) {
        pushUndoState();
      }
    }
    transformDragStartPoint = null;
  }
});
transformControls.addEventListener('hoveron', () => {
  isPointerOverGizmo = true;
});
transformControls.addEventListener('hoveroff', () => {
  isPointerOverGizmo = false;
});

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
  min: new THREE.Vector3(),
  max: new THREE.Vector3(),
};
const boxCenter = new THREE.Vector3();
const simulationBoundsScale = 1.25;
const simulationBounds = {
  min: new THREE.Vector3(),
  max: new THREE.Vector3(),
};

const boxGeometry = new THREE.BoxGeometry(2, 2, 2);
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

function updateDomainBounds() {
  const halfX = settings.sizeX * 0.5;
  const halfY = settings.sizeY * 0.5;
  const halfZ = settings.sizeZ * 0.5;

  bounds.min.set(-halfX, -halfY, -halfZ);
  bounds.max.set(halfX, halfY, halfZ);
  boxCenter.addVectors(bounds.min, bounds.max).multiplyScalar(0.5);

  simulationBounds.min.copy(bounds.min).sub(boxCenter).multiplyScalar(simulationBoundsScale).add(boxCenter);
  simulationBounds.max.copy(bounds.max).sub(boxCenter).multiplyScalar(simulationBoundsScale).add(boxCenter);

  boxEdges.scale.set(halfX, halfY, halfZ);
  raycastBox.scale.set(halfX, halfY, halfZ);
  boxEdges.updateMatrixWorld(true);
  raycastBox.updateMatrixWorld(true);
}

updateDomainBounds();

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

const userPoints = [];
const generatedPoints = [];
const pointGroup = new THREE.Group();
const generatedPointGroup = new THREE.Group();
scene.add(pointGroup);
scene.add(generatedPointGroup);

const pointGeometry = new THREE.SphereGeometry(0.045, 16, 12);
const pointMaterial = new THREE.MeshStandardMaterial({
  color: 0xe37200,
  emissive: 0xb53a00,
  emissiveIntensity: 0.78,
  roughness: 0.38,
  metalness: 0.12,
});
const generatedPointGeometry = new THREE.SphereGeometry(0.0225, 14, 10);
const generatedPointMaterial = new THREE.MeshStandardMaterial({
  color: 0xa94ce1,
  emissive: 0x5110a4,
  emissiveIntensity: 0.72,
  roughness: 0.5,
  metalness: 0.05,
});
const selectedPointMaterial = new THREE.MeshStandardMaterial({
  color: 0xff8a00,
  emissive: 0xff4a00,
  emissiveIntensity: 0.95,
  roughness: 0.38,
  metalness: 0.12,
});

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const projectedPoint = new THREE.Vector3();

let pointerDown = null;
const clickMoveThresholdSq = 64;
const sigma = 0.22;
let rebuildTimer = null;
let realtimeRebuildRequested = false;
const activeCutPlanes = [];
let cutGesture = null;

const cutLineGeometry = new LineGeometry();
cutLineGeometry.setPositions([0, 0, 0, 0, 0, 0]);
const cutLineMaterial = new LineMaterial({
  color: 0xffffff,
  linewidth: 4.2,
  transparent: true,
  opacity: 0.96,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
});
cutLineMaterial.resolution.set(window.innerWidth, window.innerHeight);
const cutLine = new Line2(cutLineGeometry, cutLineMaterial);
cutLine.computeLineDistances();
cutLine.visible = false;
cutLine.renderOrder = 90;
scene.add(cutLine);

const CLIP_EPSILON = 1e-5;
const CUT_MIN_LINE_LENGTH_SQ = 1e-6;
const triangleEdgeA = new THREE.Vector3();
const triangleEdgeB = new THREE.Vector3();
const triangleEdgeCross = new THREE.Vector3();
const cutBoundsCorner = new THREE.Vector3();
const cutDrawPlane = new THREE.Plane();
const cutDrawPoint = new THREE.Vector3();
const cutCameraDirection = new THREE.Vector3();

const simulationState = {
  running: false,
  elapsed: 0,
  maxElapsed: 0,
  lastFrameMs: performance.now(),
  entries: [],
};
const simulationOffset = new THREE.Vector3();
const simulationPosition = new THREE.Vector3();
const simulationBoundsPadding = 0.001;
const SIMULATION_TIMELINE_FPS = 60;

function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampPointToVolumeBounds(point, targetBounds, padding = 0) {
  const minX = targetBounds.min.x + padding;
  const maxX = targetBounds.max.x - padding;
  const minY = targetBounds.min.y + padding;
  const maxY = targetBounds.max.y - padding;
  const minZ = targetBounds.min.z + padding;
  const maxZ = targetBounds.max.z - padding;

  point.x = THREE.MathUtils.clamp(point.x, minX, maxX);
  point.y = THREE.MathUtils.clamp(point.y, minY, maxY);
  point.z = THREE.MathUtils.clamp(point.z, minZ, maxZ);
}

function regenerateGeneratedPoints() {
  generatedPoints.length = 0;
  generatedPointGroup.clear();

  const count = Math.max(0, Math.floor(settings.randomPoints));
  if (count <= 0) {
    invalidateSimulationSession();
    return;
  }

  const rng = createSeededRandom(Math.floor(settings.randomSeed));
  const spanX = bounds.max.x - bounds.min.x;
  const spanY = bounds.max.y - bounds.min.y;
  const spanZ = bounds.max.z - bounds.min.z;

  for (let i = 0; i < count; i += 1) {
    const point = new THREE.Vector3(
      bounds.min.x + rng() * spanX,
      bounds.min.y + rng() * spanY,
      bounds.min.z + rng() * spanZ,
    );
    generatedPoints.push(point);

    const marker = new THREE.Mesh(generatedPointGeometry, generatedPointMaterial);
    marker.position.copy(point);
    generatedPointGroup.add(marker);
  }

  invalidateSimulationSession();
}

function syncPointCount() {
  settings.pointCount = userPoints.length + generatedPoints.length;
  updatePointCountLabel();
}

const undoStack = [];
const redoStack = [];
const HISTORY_MAX_ENTRIES = 200;
let applyingHistoryState = false;

function cloneHistoryState(state) {
  return {
    userPoints: state.userPoints.map((point) => [point[0], point[1], point[2]]),
    cutPlanes: state.cutPlanes.map((cut) => ({
      normal: [cut.normal[0], cut.normal[1], cut.normal[2]],
      constant: cut.constant,
      keepSign: cut.keepSign,
    })),
  };
}

function captureHistoryState() {
  return {
    userPoints: userPoints.map((point) => [point.x, point.y, point.z]),
    cutPlanes: activeCutPlanes.map((cut) => ({
      normal: [cut.plane.normal.x, cut.plane.normal.y, cut.plane.normal.z],
      constant: cut.plane.constant,
      keepSign: cut.keepSign,
    })),
  };
}

function historyStatesEqual(a, b) {
  if (a.userPoints.length !== b.userPoints.length || a.cutPlanes.length !== b.cutPlanes.length) {
    return false;
  }

  for (let i = 0; i < a.userPoints.length; i += 1) {
    const pa = a.userPoints[i];
    const pb = b.userPoints[i];
    if (Math.abs(pa[0] - pb[0]) > 1e-9 || Math.abs(pa[1] - pb[1]) > 1e-9 || Math.abs(pa[2] - pb[2]) > 1e-9) {
      return false;
    }
  }

  for (let i = 0; i < a.cutPlanes.length; i += 1) {
    const ca = a.cutPlanes[i];
    const cb = b.cutPlanes[i];
    if (
      Math.abs(ca.normal[0] - cb.normal[0]) > 1e-9 ||
      Math.abs(ca.normal[1] - cb.normal[1]) > 1e-9 ||
      Math.abs(ca.normal[2] - cb.normal[2]) > 1e-9 ||
      Math.abs(ca.constant - cb.constant) > 1e-9 ||
      ca.keepSign !== cb.keepSign
    ) {
      return false;
    }
  }

  return true;
}

function pushUndoState() {
  if (applyingHistoryState) {
    return;
  }

  const next = captureHistoryState();
  const last = undoStack.length > 0 ? undoStack[undoStack.length - 1] : null;
  if (last && historyStatesEqual(last, next)) {
    return;
  }

  undoStack.push(next);
  if (undoStack.length > HISTORY_MAX_ENTRIES) {
    undoStack.shift();
  }
  redoStack.length = 0;
}

function applyHistoryState(state) {
  applyingHistoryState = true;
  try {
    clearPointSelection();

    userPoints.length = 0;
    pointGroup.clear();
    for (let i = 0; i < state.userPoints.length; i += 1) {
      const pointData = state.userPoints[i];
      const point = new THREE.Vector3(pointData[0], pointData[1], pointData[2]);
      clampPointToVolumeBounds(point, bounds, 0);
      userPoints.push(point);

      const marker = new THREE.Mesh(pointGeometry, pointMaterial);
      marker.position.copy(point);
      marker.userData.pointIndex = i;
      pointGroup.add(marker);
    }

    activeCutPlanes.length = 0;
    for (let i = 0; i < state.cutPlanes.length; i += 1) {
      const cutData = state.cutPlanes[i];
      const plane = new THREE.Plane(
        new THREE.Vector3(cutData.normal[0], cutData.normal[1], cutData.normal[2]),
        cutData.constant,
      );
      activeCutPlanes.push({
        plane,
        keepSign: cutData.keepSign,
      });
    }

    cutGesture = null;
    clearCutPreviewLine();
    refreshPointMarkerMaterials();
    syncPointCount();

    if (simulationState.running) {
      rebuildSimulationEntries();
      applySimulationAtCurrentElapsed();
      updateSimulationTimelineUi();
    } else {
      invalidateSimulationSession();
    }

    rebuildNow();
  } finally {
    applyingHistoryState = false;
  }
}

function undoHistory() {
  if (undoStack.length <= 1) {
    return;
  }

  const current = undoStack.pop();
  if (current) {
    redoStack.push(cloneHistoryState(current));
  }

  const previous = undoStack[undoStack.length - 1];
  if (!previous) {
    return;
  }
  applyHistoryState(previous);
}

function redoHistory() {
  if (redoStack.length === 0) {
    return;
  }

  const next = redoStack.pop();
  if (!next) {
    return;
  }
  undoStack.push(cloneHistoryState(next));
  applyHistoryState(next);
}

function applyGridSizeSettings({ regenerateRandom = true } = {}) {
  updateDomainBounds();

  for (let i = 0; i < userPoints.length; i += 1) {
    const point = userPoints[i];
    clampPointToVolumeBounds(point, bounds, 0);
    const marker = pointGroup.children[i];
    if (marker instanceof THREE.Object3D) {
      marker.position.copy(point);
    }
  }

  if (regenerateRandom && settings.randomPoints > 0) {
    regenerateGeneratedPoints();
  } else {
    for (let i = 0; i < generatedPoints.length; i += 1) {
      const point = generatedPoints[i];
      clampPointToVolumeBounds(point, bounds, 0);
      const marker = generatedPointGroup.children[i];
      if (marker instanceof THREE.Object3D) {
        marker.position.copy(point);
      }
    }
  }

  if (simulationState.running) {
    rebuildSimulationEntries();
    applySimulationAtCurrentElapsed();
    updateSimulationTimelineUi();
  } else {
    invalidateSimulationSession();
  }
}

function refreshPointMarkerMaterials() {
  for (let i = 0; i < pointGroup.children.length; i += 1) {
    const marker = pointGroup.children[i];
    if (!(marker instanceof THREE.Mesh)) {
      continue;
    }

    marker.material = i === selectedPointIndex ? selectedPointMaterial : pointMaterial;
  }
}

function clearPointSelection() {
  selectedPointIndex = -1;
  transformControls.detach();
  transformHelper.visible = false;
  refreshPointMarkerMaterials();
}

function selectPointByIndex(index) {
  if (index < 0 || index >= pointGroup.children.length) {
    clearPointSelection();
    return false;
  }

  const marker = pointGroup.children[index];
  if (!(marker instanceof THREE.Object3D)) {
    clearPointSelection();
    return false;
  }

  selectedPointIndex = index;
  transformControls.attach(marker);
  transformHelper.visible = true;
  refreshPointMarkerMaterials();
  return true;
}

function syncSelectedPointFromMarker() {
  if (selectedPointIndex < 0 || selectedPointIndex >= userPoints.length) {
    return;
  }

  const marker = pointGroup.children[selectedPointIndex];
  if (!(marker instanceof THREE.Object3D)) {
    return;
  }

  userPoints[selectedPointIndex].copy(marker.position);
  if (!simulationState.running) {
    invalidateSimulationSession();
  }
  if (isTransformDragging) {
    realtimeRebuildRequested = true;
  } else {
    scheduleRebuild();
  }
}

transformControls.addEventListener('objectChange', syncSelectedPointFromMarker);

function updatePointCountLabel() {
  void settings.pointCount;
}

function setPointEditingLocked(locked) {
  ui.clearAll.disabled = locked;
  ui.randomPoints.disabled = locked;
  ui.randomPointsValue.disabled = locked;
  ui.randomSeed.disabled = locked;
  ui.randomSeedValue.disabled = locked;
}

function updateSimulationButtonState() {
  if (simulationState.running) {
    ui.startSim.textContent = 'Pause';
    ui.startSim.classList.remove('is-start-state');
    ui.startSim.classList.add('is-stop-state');
  } else {
    ui.startSim.textContent = 'Start';
    ui.startSim.classList.remove('is-stop-state');
    ui.startSim.classList.add('is-start-state');
  }
}

function updateSimulationTimelineUi() {
  const maxFrames = Math.max(1, Math.ceil(simulationState.maxElapsed * SIMULATION_TIMELINE_FPS));
  const frame = Math.round(
    THREE.MathUtils.clamp(simulationState.elapsed, 0, Math.max(simulationState.maxElapsed, 0)) * SIMULATION_TIMELINE_FPS,
  );
  ui.simulationTimeline.max = `${maxFrames}`;
  ui.simulationTimeline.value = `${THREE.MathUtils.clamp(frame, 0, maxFrames)}`;
  ui.simulationTimeline.disabled = simulationState.running || simulationState.entries.length === 0;
  ui.simulationTimelineValue.textContent = `${THREE.MathUtils.clamp(frame, 0, maxFrames)}`;
  updateRangeProgress(ui.simulationTimeline);
}

function randomUnitVector() {
  const vector = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
  if (vector.lengthSq() < 1e-6) {
    vector.set(1, 0, 0);
  }
  return vector.normalize();
}

function clampPointToBounds(point) {
  clampPointToVolumeBounds(point, simulationBounds, simulationBoundsPadding);
}

function computeTravelBudget(value, min, max) {
  const innerMin = min + simulationBoundsPadding;
  const innerMax = max - simulationBoundsPadding;
  return Math.max(0, Math.min(value - innerMin, innerMax - value));
}

function createSimulationOrbitEntry(pointRef, marker) {
  const normal = randomUnitVector();
  let tangentA = randomUnitVector();
  if (Math.abs(normal.dot(tangentA)) > 0.92) {
    tangentA = new THREE.Vector3(normal.y, normal.z, normal.x).normalize();
  }
  tangentA.addScaledVector(normal, -normal.dot(tangentA)).normalize();
  const tangentB = new THREE.Vector3().crossVectors(normal, tangentA).normalize();

  const travelBudgetX = computeTravelBudget(pointRef.x, simulationBounds.min.x, simulationBounds.max.x);
  const travelBudgetY = computeTravelBudget(pointRef.y, simulationBounds.min.y, simulationBounds.max.y);
  const travelBudgetZ = computeTravelBudget(pointRef.z, simulationBounds.min.z, simulationBounds.max.z);
  const minTravelBudget = Math.max(0.05, Math.min(travelBudgetX, travelBudgetY, travelBudgetZ));

  const localOrbitScale = THREE.MathUtils.clamp(minTravelBudget * 0.58, 0.06, 0.34);
  const radiusA = localOrbitScale * (0.75 + Math.random() * 0.7);
  const radiusB = localOrbitScale * (0.75 + Math.random() * 0.7);
  const freqA = 0.8 + Math.random() * 1.35;
  const freqB = 0.7 + Math.random() * 1.2;
  const phaseA = Math.random() * Math.PI * 2;
  const phaseB = Math.random() * Math.PI * 2;

  const driftAmplitude = new THREE.Vector3(
    travelBudgetX > 0.02 ? travelBudgetX * (0.72 + Math.random() * 0.42) : 0,
    travelBudgetY > 0.02 ? travelBudgetY * (0.72 + Math.random() * 0.42) : 0,
    travelBudgetZ > 0.02 ? travelBudgetZ * (0.72 + Math.random() * 0.42) : 0,
  );
  const driftFrequency = new THREE.Vector3(
    0.13 + Math.random() * 0.35,
    0.12 + Math.random() * 0.38,
    0.11 + Math.random() * 0.34,
  );
  const driftPhase = new THREE.Vector3(
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
  );

  const initialLocalA = Math.sin(phaseA) * radiusA;
  const initialLocalB = Math.sin(phaseB) * radiusB;
  const initialDrift = new THREE.Vector3(
    Math.sin(driftPhase.x) * driftAmplitude.x,
    Math.sin(driftPhase.y) * driftAmplitude.y,
    Math.sin(driftPhase.z) * driftAmplitude.z,
  );

  return {
    pointRef,
    marker,
    basePosition: pointRef.clone(),
    axisA: tangentA,
    axisB: tangentB,
    radiusA,
    radiusB,
    freqA,
    freqB,
    phaseA,
    phaseB,
    initialLocalA,
    initialLocalB,
    driftAmplitude,
    driftFrequency,
    driftPhase,
    initialDrift,
  };
}

function invalidateSimulationSession() {
  if (simulationState.running || simulationState.entries.length === 0) {
    return;
  }

  simulationState.entries = [];
  simulationState.elapsed = 0;
  simulationState.maxElapsed = 0;
  updateSimulationTimelineUi();
}

function rebuildSimulationEntries() {
  simulationState.entries = [];

  for (let i = 0; i < userPoints.length; i += 1) {
    const marker = pointGroup.children[i] instanceof THREE.Object3D ? pointGroup.children[i] : null;
    simulationState.entries.push(createSimulationOrbitEntry(userPoints[i], marker));
  }

  for (let i = 0; i < generatedPoints.length; i += 1) {
    const marker = generatedPointGroup.children[i] instanceof THREE.Object3D ? generatedPointGroup.children[i] : null;
    simulationState.entries.push(createSimulationOrbitEntry(generatedPoints[i], marker));
  }
}

function applySimulationAtCurrentElapsed() {
  if (simulationState.entries.length === 0) {
    return;
  }

  for (let i = 0; i < simulationState.entries.length; i += 1) {
    const entry = simulationState.entries[i];
    const offsetA =
      Math.sin(simulationState.elapsed * entry.freqA + entry.phaseA) * entry.radiusA - entry.initialLocalA;
    const offsetB =
      Math.sin(simulationState.elapsed * entry.freqB + entry.phaseB) * entry.radiusB - entry.initialLocalB;

    simulationOffset.copy(entry.axisA).multiplyScalar(offsetA);
    simulationOffset.addScaledVector(entry.axisB, offsetB);

    simulationPosition.copy(entry.basePosition).add(simulationOffset);
    simulationPosition.x +=
      Math.sin(simulationState.elapsed * entry.driftFrequency.x + entry.driftPhase.x) * entry.driftAmplitude.x -
      entry.initialDrift.x;
    simulationPosition.y +=
      Math.sin(simulationState.elapsed * entry.driftFrequency.y + entry.driftPhase.y) * entry.driftAmplitude.y -
      entry.initialDrift.y;
    simulationPosition.z +=
      Math.sin(simulationState.elapsed * entry.driftFrequency.z + entry.driftPhase.z) * entry.driftAmplitude.z -
      entry.initialDrift.z;
    clampPointToBounds(simulationPosition);

    entry.pointRef.copy(simulationPosition);
    if (entry.marker instanceof THREE.Object3D) {
      entry.marker.position.copy(simulationPosition);
    }
  }

  realtimeRebuildRequested = true;
}

function resetSimulationToBasePositions() {
  for (let i = 0; i < simulationState.entries.length; i += 1) {
    const entry = simulationState.entries[i];
    entry.pointRef.copy(entry.basePosition);
    if (entry.marker instanceof THREE.Object3D) {
      entry.marker.position.copy(entry.basePosition);
    }
  }
  realtimeRebuildRequested = true;
}

function setSimulationRunning(nextRunning) {
  if (simulationState.running === nextRunning) {
    return;
  }

  simulationState.running = nextRunning;
  simulationState.lastFrameMs = performance.now();

  if (nextRunning) {
    clearPointSelection();
    transformControls.enabled = false;
    if (simulationState.entries.length === 0) {
      rebuildSimulationEntries();
      simulationState.elapsed = 0;
      simulationState.maxElapsed = 0;
      applySimulationAtCurrentElapsed();
    }
  } else {
    transformControls.enabled = true;
  }

  setPointEditingLocked(nextRunning);
  updateSimulationButtonState();
  updateSimulationTimelineUi();
}

function stepSimulation(deltaSeconds) {
  if (!simulationState.running) {
    return;
  }

  const scaledDelta = Math.max(0, deltaSeconds) * settings.simulationRate;
  if (scaledDelta <= 0) {
    return;
  }

  simulationState.elapsed += scaledDelta;
  simulationState.maxElapsed = Math.max(simulationState.maxElapsed, simulationState.elapsed);
  if (simulationState.entries.length === 0) {
    updateSimulationTimelineUi();
    return;
  }

  applySimulationAtCurrentElapsed();
  updateSimulationTimelineUi();
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

function computeTriangleAreaSquared(a, b, c) {
  triangleEdgeA.subVectors(b, a);
  triangleEdgeB.subVectors(c, a);
  triangleEdgeCross.crossVectors(triangleEdgeA, triangleEdgeB);
  return triangleEdgeCross.lengthSq() * 0.25;
}

function weldAndSmoothGeometry(geometry, tolerance = 1e-5) {
  if (!(geometry instanceof THREE.BufferGeometry)) {
    return geometry;
  }

  const mergedGeometry = mergeVertices(geometry, tolerance);
  if (mergedGeometry !== geometry) {
    geometry.dispose();
  }

  mergedGeometry.computeVertexNormals();
  mergedGeometry.computeBoundingBox();
  mergedGeometry.computeBoundingSphere();
  return mergedGeometry;
}

function addThicknessToGeometry(geometry, thickness) {
  if (!(geometry instanceof THREE.BufferGeometry) || thickness <= 1e-6) {
    return geometry;
  }

  const source = mergeVertices(geometry, 1e-5);
  const sourcePosition = source.getAttribute('position');
  if (!(sourcePosition instanceof THREE.BufferAttribute) || sourcePosition.count < 3) {
    if (source !== geometry) {
      source.dispose();
    }
    return geometry;
  }

  source.computeVertexNormals();
  const sourceNormal = source.getAttribute('normal');
  if (!(sourceNormal instanceof THREE.BufferAttribute)) {
    if (source !== geometry) {
      source.dispose();
    }
    return geometry;
  }

  const vertexCount = sourcePosition.count;
  const totalVertexCount = vertexCount * 2;
  const halfThickness = thickness * 0.5;
  const thickPositions = new Float32Array(totalVertexCount * 3);

  for (let i = 0; i < vertexCount; i += 1) {
    const px = sourcePosition.getX(i);
    const py = sourcePosition.getY(i);
    const pz = sourcePosition.getZ(i);
    const nx = sourceNormal.getX(i);
    const ny = sourceNormal.getY(i);
    const nz = sourceNormal.getZ(i);
    const outerBase = i * 3;
    const innerBase = (i + vertexCount) * 3;

    thickPositions[outerBase] = px + nx * halfThickness;
    thickPositions[outerBase + 1] = py + ny * halfThickness;
    thickPositions[outerBase + 2] = pz + nz * halfThickness;

    thickPositions[innerBase] = px - nx * halfThickness;
    thickPositions[innerBase + 1] = py - ny * halfThickness;
    thickPositions[innerBase + 2] = pz - nz * halfThickness;
  }

  const sourceIndex = source.getIndex();
  let sourceIndices;
  if (sourceIndex) {
    sourceIndices = sourceIndex.array;
  } else {
    sourceIndices = new Uint32Array(sourcePosition.count);
    for (let i = 0; i < sourcePosition.count; i += 1) {
      sourceIndices[i] = i;
    }
  }

  const thickIndices = [];
  const boundaryEdges = new Map();
  const addBoundaryEdge = (from, to) => {
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    const key = `${low}:${high}`;
    const existing = boundaryEdges.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }
    boundaryEdges.set(key, { from, to, count: 1 });
  };

  for (let i = 0; i < sourceIndices.length; i += 3) {
    const a = sourceIndices[i];
    const b = sourceIndices[i + 1];
    const c = sourceIndices[i + 2];

    thickIndices.push(a, b, c);
    thickIndices.push(c + vertexCount, b + vertexCount, a + vertexCount);

    addBoundaryEdge(a, b);
    addBoundaryEdge(b, c);
    addBoundaryEdge(c, a);
  }

  for (const edge of boundaryEdges.values()) {
    if (edge.count !== 1) {
      continue;
    }

    const outerA = edge.from;
    const outerB = edge.to;
    const innerA = edge.from + vertexCount;
    const innerB = edge.to + vertexCount;

    // Boundary quads must face outward; this winding keeps shell normals consistent.
    thickIndices.push(outerA, innerB, outerB);
    thickIndices.push(outerA, innerA, innerB);
  }

  const thickGeometry = new THREE.BufferGeometry();
  thickGeometry.setAttribute('position', new THREE.Float32BufferAttribute(thickPositions, 3));
  const indexArray =
    totalVertexCount > 65535 ? new Uint32Array(thickIndices) : new Uint16Array(thickIndices);
  thickGeometry.setIndex(new THREE.BufferAttribute(indexArray, 1));
  thickGeometry.computeVertexNormals();
  thickGeometry.computeBoundingBox();
  thickGeometry.computeBoundingSphere();

  if (source !== geometry) {
    source.dispose();
  }

  return thickGeometry;
}

function intersectCutEdge(a, b, distA, distB) {
  const denominator = distA - distB;
  let t = 0.5;
  if (Math.abs(denominator) > 1e-8) {
    t = distA / denominator;
  }
  t = THREE.MathUtils.clamp(t, 0, 1);
  return a.clone().lerp(b, t);
}

function clipTriangleByPlaneHalfspace(a, b, c, plane, keepSign) {
  const input = [a.clone(), b.clone(), c.clone()];
  const output = [];

  for (let i = 0; i < input.length; i += 1) {
    const current = input[i];
    const next = input[(i + 1) % input.length];
    const currentDist = plane.distanceToPoint(current) * keepSign;
    const nextDist = plane.distanceToPoint(next) * keepSign;
    const currentInside = currentDist >= -CLIP_EPSILON;
    const nextInside = nextDist >= -CLIP_EPSILON;

    if (currentInside && nextInside) {
      output.push(next.clone());
    } else if (currentInside && !nextInside) {
      output.push(intersectCutEdge(current, next, currentDist, nextDist));
    } else if (!currentInside && nextInside) {
      output.push(intersectCutEdge(current, next, currentDist, nextDist));
      output.push(next.clone());
    }
  }

  return output;
}

function classifyBoundingBoxAgainstCutPlane(box, plane, keepSign) {
  let sawInside = false;
  let sawOutside = false;

  for (let ix = 0; ix <= 1; ix += 1) {
    const x = ix === 0 ? box.min.x : box.max.x;
    for (let iy = 0; iy <= 1; iy += 1) {
      const y = iy === 0 ? box.min.y : box.max.y;
      for (let iz = 0; iz <= 1; iz += 1) {
        const z = iz === 0 ? box.min.z : box.max.z;
        cutBoundsCorner.set(x, y, z);
        const signedDistance = plane.distanceToPoint(cutBoundsCorner) * keepSign;
        if (signedDistance >= -CLIP_EPSILON) {
          sawInside = true;
        } else {
          sawOutside = true;
        }

        if (sawInside && sawOutside) {
          return 0;
        }
      }
    }
  }

  if (sawInside) {
    return 1;
  }
  return -1;
}

function clipGeometryByCutPlane(geometry, cutPlaneState) {
  if (!cutPlaneState || !(geometry instanceof THREE.BufferGeometry)) {
    return geometry;
  }

  const { plane, keepSign } = cutPlaneState;
  if (!geometry.boundingBox) {
    geometry.computeBoundingBox();
  }
  if (geometry.boundingBox) {
    const classification = classifyBoundingBoxAgainstCutPlane(geometry.boundingBox, plane, keepSign);
    if (classification > 0) {
      return geometry;
    }
    if (classification < 0) {
      return null;
    }
  }

  const position = geometry.getAttribute('position');
  if (!(position instanceof THREE.BufferAttribute) || position.count < 3) {
    return null;
  }

  const index = geometry.getIndex();
  const clippedPositions = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
  for (let tri = 0; tri < triangleCount; tri += 1) {
    const base = tri * 3;
    const aIndex = index ? index.getX(base) : base;
    const bIndex = index ? index.getX(base + 1) : base + 1;
    const cIndex = index ? index.getX(base + 2) : base + 2;

    a.fromBufferAttribute(position, aIndex);
    b.fromBufferAttribute(position, bIndex);
    c.fromBufferAttribute(position, cIndex);

    const polygon = clipTriangleByPlaneHalfspace(a, b, c, plane, keepSign);
    if (polygon.length < 3) {
      continue;
    }

    for (let i = 1; i < polygon.length - 1; i += 1) {
      const v0 = polygon[0];
      const v1 = polygon[i];
      const v2 = polygon[i + 1];
      if (computeTriangleAreaSquared(v0, v1, v2) <= 1e-12) {
        continue;
      }

      clippedPositions.push(
        v0.x,
        v0.y,
        v0.z,
        v1.x,
        v1.y,
        v1.z,
        v2.x,
        v2.y,
        v2.z,
      );
    }
  }

  if (clippedPositions.length === 0) {
    return null;
  }

  const clippedGeometry = new THREE.BufferGeometry();
  clippedGeometry.setAttribute('position', new THREE.Float32BufferAttribute(clippedPositions, 3));
  return weldAndSmoothGeometry(clippedGeometry);
}

function rebuildIsosurfaces() {
  clearIsosurfaceMeshes();
  const allPoints = userPoints.concat(generatedPoints);

  const surfaces = generateIsosurfaces({
    bounds,
    resolution: {
      x: settings.xRes,
      y: settings.yRes,
      z: settings.zRes,
    },
    isoValue: settings.isoValue,
    points: allPoints,
    sigma,
    amount: settings.amount,
    offset: settings.offset,
    smoothing: settings.smoothing,
  });

  for (let i = 0; i < surfaces.length; i += 1) {
    let renderGeometry = surfaces[i].geometry;

    for (let cutIndex = 0; cutIndex < activeCutPlanes.length; cutIndex += 1) {
      const clipped = clipGeometryByCutPlane(renderGeometry, activeCutPlanes[cutIndex]);
      if (clipped !== renderGeometry) {
        renderGeometry.dispose();
      }

      if (!(clipped instanceof THREE.BufferGeometry)) {
        renderGeometry = null;
        break;
      }

      renderGeometry = clipped;
    }

    if (!(renderGeometry instanceof THREE.BufferGeometry)) {
      continue;
    }

    if (settings.subdivision > 0) {
      const subdivided = subdivideCatmullClark(renderGeometry, settings.subdivision);
      if (subdivided !== renderGeometry) {
        renderGeometry.dispose();
        renderGeometry = subdivided;
      }
    }

    const thickened = addThicknessToGeometry(renderGeometry, settings.thickness);
    if (thickened !== renderGeometry) {
      renderGeometry.dispose();
      renderGeometry = thickened;
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

function rebuildNow() {
  if (rebuildTimer !== null) {
    clearTimeout(rebuildTimer);
    rebuildTimer = null;
  }

  rebuildIsosurfaces();
}

function flushPendingIsosurfaceRebuild() {
  if (rebuildTimer === null && !realtimeRebuildRequested) {
    return;
  }

  realtimeRebuildRequested = false;
  rebuildNow();
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

function ensureColorAttribute(geometry, fallbackColor) {
  const position = geometry.getAttribute('position');
  if (!(position instanceof THREE.BufferAttribute)) {
    return;
  }

  const existingColor = geometry.getAttribute('color');
  if (existingColor instanceof THREE.BufferAttribute && existingColor.itemSize === 3 && existingColor.count === position.count) {
    return;
  }

  const count = position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const base = i * 3;
    colors[base] = fallbackColor.r;
    colors[base + 1] = fallbackColor.g;
    colors[base + 2] = fallbackColor.b;
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}

function buildExportGroup() {
  const group = new THREE.Group();
  const ownedGeometries = [];
  const ownedMaterials = [];

  for (const child of isoGroup.children) {
    if (!(child instanceof THREE.Mesh) || !(child.geometry instanceof THREE.BufferGeometry)) {
      continue;
    }

    const baseColor = getMeshBaseColor(child);
    const geometry = child.geometry.clone();
    ensureColorAttribute(geometry, baseColor);
    geometry.applyMatrix4(child.matrixWorld);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
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
  flushPendingIsosurfaceRebuild();
  if (isoGroup.children.length === 0) {
    return;
  }

  const lines = [
    '# Scalar Isosurface OBJ export',
    '# Vertex colors are encoded as: v x y z r g b',
  ];
  let vertexOffset = 1;

  const worldPosition = new THREE.Vector3();
  const worldNormal = new THREE.Vector3();
  const fallbackColor = new THREE.Color();
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

    const colorAttr = mesh.geometry.getAttribute('color');
    const hasVertexColor =
      colorAttr instanceof THREE.BufferAttribute &&
      colorAttr.itemSize === 3 &&
      colorAttr.count === position.count;
    fallbackColor.copy(getMeshBaseColor(mesh));

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
      const r = hasVertexColor ? THREE.MathUtils.clamp(colorAttr.getX(i), 0, 1) : fallbackColor.r;
      const g = hasVertexColor ? THREE.MathUtils.clamp(colorAttr.getY(i), 0, 1) : fallbackColor.g;
      const b = hasVertexColor ? THREE.MathUtils.clamp(colorAttr.getZ(i), 0, 1) : fallbackColor.b;
      lines.push(
        `v ${worldPosition.x.toFixed(6)} ${worldPosition.y.toFixed(6)} ${worldPosition.z.toFixed(6)} ${r.toFixed(6)} ${g.toFixed(6)} ${b.toFixed(6)}`,
      );
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
  flushPendingIsosurfaceRebuild();
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

bindRange(ui.simulationRate, ui.simulationRateValue, (value) => `${value.toFixed(2)}`, (value) => {
  settings.simulationRate = value;
});

ui.simulationTimeline.addEventListener('input', () => {
  if (simulationState.running || simulationState.entries.length === 0) {
    return;
  }

  const frame = Number.parseInt(ui.simulationTimeline.value, 10);
  if (!Number.isFinite(frame)) {
    return;
  }

  const elapsed = frame / SIMULATION_TIMELINE_FPS;
  simulationState.elapsed = THREE.MathUtils.clamp(elapsed, 0, simulationState.maxElapsed);
  applySimulationAtCurrentElapsed();
  updateSimulationTimelineUi();
});

bindRange(ui.sizeX, ui.sizeXValue, (value) => `${value.toFixed(2)}`, (value) => {
  settings.sizeX = value;
  applyGridSizeSettings();
  scheduleRebuild();
});

bindRange(ui.sizeY, ui.sizeYValue, (value) => `${value.toFixed(2)}`, (value) => {
  settings.sizeY = value;
  applyGridSizeSettings();
  scheduleRebuild();
});

bindRange(ui.sizeZ, ui.sizeZValue, (value) => `${value.toFixed(2)}`, (value) => {
  settings.sizeZ = value;
  applyGridSizeSettings();
  scheduleRebuild();
});

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

bindRange(ui.smoothing, ui.smoothingValue, (value) => `${Math.round(value)}`, (value) => {
  settings.smoothing = Math.round(value);
  scheduleRebuild();
});

bindRange(ui.thickness, ui.thicknessValue, (value) => `${value.toFixed(3)}`, (value) => {
  settings.thickness = value;
  scheduleRebuild();
});

bindRange(ui.randomPoints, ui.randomPointsValue, (value) => `${Math.round(value)}`, (value) => {
  settings.randomPoints = Math.round(value);
  regenerateGeneratedPoints();
  syncPointCount();
  rebuildNow();
});

bindRange(ui.randomSeed, ui.randomSeedValue, (value) => `${Math.round(value)}`, (value) => {
  settings.randomSeed = Math.round(value);
  regenerateGeneratedPoints();
  syncPointCount();
  rebuildNow();
});

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

ui.startSim.addEventListener('click', () => {
  setSimulationRunning(!simulationState.running);
});

ui.resetSim.addEventListener('click', () => {
  if (simulationState.entries.length === 0) {
    rebuildSimulationEntries();
  }
  simulationState.elapsed = 0;
  simulationState.maxElapsed = 0;
  resetSimulationToBasePositions();
  updateSimulationTimelineUi();
});

ui.clearAll.addEventListener('click', () => {
  setSimulationRunning(false);
  simulationState.entries = [];
  simulationState.elapsed = 0;
  simulationState.maxElapsed = 0;
  updateSimulationTimelineUi();

  clearPointSelection();
  userPoints.length = 0;
  generatedPoints.length = 0;
  pointGroup.clear();
  generatedPointGroup.clear();
  activeCutPlanes.length = 0;
  cutGesture = null;
  cutLine.visible = false;
  settings.randomPoints = 0;
  ui.randomPoints.value = '0';
  ui.randomPointsValue.value = '0';
  updateRangeProgress(ui.randomPoints);
  syncPointCount();
  scheduleRebuild();
  pushUndoState();
});

ui.clearCuts.addEventListener('click', () => {
  if (activeCutPlanes.length === 0) {
    return;
  }
  activeCutPlanes.length = 0;
  cutGesture = null;
  clearCutPreviewLine();
  rebuildNow();
  pushUndoState();
});

ui.showBoundary.addEventListener('change', () => {
  boxEdges.visible = ui.showBoundary.checked;
});

ui.showIsoSurface.addEventListener('change', () => {
  isoGroup.visible = ui.showIsoSurface.checked;
});

ui.showPoints.addEventListener('change', () => {
  const visible = ui.showPoints.checked;
  pointGroup.visible = visible;
  generatedPointGroup.visible = visible;
  if (!visible) {
    clearPointSelection();
  }
});

ui.exportObj.addEventListener('click', exportIsosurfacesAsObj);
ui.exportGlb.addEventListener('click', exportIsosurfacesAsGlb);
ui.exportScreenshot.addEventListener('click', exportScreenshot);

function setMouseFromEvent(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function getBoxHitPointFromEvent(event, target = null) {
  setMouseFromEvent(event);
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObject(raycastBox, false);
  if (hits.length === 0) {
    return null;
  }

  if (target instanceof THREE.Vector3) {
    target.copy(hits[0].point);
    return target;
  }

  return hits[0].point.clone();
}

function getCutDrawPointFromEvent(event, target = null) {
  setMouseFromEvent(event);
  raycaster.setFromCamera(mouse, camera);

  camera.getWorldDirection(cutCameraDirection).normalize();
  cutDrawPlane.setFromNormalAndCoplanarPoint(cutCameraDirection, boxCenter);
  if (!raycaster.ray.intersectPlane(cutDrawPlane, cutDrawPoint)) {
    return null;
  }

  if (target instanceof THREE.Vector3) {
    target.copy(cutDrawPoint);
    return target;
  }

  return cutDrawPoint.clone();
}

function updateCutPreviewLine(start, end) {
  cutLineGeometry.setPositions([start.x, start.y, start.z, end.x, end.y, end.z]);
  cutLine.geometry.computeBoundingSphere();
  cutLine.visible = true;
}

function clearCutPreviewLine() {
  cutLine.visible = false;
}

function createCutPlaneFromLine(start, end) {
  const lineDirection = end.clone().sub(start);
  if (lineDirection.lengthSq() <= CUT_MIN_LINE_LENGTH_SQ) {
    return null;
  }
  lineDirection.normalize();

  const cameraDirection = new THREE.Vector3();
  camera.getWorldDirection(cameraDirection).normalize();

  const planeNormal = new THREE.Vector3().crossVectors(lineDirection, cameraDirection);
  if (planeNormal.lengthSq() <= 1e-10) {
    return null;
  }
  planeNormal.normalize();

  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, start);
  let keepSign = Math.sign(plane.distanceToPoint(boxCenter));
  if (keepSign === 0) {
    keepSign = 1;
  }

  return { plane, keepSign };
}

function beginCutGesture(event) {
  const startPoint = getCutDrawPointFromEvent(event);
  if (!startPoint) {
    return false;
  }

  cutGesture = {
    pointerId: event.pointerId,
    start: startPoint.clone(),
    end: startPoint.clone(),
  };
  updateCutPreviewLine(cutGesture.start, cutGesture.end);

  if (typeof renderer.domElement.setPointerCapture === 'function') {
    renderer.domElement.setPointerCapture(event.pointerId);
  }

  return true;
}

function updateCutGesture(event) {
  if (!cutGesture || event.pointerId !== cutGesture.pointerId) {
    return;
  }

  const nextPoint = getCutDrawPointFromEvent(event, cutGesture.end);
  if (!nextPoint) {
    return;
  }

  updateCutPreviewLine(cutGesture.start, cutGesture.end);
}

function endCutGesture(event, cancelled = false) {
  if (!cutGesture) {
    return;
  }

  if (!cancelled && event.pointerId === cutGesture.pointerId) {
    getCutDrawPointFromEvent(event, cutGesture.end);
    const nextCutPlane = createCutPlaneFromLine(cutGesture.start, cutGesture.end);
    if (nextCutPlane) {
      activeCutPlanes.push(nextCutPlane);
      rebuildNow();
      pushUndoState();
    }
  }

  const pointerId = cutGesture.pointerId;
  cutGesture = null;
  clearCutPreviewLine();

  if (
    typeof renderer.domElement.hasPointerCapture === 'function' &&
    typeof renderer.domElement.releasePointerCapture === 'function' &&
    renderer.domElement.hasPointerCapture(pointerId)
  ) {
    renderer.domElement.releasePointerCapture(pointerId);
  }
}

function addPointFromEvent(event) {
  const point = getBoxHitPointFromEvent(event);
  if (!point) {
    return false;
  }
  userPoints.push(point);
  invalidateSimulationSession();

  const marker = new THREE.Mesh(pointGeometry, pointMaterial);
  marker.position.copy(point);
  marker.userData.pointIndex = userPoints.length - 1;
  pointGroup.add(marker);

  syncPointCount();
  selectPointByIndex(userPoints.length - 1);
  scheduleRebuild();
  pushUndoState();
  return true;
}

function removePointAtIndex(index) {
  if (!Number.isInteger(index) || index < 0 || index >= userPoints.length) {
    return false;
  }

  clearPointSelection();
  userPoints.splice(index, 1);
  invalidateSimulationSession();

  const marker = pointGroup.children[index];
  if (marker) {
    pointGroup.remove(marker);
  }

  for (let i = 0; i < pointGroup.children.length; i += 1) {
    const child = pointGroup.children[i];
    child.userData.pointIndex = i;
  }

  syncPointCount();

  if (userPoints.length > 0) {
    selectPointByIndex(Math.min(index, userPoints.length - 1));
  }

  scheduleRebuild();
  pushUndoState();
  return true;
}

function findNearestPointIndexFromScreen(event, maxPixelDistance = 18) {
  if (pointGroup.children.length === 0) {
    return -1;
  }

  const rect = renderer.domElement.getBoundingClientRect();
  let bestIndex = -1;
  let bestDistanceSq = maxPixelDistance * maxPixelDistance;

  for (let i = 0; i < pointGroup.children.length; i += 1) {
    const marker = pointGroup.children[i];
    if (!(marker instanceof THREE.Object3D)) {
      continue;
    }

    projectedPoint.copy(marker.position).project(camera);
    if (projectedPoint.z < -1 || projectedPoint.z > 1) {
      continue;
    }

    const sx = rect.left + (projectedPoint.x * 0.5 + 0.5) * rect.width;
    const sy = rect.top + (-projectedPoint.y * 0.5 + 0.5) * rect.height;
    const dx = event.clientX - sx;
    const dy = event.clientY - sy;
    const distanceSq = dx * dx + dy * dy;

    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function selectPointFromEvent(event) {
  if (pointGroup.children.length === 0) {
    return false;
  }

  setMouseFromEvent(event);
  raycaster.setFromCamera(mouse, camera);

  const hits = raycaster.intersectObjects(pointGroup.children, false);
  if (hits.length > 0) {
    const hitObject = hits[0].object;
    const byObjectIndex = pointGroup.children.indexOf(hitObject);
    if (byObjectIndex >= 0) {
      hitObject.userData.pointIndex = byObjectIndex;
      return selectPointByIndex(byObjectIndex);
    }

    const userDataIndex = Number(hitObject.userData.pointIndex);
    if (Number.isInteger(userDataIndex)) {
      return selectPointByIndex(userDataIndex);
    }
  }

  const nearestIndex = findNearestPointIndexFromScreen(event);
  if (nearestIndex >= 0) {
    return selectPointByIndex(nearestIndex);
  }

  return false;
}

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) {
    return;
  }

  if (simulationState.running) {
    pointerDown = null;
    return;
  }

  if (isTransformDragging || isPointerOverGizmo) {
    pointerDown = null;
    return;
  }

  if (event.shiftKey) {
    pointerDown = null;
    beginCutGesture(event);
    return;
  }

  if (selectPointFromEvent(event)) {
    pointerDown = null;
    return;
  }

  pointerDown = {
    x: event.clientX,
    y: event.clientY,
  };
});

renderer.domElement.addEventListener('pointermove', (event) => {
  updateCutGesture(event);
});

renderer.domElement.addEventListener('pointerup', (event) => {
  if (event.button === 0 && cutGesture && event.pointerId === cutGesture.pointerId) {
    endCutGesture(event, false);
    return;
  }

  if (event.button !== 0 || pointerDown === null) {
    return;
  }

  const dx = event.clientX - pointerDown.x;
  const dy = event.clientY - pointerDown.y;
  pointerDown = null;

  if (dx * dx + dy * dy > clickMoveThresholdSq) {
    return;
  }

  if (isTransformDragging || isPointerOverGizmo) {
    return;
  }

  if (addPointFromEvent(event)) {
    return;
  }

  clearPointSelection();
});

renderer.domElement.addEventListener('pointercancel', (event) => {
  endCutGesture(event, true);
  pointerDown = null;
});

renderer.domElement.addEventListener('pointerleave', (event) => {
  if (cutGesture && event.pointerId === cutGesture.pointerId) {
    endCutGesture(event, true);
  }
  pointerDown = null;
});

window.addEventListener('keydown', (event) => {
  if (simulationState.running) {
    return;
  }

  const activeElement = document.activeElement;
  if (
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement ||
    activeElement instanceof HTMLSelectElement ||
    activeElement?.isContentEditable
  ) {
    return;
  }

  const key = event.key.toLowerCase();
  const useHistoryModifier = event.ctrlKey || event.metaKey;
  const isUndo = useHistoryModifier && !event.shiftKey && key === 'z';
  const isRedo = (useHistoryModifier && key === 'y') || (useHistoryModifier && event.shiftKey && key === 'z');
  if (isUndo) {
    event.preventDefault();
    undoHistory();
    return;
  }
  if (isRedo) {
    event.preventDefault();
    redoHistory();
    return;
  }

  if (event.key !== 'Delete') {
    return;
  }

  if (removePointAtIndex(selectedPointIndex)) {
    event.preventDefault();
  }
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
  cutLineMaterial.resolution.set(width, height);
  clampPanelToViewport();
}

window.addEventListener('resize', onResize);

let animationFrame = 0;
function renderLoop() {
  animationFrame = requestAnimationFrame(renderLoop);

  if (simulationState.running) {
    const now = performance.now();
    const deltaSeconds = Math.min((now - simulationState.lastFrameMs) / 1000, 0.05);
    simulationState.lastFrameMs = now;
    stepSimulation(deltaSeconds);
  }

  if (realtimeRebuildRequested) {
    realtimeRebuildRequested = false;
    rebuildNow();
  }
  controls.update();
  composer.render();
}

syncPointCount();
updateSimulationButtonState();
updateSimulationTimelineUi();
setPointEditingLocked(false);
renderLoop();
rebuildIsosurfaces();
clampPanelToViewport();
pushUndoState();

window.addEventListener('beforeunload', () => {
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
  }

  if (rebuildTimer !== null) {
    clearTimeout(rebuildTimer);
  }

  controls.dispose();
  transformControls.dispose();
  scene.remove(transformHelper);
  clearIsosurfaceMeshes();

  pointGeometry.dispose();
  pointMaterial.dispose();
  selectedPointMaterial.dispose();
  generatedPointGeometry.dispose();
  generatedPointMaterial.dispose();

  cutLine.geometry.dispose();
  cutLine.material.dispose();

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
