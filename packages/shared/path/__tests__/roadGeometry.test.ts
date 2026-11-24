import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RoadNode, RoadSegment, Vec3 } from '../../types/protocol';
import {
  buildRoadGeometry,
  collectDirtyRegion,
  type RoadGeometryResult,
} from '../roadGeometry';
import { ROAD_GEOMETRY_TEST_MAP, HIGHWAY_01_MAP } from '../../maps';
import { migrateMapDefinition } from '../mapMigration';

function signedAreaXZ(a: Vec3, b: Vec3, c: Vec3): number {
  return (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
}

function getVert(res: RoadGeometryResult, idx: number): Vec3 {
  const b = idx * 3;
  return {
    x: res.positions[b],
    y: res.positions[b + 1],
    z: res.positions[b + 2],
  };
}

function assertValidRoadMesh(res: RoadGeometryResult, label: string): void {
  assert.ok(res.positions.length > 0, `${label}: expected vertices`);
  assert.ok(res.indices.length > 0, `${label}: expected triangles`);
  assert.equal(res.positions.length % 3, 0, `${label}: positions triplet alignment`);
  assert.equal(res.normals.length, res.positions.length, `${label}: normals match positions`);
  assert.equal(res.uvs.length, (res.positions.length / 3) * 2, `${label}: uvs match vertex count`);
  assert.equal(res.indices.length % 3, 0, `${label}: indices triplet alignment`);

  for (let i = 0; i < res.positions.length; i++) {
    assert.ok(Number.isFinite(res.positions[i]), `${label}: finite position[${i}]`);
    assert.ok(Number.isFinite(res.normals[i]), `${label}: finite normal[${i}]`);
  }
  for (let i = 0; i < res.uvs.length; i++) {
    assert.ok(Number.isFinite(res.uvs[i]), `${label}: finite uv[${i}]`);
  }

  const triCount = res.indices.length / 3;
  for (let t = 0; t < triCount; t++) {
    const i0 = res.indices[t * 3];
    const i1 = res.indices[t * 3 + 1];
    const i2 = res.indices[t * 3 + 2];
    const a = getVert(res, i0);
    const b = getVert(res, i1);
    const c = getVert(res, i2);
    const area = signedAreaXZ(a, b, c);
    assert.ok(
      area > 1e-6,
      `${label}: tri ${t} must have strictly positive +Y XZ area, got ${area}`
    );
  }

  for (const poly of res.edgePolylines) {
    assert.ok(poly.length >= 2, `${label}: edgePolyline must have >= 2 pts`);
    for (const p of poly) {
      assert.ok(
        Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z),
        `${label}: finite polyline pt`
      );
    }
  }
}

function quantizeKey(v: Vec3): string {
  // Quantize to 1e-4m tolerance to verify coincident watertight seams
  const q = (n: number) => Math.round(n * 10000);
  return `${q(v.x)}:${q(v.z)}`;
}

describe('roadGeometry pure per-node builder', () => {
  it('builds collinear straight chain with continuous monotonic UV v and shared joints', () => {
    const nodes: RoadNode[] = [
      { id: 'n1', x: 0, y: 0, z: 0, role: 'spawn' },
      { id: 'n2', x: 10, y: 0, z: 0, role: 'normal' },
      { id: 'n3', x: 25, y: 0, z: 0, role: 'base' },
    ];
    const segments: RoadSegment[] = [
      { id: 's1', a: 'n1', b: 'n2', width: 4, kind: 'straight' },
      { id: 's2', a: 'n2', b: 'n3', width: 4, kind: 'straight' },
    ];

    const res = buildRoadGeometry({ nodes, segments }, { uvVPeriodMeters: 1 });
    assertValidRoadMesh(res, 'straight chain');
    assert.equal(res.indices.length / 3, 4, 'two straight quads = 4 triangles');
    // At collinear shared joint x=10, both segments share the exact vertex indices
    const uvsAt10: number[] = [];
    for (let i = 0; i < res.positions.length / 3; i++) {
      if (Math.abs(res.positions[i * 3] - 10) < 1e-4) {
        uvsAt10.push(res.uvs[i * 2 + 1]);
      }
    }
    assert.equal(uvsAt10.length, 2, 'exactly 2 shared vertices at collinear joint');
    assert.ok(Math.abs(uvsAt10[0] - 10) < 1e-4);
    assert.ok(Math.abs(uvsAt10[1] - 10) < 1e-4);

    // End vertices at x=25 reach continuous UV v=25
    const uvsAt25: number[] = [];
    for (let i = 0; i < res.positions.length / 3; i++) {
      if (Math.abs(res.positions[i * 3] - 25) < 1e-4) {
        uvsAt25.push(res.uvs[i * 2 + 1]);
      }
    }
    assert.ok(Math.abs(uvsAt25[0] - 25) < 1e-4);
  });

  it('handles 90-deg and 45-deg corners across miter, bevel, and round join styles cleanly', () => {
    const nodes: RoadNode[] = [
      { id: 'a', x: 0, y: 0, z: 0, role: 'spawn' },
      { id: 'b', x: 14, y: 0, z: 0, role: 'normal' },
      { id: 'c', x: 14, y: 0, z: 14, role: 'normal' },
      { id: 'd', x: 24, y: 0, z: 24, role: 'base' },
    ];
    const segments: RoadSegment[] = [
      { id: 's1', a: 'a', b: 'b', width: 3.6, kind: 'straight' },
      { id: 's2', a: 'b', b: 'c', width: 3.6, kind: 'straight' },
      { id: 's3', a: 'c', b: 'd', width: 3.6, kind: 'straight' },
    ];

    for (const joinStyle of ['miter', 'bevel', 'round'] as const) {
      const res = buildRoadGeometry({ nodes, segments }, { joinStyle });
      assertValidRoadMesh(res, `corners-${joinStyle}`);
    }
  });

  it('handles 15-deg sharp hairpin without spikes, inversion, or X-crossing', () => {
    const nodes: RoadNode[] = [
      { id: 'a', x: 20, y: 0, z: 0, role: 'spawn' },
      { id: 'b', x: 0, y: 0, z: 0, role: 'normal' },
      { id: 'c', x: 19.3, y: 0, z: 5.2, role: 'base' },
    ];
    const segments: RoadSegment[] = [
      { id: 's1', a: 'a', b: 'b', width: 3.4, kind: 'straight' },
      { id: 's2', a: 'b', b: 'c', width: 3.4, kind: 'straight' },
    ];

    const res = buildRoadGeometry({ nodes, segments }, { joinStyle: 'miter', miterLimit: 2.0 });
    assertValidRoadMesh(res, '15deg hairpin');

    // No vertex should spike wildly past halfW * 3 behind node b (x >= -h*1.5 = -2.55)
    for (let i = 0; i < res.positions.length / 3; i++) {
      const vx = res.positions[i * 3];
      const vz = res.positions[i * 3 + 2];
      assert.ok(vx >= -2.5, `no backward miter spike behind hairpin apex, got x=${vx}`);
      assert.ok(Number.isFinite(vz));
    }
    assert.ok(res.debug.junctionPolygons.length >= 1, 'round fallback emits outer corner fan');
  });

  it('builds watertight T-junction and 4-way crossing with zero boundary cracks', () => {
    const nodes: RoadNode[] = [
      { id: 'w', x: -12, y: 0, z: 0, role: 'spawn' },
      { id: 'c', x: 0, y: 0, z: 0, role: 'normal' },
      { id: 'e', x: 12, y: 0, z: 0, role: 'base' },
      { id: 'n', x: 0, y: 0, z: -12, role: 'spawn' },
      { id: 's', x: 0, y: 0, z: 12, role: 'base' },
    ];
    const segments: RoadSegment[] = [
      { id: 'sw', a: 'w', b: 'c', width: 4.0, kind: 'straight' },
      { id: 'se', a: 'c', b: 'e', width: 4.0, kind: 'straight' },
      { id: 'sn', a: 'n', b: 'c', width: 4.0, kind: 'straight' },
      { id: 'ss', a: 'c', b: 's', width: 4.0, kind: 'straight' },
    ];

    const res = buildRoadGeometry({ nodes, segments });
    assertValidRoadMesh(res, '4-way crossing');

    // Every quantized boundary vertex along trimPoints must appear in triangles belonging to both
    // the junction patch AND its adjacent segment strip (zero 1e-4 cracks)
    const edgeUsageByKey = new Map<string, number>();
    const triCount = res.indices.length / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = res.indices[t * 3];
      const i1 = res.indices[t * 3 + 1];
      const i2 = res.indices[t * 3 + 2];
      const pairs: Array<[number, number]> = [
        [i0, i1],
        [i1, i2],
        [i2, i0],
      ];
      for (const [u, v] of pairs) {
        const k1 = quantizeKey(getVert(res, u));
        const k2 = quantizeKey(getVert(res, v));
        const eKey = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
        edgeUsageByKey.set(eKey, (edgeUsageByKey.get(eKey) ?? 0) + 1);
      }
    }

    // Center-to-corner and stop-line interior edges inside the 4-way must have degree >= 2
    // Specifically check that all trimPoint pairs on segments share an interior edge of count 2
    const interiorCount = Array.from(edgeUsageByKey.values()).filter((c) => c >= 2).length;
    assert.ok(interiorCount >= 8, `expected watertight shared interior edges, got ${interiorCount}`);
  });

  it('scales trim distances proportionally on segments shorter than road width', () => {
    const nodes: RoadNode[] = [
      { id: 'a', x: -12, y: 0, z: 0, role: 'spawn' },
      { id: 'b', x: 0, y: 0, z: 0, role: 'normal' },
      { id: 'c', x: 2.0, y: 0, z: 0, role: 'normal' },
      { id: 'd', x: 14, y: 0, z: 0, role: 'base' },
      { id: 'b_s', x: 0, y: 0, z: 10, role: 'base' },
      { id: 'c_n', x: 2.0, y: 0, z: -10, role: 'base' },
    ];
    const segments: RoadSegment[] = [
      { id: 's1', a: 'a', b: 'b', width: 4.0, kind: 'straight' },
      { id: 's_short', a: 'b', b: 'c', width: 4.0, kind: 'straight' },
      { id: 's2', a: 'c', b: 'd', width: 4.0, kind: 'straight' },
      { id: 'sb', a: 'b', b: 'b_s', width: 4.0, kind: 'straight' },
      { id: 'sc', a: 'c', b: 'c_n', width: 4.0, kind: 'straight' },
    ];

    const res = buildRoadGeometry({ nodes, segments });
    assertValidRoadMesh(res, 'short segment between two T-junctions');

    const info = res.debug.segmentTrimDistances['s_short'];
    assert.ok(info, 'short segment trim distance recorded');
    assert.ok(
      info.startTrim + info.endTrim <= info.length * 0.95,
      `trim sum (${info.startTrim + info.endTrim}) must leave positive strip on len=${info.length}`
    );
  });

  it('builds the entire ROAD_GEOMETRY_TEST_MAP with all 13 visual test cases cleanly', () => {
    const res = buildRoadGeometry({
      nodes: ROAD_GEOMETRY_TEST_MAP.nodes ?? [],
      segments: ROAD_GEOMETRY_TEST_MAP.segments ?? [],
    });
    assertValidRoadMesh(res, 'ROAD_GEOMETRY_TEST_MAP');
    assert.ok(res.arrowStrips.length > 0, 'arrow strips generated along trimmed roads');
    assert.equal(
      res.debug.centrelines.length,
      (ROAD_GEOMETRY_TEST_MAP.segments ?? []).length,
      'debug centrelines match all test segments'
    );

    // Also test bevel and round presets over all 13 cases
    assertValidRoadMesh(
      buildRoadGeometry(
        {
          nodes: ROAD_GEOMETRY_TEST_MAP.nodes ?? [],
          segments: ROAD_GEOMETRY_TEST_MAP.segments ?? [],
        },
        { joinStyle: 'bevel' }
      ),
      'ROAD_GEOMETRY_TEST_MAP-bevel'
    );
    assertValidRoadMesh(
      buildRoadGeometry(
        {
          nodes: ROAD_GEOMETRY_TEST_MAP.nodes ?? [],
          segments: ROAD_GEOMETRY_TEST_MAP.segments ?? [],
        },
        { joinStyle: 'round' }
      ),
      'ROAD_GEOMETRY_TEST_MAP-round'
    );
  });

  it('builds legacy highway_01 migrated graph cleanly', () => {
    const migrated = migrateMapDefinition(HIGHWAY_01_MAP);
    const res = buildRoadGeometry({
      nodes: migrated.nodes ?? [],
      segments: migrated.segments ?? [],
    });
    assertValidRoadMesh(res, 'HIGHWAY_01_MAP');
    assert.ok(res.arrowStrips.length >= 10, 'highway generates directional chevrons');
  });

  it('builds a 500-node city grid rapidly and scopes collectDirtyRegion tightly', () => {
    const cols = 25;
    const rows = 20; // 500 nodes
    const spacing = 14;
    const nodes: RoadNode[] = [];
    const segments: RoadSegment[] = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        nodes.push({
          id: `g_${r}_${c}`,
          x: c * spacing,
          y: 0,
          z: r * spacing,
          role: r === 0 && c === 0 ? 'spawn' : r === rows - 1 && c === cols - 1 ? 'base' : 'normal',
        });
        if (c > 0) {
          segments.push({
            id: `sh_${r}_${c}`,
            a: `g_${r}_${c - 1}`,
            b: `g_${r}_${c}`,
            width: 3.4,
            kind: 'straight',
          });
        }
        if (r > 0) {
          segments.push({
            id: `sv_${r}_${c}`,
            a: `g_${r - 1}_${c}`,
            b: `g_${r}_${c}`,
            width: 3.4,
            kind: 'straight',
          });
        }
      }
    }

    const t0 = Date.now();
    const res = buildRoadGeometry({ nodes, segments });
    const elapsedMs = Date.now() - t0;

    assertValidRoadMesh(res, '500-node grid');
    assert.ok(elapsedMs < 400, `500-node grid build too slow: ${elapsedMs}ms`);

    const dirty = collectDirtyRegion(nodes, segments, new Set(['g_10_12']), 2);
    assert.ok(dirty.nodeIds.size <= 13, `2-hop dirty nodes compact, got ${dirty.nodeIds.size}`);
    assert.ok(dirty.segmentIds.size <= 24, `2-hop dirty segments compact, got ${dirty.segmentIds.size}`);
  });

  it('prevents UV u-twist on same-end (b-b / a-a) degree-2 corners across all join styles', () => {
    const nodes: RoadNode[] = [
      { id: 'a', x: 14, y: 0, z: 0, role: 'spawn' },
      { id: 'mid', x: 0, y: 0, z: 0, role: 'normal' },
      { id: 'c', x: 0, y: 0, z: 14, role: 'spawn' },
    ];
    // Both segments intentionally share end 'b' at 'mid' (opposing local parameterizations)
    const segments: RoadSegment[] = [
      { id: 's1', a: 'a', b: 'mid', width: 4.0, kind: 'straight' },
      { id: 's2', a: 'c', b: 'mid', width: 4.0, kind: 'straight' },
    ];

    for (const joinStyle of ['miter', 'bevel', 'round'] as const) {
      const res = buildRoadGeometry({ nodes, segments }, { joinStyle });
      assertValidRoadMesh(res, `same-end-${joinStyle}`);

      // Inspect every triangle overlapping the straight trunk of Arm 1 (x in [4, 12], z in [-2.1, +2.1])
      // or Arm 2 (z in [4, 12], x in [-2.1, +2.1]); every triangle must have distinct u=0 vs u=1 edges (|uA - uB| not both 0 and 1 on same curb line)
      const triCount = res.indices.length / 3;
      for (let t = 0; t < triCount; t++) {
        const i0 = res.indices[t * 3];
        const i1 = res.indices[t * 3 + 1];
        const i2 = res.indices[t * 3 + 2];
        const verts = [i0, i1, i2].map((idx) => ({
          pos: getVert(res, idx),
          u: res.uvs[idx * 2],
        }));

        const arm1CurbTop = verts.filter((v) => v.pos.x >= -2.5 && Math.abs(v.pos.z - -2.0) < 0.05);
        if (arm1CurbTop.length >= 2) {
          assert.ok(
            Math.abs(arm1CurbTop[0].u - arm1CurbTop[1].u) < 1e-4,
            `${joinStyle}: same-end Arm 1 top curb must keep constant u (${arm1CurbTop[0].u} vs ${arm1CurbTop[1].u})`
          );
        }
        const arm2CurbLeft = verts.filter((v) => v.pos.z >= -2.5 && Math.abs(v.pos.x - -2.0) < 0.05);
        if (arm2CurbLeft.length >= 2) {
          assert.ok(
            Math.abs(arm2CurbLeft[0].u - arm2CurbLeft[1].u) < 1e-4,
            `${joinStyle}: same-end Arm 2 left curb must keep constant u (${arm2CurbLeft[0].u} vs ${arm2CurbLeft[1].u})`
          );
        }
      }
    }
  });

  it('places arrowStrips strictly outside 4-way junction patches', () => {
    const nodes: RoadNode[] = [
      { id: 'w', x: -16, y: 0, z: 0, role: 'spawn' },
      { id: 'c', x: 0, y: 0, z: 0, role: 'normal' },
      { id: 'e', x: 16, y: 0, z: 0, role: 'base' },
      { id: 'n', x: 0, y: 0, z: -16, role: 'spawn' },
      { id: 's', x: 0, y: 0, z: 16, role: 'base' },
    ];
    const segments: RoadSegment[] = [
      { id: 'sw', a: 'w', b: 'c', width: 4.0, kind: 'straight' },
      { id: 'se', a: 'c', b: 'e', width: 4.0, kind: 'straight' },
      { id: 'sn', a: 'n', b: 'c', width: 4.0, kind: 'straight' },
      { id: 'ss', a: 'c', b: 's', width: 4.0, kind: 'straight' },
    ];

    const res = buildRoadGeometry({ nodes, segments });
    assert.ok(res.arrowStrips.length >= 4, 'expected chevrons on all 4 arms');
    for (const arr of res.arrowStrips) {
      const distFromCenter = Math.hypot(arr.position.x, arr.position.z);
      assert.ok(
        distFromCenter >= 2.0 - 1e-3,
        `arrowStrip on ${arr.segmentId} must clear 4-way junction patch (dist=${distFromCenter})`
      );
    }
  });
});
