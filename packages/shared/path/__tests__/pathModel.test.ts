import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HIGHWAY_01_MAP, MAP_SCHEMA_VERSION } from '../../index';
import { createEmptyMap, migrateMapDefinition } from '../mapMigration';
import {
  addNode,
  addSegment,
  connectedComponents,
  deleteNode,
  deleteSegment,
  evaluateRoadSegmentAt,
  findRoutes,
  snapToNode,
  snapToSegment,
  splitSegment,
} from '../roadGraph';
import { validateRoadGraph } from '../roadGraphValidator';

describe('Road Graph Data Model, Migration, Operations & Validator', () => {
  it('createEmptyMap produces clean v3 empty graph', () => {
    const empty = createEmptyMap();
    assert.equal(empty.version, MAP_SCHEMA_VERSION);
    assert.equal(empty.nodes?.length, 0);
    assert.equal(empty.segments?.length, 0);
    assert.equal(empty.waypoints.length, 0);
    assert.equal(empty.obstacles.length, 0);
  });

  it('migrates legacy highway_01.json into exactly 18 RoadNodes and 17 RoadSegments', () => {
    const migrated = migrateMapDefinition(HIGHWAY_01_MAP);
    assert.equal(migrated.version, MAP_SCHEMA_VERSION);
    assert.equal(migrated.nodes?.length, 18);
    assert.equal(migrated.segments?.length, 17);
    assert.equal(migrated.nodes![0]!.role, 'spawn');
    assert.equal(migrated.nodes![17]!.role, 'base');
    assert.equal(migrated.nodes![5]!.y, 4.6);
    assert.equal(migrated.segments![5]!.isOverpass, true);
    assert.equal(migrated.segments![13]!.isTunnel, true);
    assert.equal(migrated.waypoints.length, 18);

    // Idempotent second migration pass
    const again = migrateMapDefinition(migrated);
    assert.equal(again.nodes?.length, 18);
    assert.equal(again.segments?.length, 17);
  });

  it('builds 2 parallel independent roads that stay separate unless snapped/connected', () => {
    let nodes = addNode([], { x: -30, y: 0, z: -10 }, { role: 'spawn' }).nodes;
    const n2 = addNode(nodes, { x: 30, y: 0, z: -10 }, { role: 'base' });
    nodes = n2.nodes;

    const m1 = addNode(nodes, { x: -30, y: 0, z: 10 }, { role: 'spawn' });
    nodes = m1.nodes;
    const m2 = addNode(nodes, { x: 30, y: 0, z: 10 }, { role: 'base' });
    nodes = m2.nodes;

    let segments = addSegment(nodes, [], nodes[0]!.id, nodes[1]!.id).segments;
    segments = addSegment(nodes, segments, m1.node.id, m2.node.id).segments;

    const comps = connectedComponents(nodes, segments);
    assert.equal(comps.length, 2);
    assert.equal(comps[0]!.nodeIds.length, 2);
    assert.equal(comps[1]!.nodeIds.length, 2);

    const routes = findRoutes(nodes, segments);
    assert.equal(routes.length, 2);
  });

  it('splitSegment inserts a node in straight and curved segments with De Casteljau continuity', () => {
    // Straight split
    let nodes = addNode([], { x: 0, y: 0, z: 0 }).nodes;
    nodes = addNode(nodes, { x: 20, y: 0, z: 0 }).nodes;
    let segments = addSegment(nodes, [], nodes[0]!.id, nodes[1]!.id).segments;

    const stSplit = splitSegment(nodes, segments, segments[0]!.id, 0.5);
    assert.equal(stSplit.nodes.length, 3);
    assert.equal(stSplit.segments.length, 2);
    assert.equal(stSplit.insertedNode!.x, 10);
    assert.equal(stSplit.insertedNode!.z, 0);

    // Curved split
    let cNodes = addNode([], { x: 0, y: 0, z: 0 }).nodes;
    cNodes = addNode(cNodes, { x: 20, y: 0, z: 0 }).nodes;
    const cSegRes = addSegment(cNodes, [], cNodes[0]!.id, cNodes[1]!.id, {
      kind: 'curve',
      control: { x: 10, y: 0, z: 12 },
    });
    const origMid = evaluateRoadSegmentAt(cNodes[0]!, cNodes[1]!, cSegRes.segment!, 0.5).position;

    const cSplit = splitSegment(cNodes, cSegRes.segments, cSegRes.segment!.id, 0.5);
    assert.equal(cSplit.nodes.length, 3);
    assert.equal(cSplit.segments.length, 2);
    assert.ok(Math.abs(cSplit.insertedNode!.x - origMid.x) < 0.05);
    assert.ok(Math.abs(cSplit.insertedNode!.z - origMid.z) < 0.05);
    assert.equal(cSplit.leftSegment!.kind, 'curve');
    assert.equal(cSplit.rightSegment!.kind, 'curve');
  });

  it('deleteNode removes incident segments and reconnects degree-2 middle nodes', () => {
    let nodes = addNode([], { x: -20, y: 0, z: 0 }, { role: 'spawn' }).nodes;
    const nMid = addNode(nodes, { x: 0, y: 0, z: 5 }).node;
    nodes = [...nodes, nMid];
    const nEnd = addNode(nodes, { x: 20, y: 0, z: 0 }, { role: 'base' }).node;
    nodes = [...nodes, nEnd];

    let segments = addSegment(nodes, [], nodes[0]!.id, nMid.id).segments;
    segments = addSegment(nodes, segments, nMid.id, nEnd.id).segments;

    const del = deleteNode(nodes, segments, nMid.id);
    assert.equal(del.nodes.length, 2);
    assert.equal(del.segments.length, 1);
    assert.ok(del.reconnectedSegment);
    assert.equal(del.reconnectedSegment!.a, nodes[0]!.id);
    assert.equal(del.reconnectedSegment!.b, nEnd.id);

    // Deleting a 3-way junction node removes incident segments WITHOUT creating a spurious edge
    let jNodes = del.nodes;
    const jCenter = addNode(jNodes, { x: 0, y: 0, z: 0 }).node;
    jNodes = [...jNodes, jCenter];
    const jBranch = addNode(jNodes, { x: 0, y: 0, z: 20 }, { role: 'base' }).node;
    jNodes = [...jNodes, jBranch];

    let jSegs = addSegment(jNodes, [], jNodes[0]!.id, jCenter.id).segments;
    jSegs = addSegment(jNodes, jSegs, jCenter.id, nEnd.id).segments;
    jSegs = addSegment(jNodes, jSegs, jCenter.id, jBranch.id).segments;

    const jDel = deleteNode(jNodes, jSegs, jCenter.id);
    assert.equal(jDel.reconnectedSegment, null);
    assert.equal(jDel.segments.length, 0);

    // deleteSegment removes single segment cleanly
    const pruned = deleteSegment(jSegs, jSegs[0]!.id);
    assert.equal(pruned.length, 2);
  });

  it('findRoutes computes multi-branch weights & probabilities accurately', () => {
    let nodes = addNode([], { x: -20, y: 0, z: 0 }, { role: 'spawn' }).nodes;
    const splitRes = addNode(nodes, { x: 0, y: 0, z: 0 });
    nodes = splitRes.nodes;
    const baseTop = addNode(nodes, { x: 20, y: 0, z: -10 }, { role: 'base' }).node;
    nodes = [...nodes, baseTop];
    const baseBot = addNode(nodes, { x: 20, y: 0, z: 10 }, { role: 'base' }).node;
    nodes = [...nodes, baseBot];

    let segments = addSegment(nodes, [], nodes[0]!.id, splitRes.node.id).segments;
    segments = addSegment(nodes, segments, splitRes.node.id, baseTop.id, { weight: 3 }).segments;
    segments = addSegment(nodes, segments, splitRes.node.id, baseBot.id, { weight: 1 }).segments;

    const routes = findRoutes(nodes, segments);
    assert.equal(routes.length, 2);
    const rTop = routes.find((r) => r.baseId === baseTop.id)!;
    const rBot = routes.find((r) => r.baseId === baseBot.id)!;
    assert.ok(Math.abs(rTop.probability - 0.75) < 1e-6);
    assert.ok(Math.abs(rBot.probability - 0.25) < 1e-6);
  });

  it('snapToNode, snapToSegment, and validateRoadGraph catch real hazards cleanly', () => {
    let nodes = addNode([], { x: -20, y: 0, z: 0 }, { role: 'spawn' }).nodes;
    const n2 = addNode(nodes, { x: 20, y: 0, z: 0 }, { role: 'normal' }).node; // Note: no base yet!
    nodes = [...nodes, n2];
    const isolated = addNode(nodes, { x: 35, y: 0, z: 25 }, { role: 'normal' }).node;
    nodes = [...nodes, isolated];

    let segments = addSegment(nodes, [], nodes[0]!.id, n2.id).segments;

    // Crossing ground road without shared node
    const c1 = addNode(nodes, { x: 0, y: 0, z: -15 }).node;
    nodes = [...nodes, c1];
    const c2 = addNode(nodes, { x: 0, y: 0, z: 15 }).node;
    nodes = [...nodes, c2];
    segments = addSegment(nodes, segments, c1.id, c2.id).segments;

    // Elevated overpass (>= 2.5m above ground): must NOT trigger crossing warning
    const o1 = addNode(nodes, { x: -10, y: 5, z: -15 }).node;
    nodes = [...nodes, o1];
    const o2 = addNode(nodes, { x: -10, y: 5, z: 15 }).node;
    nodes = [...nodes, o2];
    segments = addSegment(nodes, segments, o1.id, o2.id).segments;

    const nodeHit = snapToNode(nodes, { x: -19.2, z: 0.5 }, 2.0);
    assert.equal(nodeHit?.node.id, nodes[0]!.id);

    const segHit = snapToSegment(nodes, segments, { x: 10, z: 1.0 }, 2.0);
    assert.equal(segHit?.segment.id, segments[0]!.id);

    const issues = validateRoadGraph({
      ...createEmptyMap(),
      nodes,
      segments,
      obstacles: [
        {
          id: 'obs_block',
          kind: 'container',
          position: { x: 8, y: 1.5, z: 0 },
          size: { x: 4, y: 3, z: 4 },
          blocksLoS: true,
        },
      ],
    });

    const codes = new Set(issues.map((i) => i.code));
    assert.ok(codes.has('ISOLATED_NODE'));
    assert.ok(codes.has('SPAWN_NO_ROUTE'));
    assert.ok(codes.has('PROP_OVERLAPS_ROAD'));
    assert.ok(codes.has('ROAD_CROSSING_NO_NODE'));
    const crossings = issues.filter((i) => i.code === 'ROAD_CROSSING_NO_NODE');
    assert.equal(crossings.length, 1);
  });
});
