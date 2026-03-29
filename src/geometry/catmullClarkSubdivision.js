import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function edgeKey(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function catmullClarkOnce(sourceGeometry) {
  // Merge by position only. Source marching-cubes output is non-indexed and
  // has per-face normals, which would prevent welding if normals are included.
  const mergeInput = sourceGeometry.clone();
  mergeInput.deleteAttribute('normal');
  const workingGeometry = mergeVertices(mergeInput, 1e-5);
  mergeInput.dispose();
  const positionAttr = workingGeometry.getAttribute('position');
  const indexAttr = workingGeometry.getIndex();

  if (!positionAttr || !indexAttr || indexAttr.count % 3 !== 0) {
    workingGeometry.dispose();
    return sourceGeometry.clone();
  }

  const vertexCount = positionAttr.count;
  const faceCount = indexAttr.count / 3;
  const indexArray = indexAttr.array;

  const vertexFaces = Array.from({ length: vertexCount }, () => []);
  const vertexEdgeKeys = Array.from({ length: vertexCount }, () => new Set());
  const edgeDataMap = new Map();
  const facePoints = new Array(faceCount);

  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();

  for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
    const i0 = indexArray[faceIndex * 3];
    const i1 = indexArray[faceIndex * 3 + 1];
    const i2 = indexArray[faceIndex * 3 + 2];

    va.fromBufferAttribute(positionAttr, i0);
    vb.fromBufferAttribute(positionAttr, i1);
    vc.fromBufferAttribute(positionAttr, i2);

    const facePoint = va.clone().add(vb).add(vc).multiplyScalar(1 / 3);
    facePoints[faceIndex] = facePoint;

    vertexFaces[i0].push(faceIndex);
    vertexFaces[i1].push(faceIndex);
    vertexFaces[i2].push(faceIndex);

    const faceEdges = [
      [i0, i1],
      [i1, i2],
      [i2, i0],
    ];

    for (let e = 0; e < 3; e += 1) {
      const a = faceEdges[e][0];
      const b = faceEdges[e][1];
      const key = edgeKey(a, b);

      if (!edgeDataMap.has(key)) {
        const vMin = Math.min(a, b);
        const vMax = Math.max(a, b);
        edgeDataMap.set(key, {
          a: vMin,
          b: vMax,
          faces: [faceIndex],
          edgePoint: new THREE.Vector3(),
          newIndex: -1,
        });
      } else {
        edgeDataMap.get(key).faces.push(faceIndex);
      }

      vertexEdgeKeys[a].add(key);
      vertexEdgeKeys[b].add(key);
    }
  }

  const edgeEntries = Array.from(edgeDataMap.values());
  const edgeCount = edgeEntries.length;

  const edgePointA = new THREE.Vector3();
  const edgePointB = new THREE.Vector3();

  for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += 1) {
    const edge = edgeEntries[edgeIndex];
    edgePointA.fromBufferAttribute(positionAttr, edge.a);
    edgePointB.fromBufferAttribute(positionAttr, edge.b);

    const edgePoint = edge.edgePoint;
    edgePoint.copy(edgePointA).add(edgePointB);

    if (edge.faces.length >= 2) {
      edgePoint.add(facePoints[edge.faces[0]]).add(facePoints[edge.faces[1]]).multiplyScalar(0.25);
    } else {
      edgePoint.multiplyScalar(0.5);
    }

    edge.newIndex = vertexCount + edgeIndex;
  }

  const totalVertexCount = vertexCount + edgeCount + faceCount;
  const outputPositions = new Float32Array(totalVertexCount * 3);

  const writeVectorAt = (index, vector) => {
    const o = index * 3;
    outputPositions[o] = vector.x;
    outputPositions[o + 1] = vector.y;
    outputPositions[o + 2] = vector.z;
  };

  const p = new THREE.Vector3();
  const fAvg = new THREE.Vector3();
  const rAvg = new THREE.Vector3();
  const edgeMid = new THREE.Vector3();
  const edgeOther = new THREE.Vector3();
  const boundaryNeighbor1 = new THREE.Vector3();
  const boundaryNeighbor2 = new THREE.Vector3();
  const nextVertex = new THREE.Vector3();
  const tempP = new THREE.Vector3();

  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    p.fromBufferAttribute(positionAttr, vertexIndex);

    const adjacentFaces = vertexFaces[vertexIndex];
    const incidentEdgeKeys = Array.from(vertexEdgeKeys[vertexIndex]);
    const valence = adjacentFaces.length;

    if (valence === 0 || incidentEdgeKeys.length === 0) {
      writeVectorAt(vertexIndex, p);
      continue;
    }

    const boundaryNeighbors = [];

    fAvg.set(0, 0, 0);
    for (let i = 0; i < adjacentFaces.length; i += 1) {
      fAvg.add(facePoints[adjacentFaces[i]]);
    }
    fAvg.multiplyScalar(1 / adjacentFaces.length);

    rAvg.set(0, 0, 0);
    for (let i = 0; i < incidentEdgeKeys.length; i += 1) {
      const edge = edgeDataMap.get(incidentEdgeKeys[i]);
      edgeMid.fromBufferAttribute(positionAttr, edge.a);
      edgeOther.fromBufferAttribute(positionAttr, edge.b);
      edgeMid.add(edgeOther).multiplyScalar(0.5);
      rAvg.add(edgeMid);

      if (edge.faces.length === 1) {
        const otherVertex = edge.a === vertexIndex ? edge.b : edge.a;
        boundaryNeighbors.push(otherVertex);
      }
    }
    rAvg.multiplyScalar(1 / incidentEdgeKeys.length);

    if (boundaryNeighbors.length >= 2) {
      boundaryNeighbor1.fromBufferAttribute(positionAttr, boundaryNeighbors[0]);
      boundaryNeighbor2.fromBufferAttribute(positionAttr, boundaryNeighbors[1]);
      nextVertex
        .copy(p)
        .multiplyScalar(0.75)
        .add(boundaryNeighbor1.multiplyScalar(0.125))
        .add(boundaryNeighbor2.multiplyScalar(0.125));
    } else {
      tempP.copy(p).multiplyScalar(valence - 3);
      nextVertex.copy(fAvg).add(rAvg.multiplyScalar(2)).add(tempP).multiplyScalar(1 / valence);
    }

    writeVectorAt(vertexIndex, nextVertex);
  }

  for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += 1) {
    writeVectorAt(vertexCount + edgeIndex, edgeEntries[edgeIndex].edgePoint);
  }

  for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
    writeVectorAt(vertexCount + edgeCount + faceIndex, facePoints[faceIndex]);
  }

  const outputIndices = [];

  for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
    const i0 = indexArray[faceIndex * 3];
    const i1 = indexArray[faceIndex * 3 + 1];
    const i2 = indexArray[faceIndex * 3 + 2];

    const edge01 = edgeDataMap.get(edgeKey(i0, i1)).newIndex;
    const edge12 = edgeDataMap.get(edgeKey(i1, i2)).newIndex;
    const edge20 = edgeDataMap.get(edgeKey(i2, i0)).newIndex;
    const facePointIndex = vertexCount + edgeCount + faceIndex;

    const quads = [
      [i0, edge01, facePointIndex, edge20],
      [i1, edge12, facePointIndex, edge01],
      [i2, edge20, facePointIndex, edge12],
    ];

    for (let q = 0; q < quads.length; q += 1) {
      const quad = quads[q];
      outputIndices.push(quad[0], quad[1], quad[2]);
      outputIndices.push(quad[0], quad[2], quad[3]);
    }
  }

  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.BufferAttribute(outputPositions, 3));
  result.setIndex(outputIndices);
  result.computeVertexNormals();
  result.computeBoundingBox();
  result.computeBoundingSphere();

  workingGeometry.dispose();
  return result;
}

export function subdivideCatmullClark(geometry, iterations) {
  const subdivCount = Math.max(0, Math.floor(iterations));
  if (subdivCount === 0) {
    return geometry;
  }

  let current = geometry;
  for (let i = 0; i < subdivCount; i += 1) {
    const next = catmullClarkOnce(current);
    if (current !== geometry) {
      current.dispose();
    }
    current = next;
  }

  return current;
}
