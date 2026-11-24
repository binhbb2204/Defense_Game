import type { RoadNode } from '../../types/protocol';
import { computeSegmentFlowDirections } from '../graph';
import { traceChainUvOffsets } from './chainUvTracer';
import { BaseJointResolver } from './joints/BaseJointResolver';
import { DeadEndJointResolver } from './joints/DeadEndJointResolver';
import { JunctionJointResolver } from './joints/JunctionJointResolver';
import { ThroughJointResolver } from './joints/ThroughJointResolver';
import { EPS, buildSegmentCache, perpLeftXZ, perpRightXZ, v3 } from './math2d';
import { MeshBuilder } from './meshBuilder';
import { emitSegmentStripsAndArrows } from './stripEmitter';
import type {
  HalfEdge,
  JointContext,
  ResolvedRoadGeometryOptions,
  RoadGeometryInput,
  RoadGeometryOptions,
  RoadGeometryResult,
  SegmentCache,
} from './types';

function resolveOptions(options: RoadGeometryOptions): ResolvedRoadGeometryOptions {
  return {
    joinStyle: options.joinStyle ?? 'miter',
    miterLimit: Math.max(1.0, options.miterLimit ?? 2.0),
    cornerRadius: Math.max(0, options.cornerRadius ?? 0.45),
    curveSubdivisions: Math.max(4, Math.floor(options.curveSubdivisions ?? 24)),
    yOffset: options.yOffset ?? 0.02,
    arrowSpacing: Math.max(1.5, options.arrowSpacing ?? 7.5),
    arrowLength: Math.max(0.4, options.arrowLength ?? 1.6),
    arrowWidthRatio: Math.max(0.1, Math.min(0.6, options.arrowWidthRatio ?? 0.28)),
    uvVPeriodMeters: Math.max(0.5, options.uvVPeriodMeters ?? 4.0),
    maxCornerDistMult: Math.max(1.5, options.maxCornerDistMultiplier ?? 3.2),
    roundSegments: Math.max(3, Math.floor(options.roundSegments ?? 6)),
  };
}

/**
 * Orchestrates per-node watertight road geometry generation via polymorphic BaseJointResolvers.
 */
export class RoadGeometryPipeline {
  private readonly resolvers: readonly BaseJointResolver[];

  constructor(resolvers?: readonly BaseJointResolver[]) {
    this.resolvers = resolvers ?? [
      new DeadEndJointResolver(),
      new ThroughJointResolver(),
      new JunctionJointResolver(),
    ];
  }

  private resolveFor(degree: number): BaseJointResolver | null {
    return this.resolvers.find((r) => r.canHandle(degree)) ?? null;
  }

  build(graph: RoadGeometryInput, options: RoadGeometryOptions = {}): RoadGeometryResult {
    const resolved = resolveOptions(options);
    const nodeMap = new Map<string, RoadNode>();
    for (const n of graph.nodes) nodeMap.set(n.id, n);

    const flowDirs = computeSegmentFlowDirections(graph.nodes, graph.segments);
    const segCaches: SegmentCache[] = [];
    const halfEdgesByNode = new Map<string, HalfEdge[]>();
    const halfEdgePairBySeg = new Map<number, { a: HalfEdge; b: HalfEdge }>();
    for (const n of graph.nodes) halfEdgesByNode.set(n.id, []);

    for (let i = 0; i < graph.segments.length; i++) {
      const seg = graph.segments[i];
      const nodeA = nodeMap.get(seg.a);
      const nodeB = nodeMap.get(seg.b);
      if (!nodeA || !nodeB || seg.a === seg.b) continue;

      const cache = buildSegmentCache(
        i,
        seg,
        nodeA,
        nodeB,
        flowDirs.get(seg.id) ?? 1,
        graph.nodes,
        graph.segments
      );
      if (cache.totalLen < 1e-4) continue;
      segCaches.push(cache);

      const heA: HalfEdge = {
        segIdx: i,
        end: 'a',
        nodeId: nodeA.id,
        otherNodeId: nodeB.id,
        halfW: cache.halfW,
        outDir: cache.outDirA,
        outLeft: perpLeftXZ(cache.outDirA),
        outRight: perpRightXZ(cache.outDirA),
        angle: Math.atan2(cache.outDirA.z, cache.outDirA.x),
        trimDist: 0,
        leftVert: v3(
          nodeA.x + perpLeftXZ(cache.outDirA).x * cache.halfW,
          nodeA.y,
          nodeA.z + perpLeftXZ(cache.outDirA).z * cache.halfW
        ),
        rightVert: v3(
          nodeA.x + perpRightXZ(cache.outDirA).x * cache.halfW,
          nodeA.y,
          nodeA.z + perpRightXZ(cache.outDirA).z * cache.halfW
        ),
        patchLeftIdx: -1,
        patchRightIdx: -1,
      };

      const heB: HalfEdge = {
        segIdx: i,
        end: 'b',
        nodeId: nodeB.id,
        otherNodeId: nodeA.id,
        halfW: cache.halfW,
        outDir: cache.outDirB,
        outLeft: perpLeftXZ(cache.outDirB),
        outRight: perpRightXZ(cache.outDirB),
        angle: Math.atan2(cache.outDirB.z, cache.outDirB.x),
        trimDist: 0,
        leftVert: v3(
          nodeB.x + perpLeftXZ(cache.outDirB).x * cache.halfW,
          nodeB.y,
          nodeB.z + perpLeftXZ(cache.outDirB).z * cache.halfW
        ),
        rightVert: v3(
          nodeB.x + perpRightXZ(cache.outDirB).x * cache.halfW,
          nodeB.y,
          nodeB.z + perpRightXZ(cache.outDirB).z * cache.halfW
        ),
        patchLeftIdx: -1,
        patchRightIdx: -1,
      };

      halfEdgesByNode.get(nodeA.id)!.push(heA);
      halfEdgesByNode.get(nodeB.id)!.push(heB);
      halfEdgePairBySeg.set(i, { a: heA, b: heB });
    }

    const cacheBySegIdx = new Map<number, SegmentCache>();
    for (const c of segCaches) cacheBySegIdx.set(c.segIdx, c);

    const builder = new MeshBuilder();
    const segFlowEndV = traceChainUvOffsets(graph.nodes, segCaches, cacheBySegIdx, halfEdgesByNode);
    const ctx: JointContext = {
      builder,
      cacheBySegIdx,
      segFlowEndV,
      degree2Map: new Map(),
      junctionMap: new Map(),
      edgePolylines: [],
      debugMiterPoints: [],
      debugTrimPoints: [],
      debugJunctionPolygons: [],
      options: resolved,
    };

    // Step 1: Initial per-node trims
    for (const node of graph.nodes) {
      const hes = halfEdgesByNode.get(node.id)!;
      this.resolveFor(hes.length)?.computeRequestedTrims(node, hes, ctx);
    }

    // Step 2: Global short-segment proportional scaling + recompute endpoints
    for (const cache of segCaches) {
      const pair = halfEdgePairBySeg.get(cache.segIdx);
      if (!pair) continue;
      const sumTrim = pair.a.trimDist + pair.b.trimDist;
      const maxBudget = cache.totalLen * 0.94;
      if (sumTrim > maxBudget && sumTrim > EPS) {
        const scale = maxBudget / sumTrim;
        pair.a.trimDist *= scale;
        pair.b.trimDist *= scale;
      }
    }

    for (const node of graph.nodes) {
      const hes = halfEdgesByNode.get(node.id)!;
      this.resolveFor(hes.length)?.recomputeScaledEndpoints(node, hes, ctx);
    }

    // Step 3: Emit joint patches & seam vertices
    for (const node of graph.nodes) {
      const hes = halfEdgesByNode.get(node.id)!;
      this.resolveFor(hes.length)?.emitJointGeometry(node, hes, ctx);
    }

    // Step 4: Emit segment strips, outer polylines, and chevron arrows
    const stripOut = emitSegmentStripsAndArrows(
      segCaches,
      halfEdgePairBySeg,
      halfEdgesByNode,
      segFlowEndV,
      builder,
      ctx.edgePolylines,
      resolved
    );

    return {
      positions: new Float32Array(builder.positions),
      normals: new Float32Array(builder.normals),
      uvs: new Float32Array(builder.uvs),
      indices: new Uint32Array(builder.indices),
      edgePolylines: ctx.edgePolylines,
      arrowStrips: stripOut.arrowStrips,
      debug: {
        centrelines: stripOut.centrelines,
        offsetEdges: stripOut.offsetEdges,
        miterPoints: ctx.debugMiterPoints,
        trimPoints: ctx.debugTrimPoints,
        junctionPolygons: ctx.debugJunctionPolygons,
        segmentTrimDistances: stripOut.segmentTrimDistances,
      },
    };
  }
}

const defaultPipeline = new RoadGeometryPipeline();

export function buildRoadGeometry(
  graph: RoadGeometryInput,
  options: RoadGeometryOptions = {}
): RoadGeometryResult {
  return defaultPipeline.build(graph, options);
}
