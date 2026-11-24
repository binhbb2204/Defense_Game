import type { RoadNode } from '../../../types/protocol';
import { addV3, scaleV3, v3 } from '../math2d';
import type { HalfEdge, JointContext } from '../types';
import { BaseJointResolver } from './BaseJointResolver';

export class DeadEndJointResolver extends BaseJointResolver {
  canHandle(degree: number): boolean {
    return degree === 1;
  }

  computeRequestedTrims(
    node: RoadNode,
    halfEdges: HalfEdge[],
    _ctx: JointContext
  ): void {
    const he = halfEdges[0];
    he.trimDist = 0;
    he.leftVert = addV3(node, scaleV3(he.outLeft, he.halfW));
    he.rightVert = addV3(node, scaleV3(he.outRight, he.halfW));
  }

  recomputeScaledEndpoints(
    node: RoadNode,
    halfEdges: HalfEdge[],
    _ctx: JointContext
  ): void {
    const he = halfEdges[0];
    he.leftVert = addV3(node, scaleV3(he.outLeft, he.halfW));
    he.rightVert = addV3(node, scaleV3(he.outRight, he.halfW));
  }

  emitJointGeometry(
    _node: RoadNode,
    halfEdges: HalfEdge[],
    ctx: JointContext
  ): void {
    const he = halfEdges[0];
    const uvInfo = ctx.segFlowEndV.get(he.segIdx)!;
    const endV = he.end === 'a' ? uvInfo.vStart : uvInfo.vEnd;
    const leftU = he.end === 'a' ? 1 : 0;
    const rightU = he.end === 'a' ? 0 : 1;
    const { yOffset, uvVPeriodMeters } = ctx.options;

    he.patchLeftIdx = ctx.builder.addVertex(he.leftVert, leftU, endV / uvVPeriodMeters, yOffset);
    he.patchRightIdx = ctx.builder.addVertex(he.rightVert, rightU, endV / uvVPeriodMeters, yOffset);
    ctx.edgePolylines.push([
      v3(he.leftVert.x, he.leftVert.y + yOffset, he.leftVert.z),
      v3(he.rightVert.x, he.rightVert.y + yOffset, he.rightVert.z),
    ]);
  }
}
