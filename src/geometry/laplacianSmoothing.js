import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function buildNeighborData(geometry) {
  const index = geometry.getIndex();
  const position = geometry.getAttribute('position');
  if (!index || !position) {
    return null;
  }

  const vertexCount = position.count;
  const neighbors = Array.from({ length: vertexCount }, () => new Set());
  const edgeCounts = new Map();

  const addEdge = (a, b) => {
    const iMin = a < b ? a : b;
    const iMax = a < b ? b : a;
    const key = `${iMin}_${iMax}`;
    const existing = edgeCounts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      edgeCounts.set(key, { a: iMin, b: iMax, count: 1 });
    }
  };

  const idx = index.array;
  const faceCount = index.count / 3;
  for (let face = 0; face < faceCount; face += 1) {
    const i0 = idx[face * 3];
    const i1 = idx[face * 3 + 1];
    const i2 = idx[face * 3 + 2];

    neighbors[i0].add(i1);
    neighbors[i0].add(i2);
    neighbors[i1].add(i0);
    neighbors[i1].add(i2);
    neighbors[i2].add(i0);
    neighbors[i2].add(i1);

    addEdge(i0, i1);
    addEdge(i1, i2);
    addEdge(i2, i0);
  }

  const isBoundary = new Uint8Array(vertexCount);
  for (const edge of edgeCounts.values()) {
    if (edge.count === 1) {
      isBoundary[edge.a] = 1;
      isBoundary[edge.b] = 1;
    }
  }

  return { neighbors, isBoundary };
}

export function laplacianSmooth(geometry, iterations, lambda = 0.5) {
  const smoothIterations = Math.max(0, Math.floor(iterations));
  if (smoothIterations === 0) {
    return geometry;
  }

  let working;
  if (geometry.getIndex()) {
    working = geometry.clone();
    working.deleteAttribute('normal');
  } else {
    const mergeInput = geometry.clone();
    mergeInput.deleteAttribute('normal');
    working = mergeVertices(mergeInput, 1e-5);
    mergeInput.dispose();
  }

  const position = working.getAttribute('position');
  const neighborData = buildNeighborData(working);
  if (!position || !neighborData) {
    working.dispose();
    return geometry;
  }

  const vertexCount = position.count;
  const src = new Float32Array(position.array);
  const dst = new Float32Array(src.length);
  const weight = Math.max(0, Math.min(1, lambda));

  for (let iter = 0; iter < smoothIterations; iter += 1) {
    for (let i = 0; i < vertexCount; i += 1) {
      const base = i * 3;
      if (neighborData.isBoundary[i] === 1) {
        dst[base] = src[base];
        dst[base + 1] = src[base + 1];
        dst[base + 2] = src[base + 2];
        continue;
      }

      const n = neighborData.neighbors[i];
      if (n.size === 0) {
        dst[base] = src[base];
        dst[base + 1] = src[base + 1];
        dst[base + 2] = src[base + 2];
        continue;
      }

      let ax = 0;
      let ay = 0;
      let az = 0;
      for (const j of n) {
        const jb = j * 3;
        ax += src[jb];
        ay += src[jb + 1];
        az += src[jb + 2];
      }
      const inv = 1 / n.size;
      ax *= inv;
      ay *= inv;
      az *= inv;

      dst[base] = src[base] + (ax - src[base]) * weight;
      dst[base + 1] = src[base + 1] + (ay - src[base + 1]) * weight;
      dst[base + 2] = src[base + 2] + (az - src[base + 2]) * weight;
    }

    src.set(dst);
  }

  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.BufferAttribute(src, 3));
  result.setIndex(working.getIndex().clone());
  result.computeVertexNormals();
  result.computeBoundingBox();
  result.computeBoundingSphere();

  working.dispose();
  return result;
}
