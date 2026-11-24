import type { RoadNode } from '../../../types/protocol';
import type { HalfEdge, JointContext } from '../types';

/**
 * Abstract base contract for per-node road joint resolution (OCP / Liskov Substitution).
 */
export abstract class BaseJointResolver {
  abstract canHandle(degree: number): boolean;

  abstract computeRequestedTrims(
    node: RoadNode,
    halfEdges: HalfEdge[],
    ctx: JointContext
  ): void;

  abstract recomputeScaledEndpoints(
    node: RoadNode,
    halfEdges: HalfEdge[],
    ctx: JointContext
  ): void;

  abstract emitJointGeometry(
    node: RoadNode,
    halfEdges: HalfEdge[],
    ctx: JointContext
  ): void;
}
