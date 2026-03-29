import * as THREE from 'three';
import { EDGE_TABLE, TRI_TABLE } from './marchingTables.js';

const EPSILON = 1e-6;

const CORNER_OFFSETS = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];

const EDGE_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

export function sampleScalar(position, points, sigma) {
  if (points.length === 0) {
    return 0;
  }

  const invTwoSigmaSq = 1 / (2 * sigma * sigma);
  let value = 0;

  for (let i = 0; i < points.length; i += 1) {
    value += Math.exp(-position.distanceToSquared(points[i]) * invTwoSigmaSq);
  }

  return value;
}

function interpolateEdge(
  target,
  edgeOffset,
  isoValue,
  x1,
  y1,
  z1,
  v1,
  x2,
  y2,
  z2,
  v2,
) {
  let t;

  if (Math.abs(isoValue - v1) < EPSILON) {
    t = 0;
  } else if (Math.abs(isoValue - v2) < EPSILON) {
    t = 1;
  } else if (Math.abs(v1 - v2) < EPSILON) {
    t = 0;
  } else {
    t = (isoValue - v1) / (v2 - v1);
  }

  const clampedT = Math.max(0, Math.min(1, t));
  target[edgeOffset] = x1 + clampedT * (x2 - x1);
  target[edgeOffset + 1] = y1 + clampedT * (y2 - y1);
  target[edgeOffset + 2] = z1 + clampedT * (z2 - z1);
}

function buildScalarField(bounds, resolution, points, sigma) {
  const { x: xRes, y: yRes, z: zRes } = resolution;
  const nx = xRes + 1;
  const ny = yRes + 1;
  const nz = zRes + 1;

  const stepX = (bounds.max.x - bounds.min.x) / xRes;
  const stepY = (bounds.max.y - bounds.min.y) / yRes;
  const stepZ = (bounds.max.z - bounds.min.z) / zRes;

  const scalarField = new Float32Array(nx * ny * nz);
  const samplePos = new THREE.Vector3();

  const fieldIndex = (ix, iy, iz) => ix + nx * (iy + ny * iz);

  for (let iz = 0; iz < nz; iz += 1) {
    const z = bounds.min.z + iz * stepZ;
    for (let iy = 0; iy < ny; iy += 1) {
      const y = bounds.min.y + iy * stepY;
      for (let ix = 0; ix < nx; ix += 1) {
        const x = bounds.min.x + ix * stepX;
        samplePos.set(x, y, z);
        scalarField[fieldIndex(ix, iy, iz)] = sampleScalar(samplePos, points, sigma);
      }
    }
  }

  return {
    scalarField,
    nx,
    ny,
    nz,
    stepX,
    stepY,
    stepZ,
  };
}

class MinHeap {
  constructor() {
    this.ids = [];
    this.priorities = [];
  }

  get size() {
    return this.ids.length;
  }

  push(id, priority) {
    let index = this.ids.length;
    this.ids.push(id);
    this.priorities.push(priority);

    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.priorities[parent] <= this.priorities[index]) {
        break;
      }

      [this.ids[parent], this.ids[index]] = [this.ids[index], this.ids[parent]];
      [this.priorities[parent], this.priorities[index]] = [
        this.priorities[index],
        this.priorities[parent],
      ];
      index = parent;
    }
  }

  pop() {
    if (this.ids.length === 0) {
      return null;
    }

    const rootId = this.ids[0];
    const rootPriority = this.priorities[0];
    const lastIndex = this.ids.length - 1;

    if (lastIndex === 0) {
      this.ids.pop();
      this.priorities.pop();
      return { id: rootId, priority: rootPriority };
    }

    this.ids[0] = this.ids[lastIndex];
    this.priorities[0] = this.priorities[lastIndex];
    this.ids.pop();
    this.priorities.pop();

    let index = 0;
    const length = this.ids.length;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;

      if (left < length && this.priorities[left] < this.priorities[smallest]) {
        smallest = left;
      }
      if (right < length && this.priorities[right] < this.priorities[smallest]) {
        smallest = right;
      }
      if (smallest === index) {
        break;
      }

      [this.ids[smallest], this.ids[index]] = [this.ids[index], this.ids[smallest]];
      [this.priorities[smallest], this.priorities[index]] = [
        this.priorities[index],
        this.priorities[smallest],
      ];
      index = smallest;
    }

    return { id: rootId, priority: rootPriority };
  }
}

function buildSignedDistanceField({
  scalarField,
  nx,
  ny,
  nz,
  stepX,
  stepY,
  stepZ,
  baseIsoValue,
}) {
  const nodeCount = scalarField.length;
  const insideMask = new Uint8Array(nodeCount);
  for (let i = 0; i < nodeCount; i += 1) {
    insideMask[i] = scalarField[i] >= baseIsoValue ? 1 : 0;
  }

  const distances = new Float32Array(nodeCount);
  distances.fill(Number.POSITIVE_INFINITY);

  const fieldIndex = (ix, iy, iz) => ix + nx * (iy + ny * iz);
  const heap = new MinHeap();
  const neighborDirs = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  const allNeighborDirs = [];
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0 && dz === 0) {
          continue;
        }
        allNeighborDirs.push({
          dx,
          dy,
          dz,
          cost: Math.hypot(dx * stepX, dy * stepY, dz * stepZ),
        });
      }
    }
  }
  const eps = 1e-9;

  for (let iz = 0; iz < nz; iz += 1) {
    for (let iy = 0; iy < ny; iy += 1) {
      for (let ix = 0; ix < nx; ix += 1) {
        const centerIndex = fieldIndex(ix, iy, iz);
        const centerValue = scalarField[centerIndex];
        const centerInside = insideMask[centerIndex];
        let seedDistance = Number.POSITIVE_INFINITY;

        for (let d = 0; d < neighborDirs.length; d += 1) {
          const [dx, dy, dz] = neighborDirs[d];
          const nxp = ix + dx;
          const nyp = iy + dy;
          const nzp = iz + dz;

          if (nxp < 0 || nxp >= nx || nyp < 0 || nyp >= ny || nzp < 0 || nzp >= nz) {
            continue;
          }

          const neighborIndex = fieldIndex(nxp, nyp, nzp);
          if (insideMask[neighborIndex] === centerInside) {
            continue;
          }

          const neighborValue = scalarField[neighborIndex];
          const denom = neighborValue - centerValue;
          const edgeLength =
            dx !== 0 ? stepX : dy !== 0 ? stepY : stepZ;
          let t = 0.5;
          if (Math.abs(denom) > eps) {
            t = (baseIsoValue - centerValue) / denom;
          }
          const candidate = Math.max(0, Math.min(1, t)) * edgeLength;
          if (candidate < seedDistance) {
            seedDistance = candidate;
          }
        }

        if (Number.isFinite(seedDistance)) {
          distances[centerIndex] = seedDistance;
          heap.push(centerIndex, seedDistance);
        }
      }
    }
  }

  while (heap.size > 0) {
    const current = heap.pop();
    if (current === null) {
      break;
    }

    const { id, priority } = current;
    if (priority > distances[id] + eps) {
      continue;
    }

    const plane = nx * ny;
    const iz = Math.floor(id / plane);
    const rem = id - iz * plane;
    const iy = Math.floor(rem / nx);
    const ix = rem - iy * nx;

    for (let i = 0; i < allNeighborDirs.length; i += 1) {
      const neighbor = allNeighborDirs[i];
      const nxp = ix + neighbor.dx;
      const nyp = iy + neighbor.dy;
      const nzp = iz + neighbor.dz;

      if (nxp < 0 || nxp >= nx || nyp < 0 || nyp >= ny || nzp < 0 || nzp >= nz) {
        continue;
      }

      const neighborIndex = fieldIndex(nxp, nyp, nzp);
      const nextDistance = priority + neighbor.cost;
      if (nextDistance + eps < distances[neighborIndex]) {
        distances[neighborIndex] = nextDistance;
        heap.push(neighborIndex, nextDistance);
      }
    }
  }

  const signedDistanceField = new Float32Array(nodeCount);
  const fallbackDistance = Math.hypot(
    (nx - 1) * stepX,
    (ny - 1) * stepY,
    (nz - 1) * stepZ,
  );

  for (let i = 0; i < nodeCount; i += 1) {
    const d = Number.isFinite(distances[i]) ? distances[i] : fallbackDistance;
    signedDistanceField[i] = insideMask[i] === 1 ? d : -d;
  }

  return signedDistanceField;
}

function polygonizeScalarField({
  bounds,
  resolution,
  isoValue,
  scalarField,
  nx,
  ny,
  stepX,
  stepY,
  stepZ,
}) {
  const { x: xRes, y: yRes, z: zRes } = resolution;
  const fieldIndex = (ix, iy, iz) => ix + nx * (iy + ny * iz);

  const cornerValues = new Float32Array(8);
  const cornerX = new Float32Array(8);
  const cornerY = new Float32Array(8);
  const cornerZ = new Float32Array(8);
  const edgeVertices = new Float32Array(12 * 3);
  const positions = [];

  for (let iz = 0; iz < zRes; iz += 1) {
    for (let iy = 0; iy < yRes; iy += 1) {
      for (let ix = 0; ix < xRes; ix += 1) {
        let cubeIndex = 0;

        for (let corner = 0; corner < 8; corner += 1) {
          const offset = CORNER_OFFSETS[corner];
          const sx = ix + offset[0];
          const sy = iy + offset[1];
          const sz = iz + offset[2];

          const value = scalarField[fieldIndex(sx, sy, sz)];
          cornerValues[corner] = value;
          cornerX[corner] = bounds.min.x + sx * stepX;
          cornerY[corner] = bounds.min.y + sy * stepY;
          cornerZ[corner] = bounds.min.z + sz * stepZ;

          if (value >= isoValue) {
            cubeIndex |= 1 << corner;
          }
        }

        const edgeMask = EDGE_TABLE[cubeIndex];
        if (edgeMask === 0) {
          continue;
        }

        for (let edge = 0; edge < 12; edge += 1) {
          if ((edgeMask & (1 << edge)) === 0) {
            continue;
          }

          const [a, b] = EDGE_CONNECTIONS[edge];
          interpolateEdge(
            edgeVertices,
            edge * 3,
            isoValue,
            cornerX[a],
            cornerY[a],
            cornerZ[a],
            cornerValues[a],
            cornerX[b],
            cornerY[b],
            cornerZ[b],
            cornerValues[b],
          );
        }

        const tableOffset = cubeIndex * 16;
        for (let tri = 0; tri < 16; tri += 3) {
          const e0 = TRI_TABLE[tableOffset + tri];
          if (e0 === -1) {
            break;
          }

          const e1 = TRI_TABLE[tableOffset + tri + 1];
          const e2 = TRI_TABLE[tableOffset + tri + 2];

          const i0 = e0 * 3;
          const i1 = e1 * 3;
          const i2 = e2 * 3;

          positions.push(
            edgeVertices[i0],
            edgeVertices[i0 + 1],
            edgeVertices[i0 + 2],
            edgeVertices[i1],
            edgeVertices[i1 + 1],
            edgeVertices[i1 + 2],
            edgeVertices[i2],
            edgeVertices[i2 + 1],
            edgeVertices[i2 + 2],
          );
        }
      }
    }
  }

  if (positions.length === 0) {
    return null;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return geometry;
}

export function generateIsosurface({ bounds, resolution, isoValue, points, sigma }) {
  const { x: xRes, y: yRes, z: zRes } = resolution;
  if (points.length === 0 || xRes < 1 || yRes < 1 || zRes < 1) {
    return null;
  }

  const scalarData = buildScalarField(bounds, resolution, points, sigma);
  return polygonizeScalarField({
    bounds,
    resolution,
    isoValue,
    ...scalarData,
  });
}

export function generateIsosurfaces({
  bounds,
  resolution,
  isoValue,
  points,
  sigma,
  amount,
  offset,
}) {
  const { x: xRes, y: yRes, z: zRes } = resolution;
  if (points.length === 0 || xRes < 1 || yRes < 1 || zRes < 1) {
    return [];
  }

  const count = Math.max(1, Math.floor(amount));
  const isoOffset = Number(offset);
  const scalarData = buildScalarField(bounds, resolution, points, sigma);
  const distanceField = buildSignedDistanceField({
    scalarField: scalarData.scalarField,
    nx: scalarData.nx,
    ny: scalarData.ny,
    nz: scalarData.nz,
    stepX: scalarData.stepX,
    stepY: scalarData.stepY,
    stepZ: scalarData.stepZ,
    baseIsoValue: isoValue,
  });
  const surfaces = [];

  for (let i = 0; i < count; i += 1) {
    const currentIsoDistance = -i * isoOffset;
    const geometry = polygonizeScalarField({
      bounds,
      resolution,
      isoValue: currentIsoDistance,
      scalarField: distanceField,
      nx: scalarData.nx,
      ny: scalarData.ny,
      stepX: scalarData.stepX,
      stepY: scalarData.stepY,
      stepZ: scalarData.stepZ,
    });

    if (geometry) {
      surfaces.push({
        isoValue: currentIsoDistance,
        geometry,
      });
    }
  }

  return surfaces;
}
