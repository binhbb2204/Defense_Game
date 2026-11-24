import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RoadNode, RoadSegment } from '../../types/protocol';
import {
  computeSegmentEndTangentXZ,
  evaluateCurveCandidate,
  evaluateFreeCandidate,
  evaluateStraightCandidate,
  resolveNodeContinuationTangent,
  snapAngle15,
  snapCurveControlToTangent,
} from '../roadBuildMath';
import { measureRoadSegment } from '../graph/segmentCurve';
import { resolveSegmentCubic, sampleCenterline } from '../shaping/centerline';
import { smoothSection } from '../shaping/shapeCoreModes';
import { findSection } from '../shaping/sectionFinder';

describe('Road Tool Build Math & Mode Symmetry', () => {
  it('renders quadratic control as exact cubic equivalent c1/c2 and lets Smooth clear explicit control', () => {
    const nodes: RoadNode[] = [
      { id: 'n1', x: 0, y: 0, z: 0, role: 'spawn' },
      { id: 'n2', x: 20, y: 0, z: 0, role: 'normal' },
      { id: 'n3', x: 20, y: 0, z: 20, role: 'base' },
    ];
    const segs: RoadSegment[] = [
      { id: 's1', a: 'n1', b: 'n2', width: 6, kind: 'curve', control: { x: 10, y: 0, z: -12 } },
      { id: 's2', a: 'n2', b: 'n3', width: 6, kind: 'straight' },
    ];

    const cubic = resolveSegmentCubic(segs[0]!, nodes, segs);
    assert.ok(Math.abs(cubic.c1.x - (0 + (2 / 3) * 10)) < 1e-6);
    assert.ok(Math.abs(cubic.c1.z - (0 + (2 / 3) * -12)) < 1e-6);
    assert.ok(Math.abs(cubic.c2.x - (20 + (2 / 3) * -10)) < 1e-6);
    assert.ok(Math.abs(cubic.c2.z - (0 + (2 / 3) * -12)) < 1e-6);

    const pts = sampleCenterline({ segment: segs[0]!, nodes, segments: segs });
    assert.ok(pts.length > 4);

    const sec = findSection(nodes, segs, 'n1', 'n3').section!;
    const smoothed = smoothSection(nodes, segs, sec, { tension: 0.5 });
    assert.equal(smoothed.segments[0]!.control, undefined);
    assert.equal(smoothed.segments[0]!.kind, 'curve');
  });

  it('computes Curve mode end tangent and snaps subsequent control handle to continuation tangent', () => {
    const start = { x: 0, y: 0, z: 0 };
    const ctrl = { x: 12, y: 0, z: 0 };
    const end = { x: 20, y: 0, z: 10 };

    const endTan = computeSegmentEndTangentXZ(start, end, 'curve', ctrl);
    assert.ok(endTan);
    const len = Math.hypot(8, 10);
    assert.ok(Math.abs(endTan.x - 8 / len) < 1e-5);
    assert.ok(Math.abs(endTan.z - 10 / len) < 1e-5);

    const nearRay = { x: end.x + endTan.x * 14 + 0.5, y: 0, z: end.z + endTan.z * 14 - 0.3 };
    const snapped = snapCurveControlToTangent(end, nearRay, endTan, { altHeld: false, angleSnap: false });
    assert.equal(snapped.snappedToTangent, true);

    const unsnappedAlt = snapCurveControlToTangent(end, nearRay, endTan, { altHeld: true, angleSnap: false });
    assert.equal(unsnappedAlt.snappedToTangent, false);

    const sharpCurve = evaluateCurveCandidate(
      { x: 0, y: 0, z: 0 },
      { x: 12, y: 0, z: 0 },
      { x: 1, y: 0, z: 2 },
      10,
      null,
    );
    assert.equal(sharpCurve.tooTightRadius, true);
  });

  it('normalizes curved ramp control.y to midpoint elevation for uniform vertical grade', () => {
    const start = { x: 0, y: 0, z: 0 };
    const end = { x: 20, y: 4, z: 20 };

    const fromGroundCtrl = evaluateCurveCandidate(start, { x: 12, y: 0, z: 0 }, end, 6, null);
    assert.ok(fromGroundCtrl.control);
    assert.equal(fromGroundCtrl.control.y, 2);

    const fromHighCtrl = evaluateCurveCandidate(start, { x: 12, y: 4, z: 0 }, end, 6, null);
    assert.ok(fromHighCtrl.control);
    assert.equal(fromHighCtrl.control.y, 2);

    const seg: RoadSegment = {
      id: 'ramp_curve',
      a: 'a',
      b: 'b',
      width: 6,
      kind: 'curve',
      control: fromGroundCtrl.control,
    };
    const metrics = measureRoadSegment(start, end, seg);
    const avgGradePct = (4 / 22.9) * 100;
    assert.ok(metrics.maxSlopePct < 22, `Expected gentle ramp grade < 22%, got ${metrics.maxSlopePct}`);
    assert.ok(metrics.maxSlopePct <= avgGradePct + 3);
  });

  it('draws symmetric arcs in Free mode, enforces R < width/2, supports Shift straight, and falls back to corner > 75 deg', () => {
    const anchor: RoadNode = { id: 'n2', x: 20, y: 0, z: 0, role: 'normal' };
    const nodes: RoadNode[] = [
      { id: 'n1', x: 0, y: 0, z: 0, role: 'spawn' },
      anchor,
    ];
    const segs: RoadSegment[] = [{ id: 's1', a: 'n1', b: 'n2', width: 6, kind: 'straight' }];

    const freeTangent = resolveNodeContinuationTangent(anchor, nodes, segs);
    assert.ok(freeTangent && Math.abs(freeTangent.x - 1) < 1e-5 && Math.abs(freeTangent.z) < 1e-5);

    // 45 deg right turn -> symmetric arc
    const end45 = { x: 40, y: 0, z: 20 };
    const res45 = evaluateFreeCandidate(anchor, end45, nodes, segs, 6, null, { shiftHeld: false });
    assert.equal(res45.kind, 'curve');
    assert.equal(res45.cornerFallback, false);
    assert.ok(res45.control);
    const arm1 = Math.hypot(res45.control.x - anchor.x, res45.control.z - anchor.z);
    const arm2 = Math.hypot(end45.x - res45.control.x, end45.z - res45.control.z);
    assert.ok(Math.abs(arm1 - arm2) < 0.05);

    const expectedTheta = Math.PI / 4;
    const expectedR = Math.hypot(20, 20) / (2 * Math.sin(expectedTheta));
    assert.ok(Math.abs(res45.minRadius - expectedR) < 1e-3);
    assert.equal(res45.tooTightRadius, false);

    // Sharp 70 deg short turn with Wide road -> R < 5m triggers tooTightRadius
    const tightEnd = { x: 22, y: 0, z: 5.5 };
    const tightFree = evaluateFreeCandidate(anchor, tightEnd, nodes, segs, 10, null, { shiftHeld: false });
    assert.equal(tightFree.kind, 'curve');
    assert.equal(tightFree.tooTightRadius, true);

    // Shift forces straight
    const shiftRes = evaluateFreeCandidate(anchor, end45, nodes, segs, 6, null, { shiftHeld: true });
    assert.equal(shiftRes.kind, 'straight');
    assert.equal(shiftRes.control, null);

    // > 75 deg turn falls back to straight corner
    const sharpBack = { x: 18, y: 0, z: 20 };
    const resCorner = evaluateFreeCandidate(anchor, sharpBack, nodes, segs, 6, null, { shiftHeld: false });
    assert.equal(resCorner.kind, 'straight');
    assert.equal(resCorner.cornerFallback, true);
    assert.equal(resCorner.cornerHint, 'Turn too tight');
  });

  it('snaps Straight angle to 15-degree steps cleanly', () => {
    const anchor = { x: 0, y: 0, z: 0 };
    const raw = { x: 10, y: 0, z: 2.8 }; // ~15.6 deg
    const snapped = snapAngle15(anchor, raw, { x: 1, z: 0 });
    const cand = evaluateStraightCandidate(anchor, raw, { x: 1, z: 0 }, {
      angleSnap: true,
      altHeld: false,
      allowAngleSnap: true,
    });
    assert.equal(cand.usedAngleSnap, true);
    assert.equal(cand.angleDeg, 15);
    assert.equal(cand.endPos.x, snapped.x);
  });
});
