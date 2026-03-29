import './styles.css';
import * as THREE from 'three';
import GUI from 'lil-gui';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { generateIsosurfaces } from './isosurface/marchingCubes.js';
import { subdivideCatmullClark } from './geometry/catmullClarkSubdivision.js';

const app = document.querySelector('#app');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe7edf7);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(3.6, 2.8, 3.9);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

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

const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0xdbe9ff, 0x8f9ab0, 0.6);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
keyLight.position.set(4, 5, 3);
scene.add(keyLight);

const bounds = {
  min: new THREE.Vector3(-1, -1, -1),
  max: new THREE.Vector3(1, 1, 1),
};

const boxSize = new THREE.Vector3().subVectors(bounds.max, bounds.min);
const boxGeometry = new THREE.BoxGeometry(boxSize.x, boxSize.y, boxSize.z);
const boxEdges = new THREE.LineSegments(
  new THREE.EdgesGeometry(boxGeometry),
  new THREE.LineBasicMaterial({ color: 0x36465e }),
);
scene.add(boxEdges);

const raycastBox = new THREE.Mesh(
  boxGeometry.clone(),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
);
scene.add(raycastBox);
boxGeometry.dispose();

const isoMaterialTemplate = new THREE.MeshStandardMaterial({
  color: 0x2dbfd4,
  roughness: 0.32,
  metalness: 0.08,
  side: THREE.DoubleSide,
});

const isoGroup = new THREE.Group();
scene.add(isoGroup);

const points = [];
const pointGroup = new THREE.Group();
scene.add(pointGroup);

const pointGeometry = new THREE.SphereGeometry(0.04, 12, 10);
const pointMaterial = new THREE.MeshStandardMaterial({ color: 0xff7f4d, roughness: 0.5, metalness: 0.1 });

const settings = {
  xRes: 24,
  yRes: 24,
  zRes: 24,
  isoValue: 0.55,
  amount: 1,
  offset: 0.08,
  subdivision: 0,
  pointCount: 0,
  clearAll: () => {
    points.length = 0;
    pointGroup.clear();
    settings.pointCount = 0;
    scheduleRebuild();
  },
};

const gui = new GUI({ title: 'Scalar Isosurface' });
const gridFolder = gui.addFolder('Grid Density');
gridFolder.add(settings, 'xRes', 8, 48, 1).name('X res').onChange(scheduleRebuild);
gridFolder.add(settings, 'yRes', 8, 48, 1).name('Y res').onChange(scheduleRebuild);
gridFolder.add(settings, 'zRes', 8, 48, 1).name('Z res').onChange(scheduleRebuild);
gridFolder.open();

const surfaceFolder = gui.addFolder('Surface');
surfaceFolder.add(settings, 'isoValue', 0.05, 3.0, 0.01).name('isoValue').onChange(scheduleRebuild);
surfaceFolder.add(settings, 'amount', 1, 12, 1).name('Amount').onChange(scheduleRebuild);
surfaceFolder.add(settings, 'offset', 0.0, 1.0, 0.01).name('offset').onChange(scheduleRebuild);
surfaceFolder.add(settings, 'subdivision', 0, 2, 1).name('Subdivision').onChange(scheduleRebuild);
surfaceFolder.open();

const pointFolder = gui.addFolder('Points');
const pointCountController = pointFolder.add(settings, 'pointCount').name('Count').listen();
if (typeof pointCountController.disable === 'function') {
  pointCountController.disable();
}
pointFolder.add(settings, 'clearAll').name('Clear All');
pointFolder.open();

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

let pointerDown = null;
const clickMoveThresholdSq = 16;
const sigma = 0.22;
let rebuildTimer = null;

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
    color.set(0x2dbfd4);
    return color;
  }

  const t = index / (totalCount - 1);
  color.setHSL(0.56 - 0.14 * t, 0.65, 0.48 + 0.08 * t);
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

  for (let i = 0; i < surfaces.length; i += 1) {
    let renderGeometry = surfaces[i].geometry;
    if (settings.subdivision > 0) {
      const subdivided = subdivideCatmullClark(renderGeometry, settings.subdivision);
      if (subdivided !== renderGeometry) {
        renderGeometry.dispose();
        renderGeometry = subdivided;
      }
    }

    const material = isoMaterialTemplate.clone();
    material.color.copy(getIsosurfaceColor(i, surfaces.length));
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
  renderer.setSize(width, height);
}

window.addEventListener('resize', onResize);

let animationFrame = 0;
function renderLoop() {
  animationFrame = requestAnimationFrame(renderLoop);
  controls.update();
  renderer.render(scene, camera);
}

renderLoop();
rebuildIsosurfaces();

window.addEventListener('beforeunload', () => {
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
  }

  if (rebuildTimer !== null) {
    clearTimeout(rebuildTimer);
  }

  controls.dispose();
  gui.destroy();
  clearIsosurfaceMeshes();

  pointGeometry.dispose();
  pointMaterial.dispose();

  boxEdges.geometry.dispose();
  boxEdges.material.dispose();

  raycastBox.geometry.dispose();
  raycastBox.material.dispose();

  isoMaterialTemplate.dispose();
  renderer.dispose();
});
