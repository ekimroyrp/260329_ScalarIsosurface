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

function sampleScalarAndGradient(x, y, z, points, invSigmaSq, invTwoSigmaSq, out) {
  let value = 0;
  let gx = 0;
  let gy = 0;
  let gz = 0;

  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    const dx = x - point.x;
    const dy = y - point.y;
    const dz = z - point.z;
    const weight = Math.exp(-(dx * dx + dy * dy + dz * dz) * invTwoSigmaSq);
    value += weight;

    const gradScale = -weight * invSigmaSq;
    gx += gradScale * dx;
    gy += gradScale * dy;
    gz += gradScale * dz;
  }

  out.value = value;
  out.gx = gx;
  out.gy = gy;
  out.gz = gz;
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

function buildSignedDistanceField({
  bounds,
  points,
  sigma,
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
  const signedDistanceField = new Float32Array(nodeCount);
  const fieldIndex = (ix, iy, iz) => ix + nx * (iy + ny * iz);

  const minX = bounds.min.x;
  const minY = bounds.min.y;
  const minZ = bounds.min.z;

  const invSigmaSq = 1 / (sigma * sigma);
  const invTwoSigmaSq = 0.5 * invSigmaSq;
  const maxIterations = 6;
  const levelTolerance = 1e-4;
  const gradSqEpsilon = 1e-12;
  const maxStepDistance = Math.max(stepX, stepY, stepZ) * 3;
  const evalResult = { value: 0, gx: 0, gy: 0, gz: 0 };

  for (let iz = 0; iz < nz; iz += 1) {
    const z = minZ + iz * stepZ;
    for (let iy = 0; iy < ny; iy += 1) {
      const y = minY + iy * stepY;
      for (let ix = 0; ix < nx; ix += 1) {
        const x = minX + ix * stepX;
        const nodeIndex = fieldIndex(ix, iy, iz);
        const initialLevel = scalarField[nodeIndex] - baseIsoValue;
        const sign = initialLevel >= 0 ? 1 : -1;

        let qx = x;
        let qy = y;
        let qz = z;
        let converged = false;
        let firstGradSq = 0;

        for (let iter = 0; iter < maxIterations; iter += 1) {
          sampleScalarAndGradient(qx, qy, qz, points, invSigmaSq, invTwoSigmaSq, evalResult);
          const level = evalResult.value - baseIsoValue;
          const gradSq =
            evalResult.gx * evalResult.gx +
            evalResult.gy * evalResult.gy +
            evalResult.gz * evalResult.gz;

          if (iter === 0) {
            firstGradSq = gradSq;
          }

          if (Math.abs(level) < levelTolerance) {
            converged = true;
            break;
          }

          if (gradSq < gradSqEpsilon) {
            break;
          }

          let stepScale = level / gradSq;
          const stepLength = Math.sqrt(gradSq) * Math.abs(stepScale);
          if (stepLength > maxStepDistance) {
            stepScale *= maxStepDistance / stepLength;
          }

          qx -= stepScale * evalResult.gx;
          qy -= stepScale * evalResult.gy;
          qz -= stepScale * evalResult.gz;
        }

        const dx = qx - x;
        const dy = qy - y;
        const dz = qz - z;
        let distance = Math.hypot(dx, dy, dz);

        if (!converged || !Number.isFinite(distance)) {
          const gradMag = Math.sqrt(Math.max(firstGradSq, gradSqEpsilon));
          distance = Math.abs(initialLevel) / gradMag;
        }

        signedDistanceField[nodeIndex] = sign * distance;
      }
    }
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
    bounds,
    points,
    sigma,
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
