import type { RoadNode, RoadSegment } from '../../types/protocol';
import type { DirtyRoadRegion } from './types';

/**
 * Collects the local multi-hop dirty neighborhood around moved/edited node IDs
 * so live dragging only needs to rebuild nearby geometry.
 */
export function collectDirtyRegion(
  _nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
  movedNodeIds: ReadonlySet<string>,
  hops = 2
): DirtyRoadRegion {
  const dirtyNodes = new Set<string>(movedNodeIds);
  const dirtySegments = new Set<string>();

  for (let h = 0; h < hops; h++) {
    const frontierNext: string[] = [];
    for (const seg of segments) {
      const aDirty = dirtyNodes.has(seg.a);
      const bDirty = dirtyNodes.has(seg.b);
      if (aDirty || bDirty) {
        dirtySegments.add(seg.id);
        if (!aDirty) frontierNext.push(seg.a);
        if (!bDirty) frontierNext.push(seg.b);
      }
    }
    for (const id of frontierNext) dirtyNodes.add(id);
  }

  return {
    nodeIds: dirtyNodes,
    segmentIds: dirtySegments,
  };
}
