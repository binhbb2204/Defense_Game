import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HIGHWAY_01_MAP, MAP_SCHEMA_VERSION, ROAD_GEOMETRY_TEST_MAP } from '../../index';
import { migrateMapDefinition, syncGraphToLegacyWaypoints } from '../mapMigration';
import {
  addNode,
  addSegment,
  connectedComponents,
  computeSegmentFlowDirections,
  createEmptyMap,
  moveRoadNode,
  validateRoadGraph,
} from '../index';
import { buildRoadGeometry, type RoadGeometryResult } from '../roadGeometry';
import {
  computeSafeShapeParams,
  connectSegments,
  curveBetween,
  evalCubic,
  evalCubicTangent3D,
  findSection,
  minRadius,
  parallelSection,
  resolveSegmentCubic,
  roundCorner,
  reverseSection,
  sampleCenterline,
  smoothSection,
  straightenSection,
} from '../shaping';
import type { RoadNode, RoadSegment } from '../../types/protocol';

function buildChain(pts: Array<{ x: number; y?: number; z: number; role?: RoadNode['role']; corner?: boolean }>, width = 5.2) {
  const nodes: RoadNode[] = pts.map((p, i) => ({
    id: `n_${i}`,
    x: p.x,
    y: p.y ?? 0,
    z: p.z,
    role: p.role ?? (i === 0 ? 'spawn' : i === pts.length - 1 ? 'base' : 'normal'),
    corner: p.corner,
  }));
  const segments: RoadSegment[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    segments.push({
      id: `s_${i}`,
      a: nodes[i]!.id,
      b: nodes[i + 1]!.id,
      width,
      kind: 'straight',
    });
  }
  return { nodes, segments };
}

function assertPositiveMesh(res: RoadGeometryResult, label: string): void {
  assert.ok(res.positions.length > 0 && res.indices.length > 0, `${label}: non-empty mesh`);
  for (let i = 0; i < res.positions.length; i++) {
    assert.ok(Number.isFinite(res.positions[i]), `${label}: finite pos[${i}]`);
    assert.ok(Number.isFinite(res.normals[i]), `${label}: finite norm[${i}]`);
  }
  for (let i = 0; i < res.uvs.length; i++) {
    assert.ok(Number.isFinite(res.uvs[i]), `${label}: finite uv[${i}]`);
  }
  for (let t = 0; t < res.indices.length; t += 3) {
    const a = res.indices[t]!;
    const b = res.indices[t + 1]!;
    const c = res.indices[t + 2]!;
    const ax = res.positions[a * 3]!;
    const az = res.positions[a * 3 + 2]!;
    const bx = res.positions[b * 3]!;
    const bz = res.positions[b * 3 + 2]!;
    const cx = res.positions[c * 3]!;
    const cz = res.positions[c * 3 + 2]!;
    const area2 = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    assert.ok(area2 > 1e-6, `${label}: positive +Y area at tri ${t / 3}, got ${area2}`);
  }
}

describe('Road Shaping, Derived Curves & Single Source of Truth', () => {
  it('smooths chains of 3, 5, and 20 nodes with exact G1 joins, corner preservation & zero NaN', () => {
    for (const count of [3, 5, 20]) {
      const pts = Array.from({ length: count }, (_, i) => ({
        x: i * 10,
        z: i % 2 === 0 ? 0 : 12,
      }));
      const g = buildChain(pts);
      const sec = findSection(g.nodes, g.segments, g.nodes[0]!.id, g.nodes[count - 1]!.id);
      assert.ok(sec.section, `findSection ${count} nodes`);

      const res = smoothSection(g.nodes, g.segments, sec.section, { tension: 0.5 });
      assert.equal(res.allowed, true);
      assert.equal(res.nodes.length, count);
      assert.ok(res.segments.every((s) => s.kind === 'curve' && s.tension === 0.5));

      for (let i = 0; i < res.segments.length - 1; i++) {
        const cPrev = resolveSegmentCubic(res.segments[i]!, res.nodes, res.segments);
        const cNext = resolveSegmentCubic(res.segments[i + 1]!, res.nodes, res.segments);
        const nodeMid = res.nodes[i + 1]!;
        assert.ok(Math.hypot(cPrev.p3.x - nodeMid.x, cPrev.p3.z - nodeMid.z) < 1e-6);
        assert.ok(Math.hypot(cNext.p0.x - nodeMid.x, cNext.p0.z - nodeMid.z) < 1e-6);

        const tEnd = evalCubicTangent3D(cPrev, 1);
        const tStart = evalCubicTangent3D(cNext, 0);
        const dot = tEnd.x * tStart.x + tEnd.z * tStart.z;
        assert.ok(dot > 0.9999, `${count}-node G1 tangent dot at join ${i}: ${dot}`);
      }

      const samples = sampleCenterline({ nodeIds: sec.section.nodeIds, segmentIds: sec.section.segmentIds, nodes: res.nodes, segments: res.segments });
      assert.ok(samples.length > count);
      for (const sp of samples) {
        assert.ok(Number.isFinite(sp.x) && Number.isFinite(sp.y) && Number.isFinite(sp.z));
      }
      assertPositiveMesh(buildRoadGeometry({ nodes: res.nodes, segments: res.segments }), `smooth-${count}`);
    }

    // Node with corner: true keeps sharp corner even when neighbors are curves
    const cornerChain = buildChain([
      { x: 0, z: 0 },
      { x: 14, z: 0 },
      { x: 14, z: 14, corner: true },
      { x: 28, z: 14 },
    ]);
    const cSec = findSection(cornerChain.nodes, cornerChain.segments, 'n_0', 'n_3').section!;
    const smoothedCorner = smoothSection(cornerChain.nodes, cornerChain.segments, cSec);
    const c1 = resolveSegmentCubic(smoothedCorner.segments[1]!, smoothedCorner.nodes, smoothedCorner.segments);
    const c2 = resolveSegmentCubic(smoothedCorner.segments[2]!, smoothedCorner.nodes, smoothedCorner.segments);
    const dotAtCorner = evalCubicTangent3D(c1, 1).x * evalCubicTangent3D(c2, 0).x + evalCubicTangent3D(c1, 1).z * evalCubicTangent3D(c2, 0).z;
    assert.ok(Math.abs(dotAtCorner) < 0.2, `corner=true preserves sharp bend, dot=${dotAtCorner}`);
  });

  it('handles 90-deg, 150-deg bends & uneven spacing (2m vs 30m) without overshoot or loops', () => {
    const g = buildChain([
      { x: 0, z: 0 },
      { x: 2, z: 0 },
      { x: 32, z: 4 },
      { x: 32, z: 18 },
      { x: 14, z: 12 }, // sharp 150-deg bend back
    ], 4.0);
    const sec = findSection(g.nodes, g.segments, 'n_0', 'n_4').section!;
    const res = smoothSection(g.nodes, g.segments, sec, { tension: 0.5 });

    // Check monotonic forward progress along short 2m segment & no handle > 0.49 * chord
    for (const seg of res.segments) {
      const a = res.nodes.find((n) => n.id === seg.a)!;
      const b = res.nodes.find((n) => n.id === seg.b)!;
      const chord = Math.hypot(b.x - a.x, b.z - a.z);
      const cubic = resolveSegmentCubic(seg, res.nodes, res.segments);
      const h1 = Math.hypot(cubic.c1.x - cubic.p0.x, cubic.c1.z - cubic.p0.z);
      const h2 = Math.hypot(cubic.c2.x - cubic.p3.x, cubic.c2.z - cubic.p3.z);
      assert.ok(h1 <= chord * 0.49 && h2 <= chord * 0.49, 'handles stay bounded within chord');
    }

    const s2 = sampleCenterline({ segment: res.segments[0]!, nodes: res.nodes, segments: res.segments });
    for (let i = 1; i < s2.length; i++) {
      assert.ok(s2[i]!.x >= s2[i - 1]!.x - 1e-4, 'zero loop/overshoot on short 2m->30m transition');
    }
  });

  it('supports junction ends, closed loops with viaNodeId, and blocks interior degree-3+ crossings', () => {
    // Junction at end is allowed; crossing degree-3+ interior node is blocked
    let nodes: RoadNode[] = [
      { id: 'a', x: 0, y: 0, z: 0, role: 'spawn' },
      { id: 'b', x: 12, y: 0, z: 0, role: 'normal' },
      { id: 'j', x: 24, y: 0, z: 0, role: 'normal' },
      { id: 'e', x: 36, y: 0, z: 0, role: 'base' },
      { id: 'br', x: 24, y: 0, z: 16, role: 'base' },
    ];
    let segments: RoadSegment[] = [
      { id: 's1', a: 'a', b: 'b', width: 5, kind: 'straight' },
      { id: 's2', a: 'b', b: 'j', width: 5, kind: 'straight' },
      { id: 's3', a: 'j', b: 'e', width: 5, kind: 'straight' },
      { id: 's4', a: 'j', b: 'br', width: 5, kind: 'straight' },
    ];

    const endAtJ = findSection(nodes, segments, 'a', 'j');
    assert.ok(endAtJ.section, 'section may end at a junction');
    assert.equal(endAtJ.section.endNodeId, 'j');

    const crossJ = findSection(nodes, segments, 'a', 'e');
    assert.equal(crossJ.section, null);
    assert.ok(crossJ.warning?.includes('junction'));

    // Closed loop: 2 alternative routes, shortest first, viaNodeId selects alternate
    const loopNodes: RoadNode[] = [
      { id: 'l0', x: 0, y: 0, z: 0, role: 'normal' },
      { id: 'l1', x: 10, y: 0, z: 0, role: 'normal' },
      { id: 'l2', x: 30, y: 0, z: 20, role: 'normal' },
      { id: 'l3', x: 0, y: 0, z: 20, role: 'normal' },
    ];
    const loopSegs: RoadSegment[] = [
      { id: 'ls0', a: 'l0', b: 'l1', width: 5, kind: 'straight' },
      { id: 'ls1', a: 'l1', b: 'l2', width: 5, kind: 'straight' },
      { id: 'ls2', a: 'l2', b: 'l3', width: 5, kind: 'straight' },
      { id: 'ls3', a: 'l3', b: 'l0', width: 5, kind: 'straight' },
    ];
    const shortPick = findSection(loopNodes, loopSegs, 'l0', 'l1');
    assert.equal(shortPick.alternatives.length, 2);
    assert.deepEqual(shortPick.section?.nodeIds, ['l0', 'l1']);
    const longPick = findSection(loopNodes, loopSegs, 'l0', 'l1', 'l2');
    assert.deepEqual(longPick.section?.nodeIds, ['l0', 'l3', 'l2', 'l1']);
  });

  it('refuses destructive modes when interior contains spawn/base, while Curve matches outside tangents & Bezier points', () => {
    const g = buildChain([
      { x: 0, z: 0, role: 'normal' },
      { x: 15, z: 0, role: 'spawn' },
      { x: 30, z: 12, role: 'normal' },
    ]);
    const spSec = findSection(g.nodes, g.segments, 'n_0', 'n_2').section!;
    assert.equal(spSec.hasInteriorSpawnOrBase, true);
    assert.equal(curveBetween(g.nodes, g.segments, spSec).allowed, false);
    assert.equal(straightenSection(g.nodes, g.segments, spSec).allowed, false);
    assert.equal(smoothSection(g.nodes, g.segments, spSec).allowed, true);
    assert.equal(reverseSection(g.nodes, g.segments, spSec).allowed, true);

    // Chain flanked by two degree-2 straight roads
    const flanked = buildChain([
      { x: -20, z: 0, role: 'spawn' },
      { x: 0, z: 0, role: 'normal' },
      { x: 12, z: 2, role: 'normal' },
      { x: 24, z: 18, role: 'normal' },
      { x: 30, z: 30, role: 'normal' },
      { x: 30, z: 50, role: 'base' },
    ]);
    const midSec = findSection(flanked.nodes, flanked.segments, 'n_1', 'n_4').section!;
    const curved = curveBetween(flanked.nodes, flanked.segments, midSec, { handleFactor: 0.4, spacing: 8 });
    assert.equal(curved.allowed, true);
    assert.ok(curved.segments.some((s) => s.id === 's_0'), 'outside segment s_0 preserved');
    assert.ok(curved.segments.some((s) => s.id === 's_4'), 'outside segment s_4 preserved');
    assert.ok(curved.handles.length === 2);

    const cubic = {
      p0: curved.handles[0]!.anchor,
      c1: curved.handles[0]!.handle,
      c2: curved.handles[1]!.handle,
      p3: curved.handles[1]!.anchor,
      isCurved: true,
    };
    const outTanStart = evalCubicTangent3D(cubic, 0);
    const outTanEnd = evalCubicTangent3D(cubic, 1);
    assert.ok(Math.abs(outTanStart.x - 1) < 1e-4 && Math.abs(outTanStart.z) < 1e-4, 'start G1 matches outside road +X');
    assert.ok(Math.abs(outTanEnd.z - 1) < 1e-4 && Math.abs(outTanEnd.x) < 1e-4, 'end G1 matches outside road +Z');

    // Every resampled interior node lies strictly on the spanning cubic Bezier
    for (const id of curved.affectedNodeIds.slice(1, -1)) {
      const nd = curved.nodes.find((n) => n.id === id)!;
      let minDist = Infinity;
      for (let i = 0; i <= 1000; i++) {
        const p = evalCubic(cubic, i / 1000);
        minDist = Math.min(minDist, Math.hypot(p.x - nd.x, p.z - nd.z));
      }
      assert.ok(minDist < 0.03, `resampled node ${nd.id} lies on Bezier, err=${minDist}`);
    }

    // Straighten + equalise spacing
    const stSec = findSection(flanked.nodes, flanked.segments, 'n_1', 'n_4').section!;
    const straightened = straightenSection(flanked.nodes, flanked.segments, stSec, { equaliseSpacing: true });
    assert.equal(straightened.allowed, true);
    const nA = straightened.nodes.find((n) => n.id === 'n_1')!;
    const nB = straightened.nodes.find((n) => n.id === 'n_4')!;
    const dxAB = nB.x - nA.x;
    const dzAB = nB.z - nA.z;
    for (let i = 1; i < straightened.affectedNodeIds.length - 1; i++) {
      const nd = straightened.nodes.find((n) => n.id === straightened.affectedNodeIds[i]!)!;
      const expX = nA.x + dxAB * (i / 3);
      const expZ = nA.z + dzAB * (i / 3);
      assert.ok(Math.hypot(nd.x - expX, nd.z - expZ) < 0.03);
    }
  });

  it('flags tight curvature below width/2, suggests safe params, reverses reachability, and supports Tier 2 modes', () => {
    const tight = buildChain([
      { x: 0, z: 0 },
      { x: 6, z: 0 },
      { x: 6.5, z: 3 },
      { x: 0.5, z: 3.2 },
    ], 6.0);
    const tSec = findSection(tight.nodes, tight.segments, 'n_0', 'n_3').section!;
    assert.equal(minRadius([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }]), Infinity);
    assert.ok(minRadius([{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 5 }, { x: 10, y: 0, z: 0 }]) < 10);
    const bad = smoothSection(tight.nodes, tight.segments, tSec, { tension: 0.9 });
    assert.ok(bad.violations.length > 0 && bad.minRadius < 3.0, `flags violation, R=${bad.minRadius}`);
    const fixed = computeSafeShapeParams('smooth', tight.nodes, tight.segments, tSec, {
      tension: 0.9,
      handleFactor: 0.4,
      spacing: 8,
      radius: 10,
    });
    assert.ok((fixed.tension ?? 1) < 0.9);
    const ok = smoothSection(tight.nodes, tight.segments, tSec, { tension: fixed.tension });
    assert.equal(ok.violations.length, 0, 'limited tension clears curvature violations');

    // Reverse breaks spawn-to-base reachability & warns
    const straight = buildChain([{ x: 0, z: 0 }, { x: 15, z: 0 }, { x: 30, z: 0 }]);
    const rSec = findSection(straight.nodes, straight.segments, 'n_0', 'n_2').section!;
    const rev = reverseSection(straight.nodes, straight.segments, rSec);
    assert.ok(rev.warnings.some((w) => w.includes('Spawn-to-Base')));
    const dirs = computeSegmentFlowDirections(rev.nodes, rev.segments);
    assert.equal(dirs.get('s_0'), 1);
    const issues = validateRoadGraph({ ...createEmptyMap(), nodes: rev.nodes, segments: rev.segments });
    assert.ok(issues.some((i) => i.code === 'SPAWN_NO_ROUTE'));

    // Tier 2: roundCorner + parallelSection + connectSegments
    const lBend = buildChain([{ x: 0, z: 0 }, { x: 12, z: 0 }, { x: 12, z: 12 }], 4.0);
    const rounded = roundCorner(lBend.nodes, lBend.segments, 'n_1', { radius: 40 });
    assert.equal(rounded.allowed, true);
    assert.ok(rounded.minRadius <= 6.0, 't clamped <= 0.49 * minLen reduces excessive radius');

    const pSec = findSection(lBend.nodes, lBend.segments, 'n_0', 'n_2').section!;
    const par = parallelSection(lBend.nodes, lBend.segments, pSec, { offset: 8, side: 'right' });
    assert.equal(par.allowed, true);
    assert.equal(connectedComponents(par.nodes, par.segments).length, 2, 'parallel road is separate component');

    const { nodes: d1N, node: bEnd } = addNode(addNode([], { x: 0, y: 0, z: 0 }).nodes, { x: 10, y: 0, z: 0 });
    const n3 = addNode(d1N, { x: 25, y: 0, z: 12 });
    const n4 = addNode(n3.nodes, { x: 35, y: 0, z: 12 });
    let dSegs = addSegment(n4.nodes, [], d1N[0]!.id, bEnd.id).segments;
    dSegs = addSegment(n4.nodes, dSegs, n3.node.id, n4.node.id).segments;
    const conn = connectSegments(n4.nodes, dSegs, dSegs[0]!.id, dSegs[1]!.id, { radius: 8 });
    assert.equal(conn.allowed, true);
    assert.equal(connectedComponents(conn.nodes, conn.segments).length, 1);

    // Live node movement updates curve + syncGraphToLegacyWaypoints matches sampleCenterline
    const sm = smoothSection(lBend.nodes, lBend.segments, pSec);
    const movedNodes = moveRoadNode(sm.nodes, 'n_1', { x: 18, y: 0, z: 4 });
    const synced = syncGraphToLegacyWaypoints({ ...createEmptyMap(), nodes: movedNodes, segments: sm.segments });
    const routePts = sampleCenterline({ nodeIds: pSec.nodeIds, segmentIds: pSec.segmentIds, nodes: movedNodes, segments: sm.segments });
    assert.equal(synced.waypoints.length, routePts.length);

    // Schema v4 migration preserves derived curves and migrates legacy straight
    const legacy = migrateMapDefinition(HIGHWAY_01_MAP);
    assert.equal(legacy.version, MAP_SCHEMA_VERSION);
    assert.ok(legacy.segments!.every((s) => s.kind === 'straight'));
    assert.equal(migrateMapDefinition(ROAD_GEOMETRY_TEST_MAP).segments!.filter((s) => s.kind === 'curve').length, 2);

    // Undo snapshot restore check
    const origSnap = JSON.stringify({ nodes: lBend.nodes, segments: lBend.segments });
    assert.notEqual(JSON.stringify({ nodes: sm.nodes, segments: sm.segments }), origSnap);
    assert.equal(JSON.stringify({ nodes: lBend.nodes, segments: lBend.segments }), origSnap);
  });
});
