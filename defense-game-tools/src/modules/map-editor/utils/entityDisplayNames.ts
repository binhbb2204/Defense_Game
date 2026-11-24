import type { RoadNode, RoadSegment } from '@tactical-td/shared';

export interface EntityDisplayNames {
  nodeNames: Map<string, string>;
  segmentNames: Map<string, string>;
}

/**
 * Computes human-readable display names for nodes and road segments
 * so UI panels show clear labels (`Spawn 1`, `Node 2`, `Road 1`) while
 * keeping stable internal graph IDs untouched.
 */
export function buildEntityDisplayNames(
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
): EntityDisplayNames {
  const nodeNames = new Map<string, string>();
  const segmentNames = new Map<string, string>();

  let spawnCount = 0;
  let baseCount = 0;
  let normalCount = 0;

  for (const node of nodes) {
    const explicit = node.label?.trim();
    if (explicit) {
      nodeNames.set(node.id, explicit);
      continue;
    }
    if (node.role === 'spawn') {
      spawnCount += 1;
      nodeNames.set(node.id, `Spawn ${spawnCount}`);
    } else if (node.role === 'base') {
      baseCount += 1;
      nodeNames.set(node.id, `Base ${baseCount}`);
    } else {
      normalCount += 1;
      nodeNames.set(node.id, `Node ${normalCount}`);
    }
  }

  segments.forEach((seg, index) => {
    segmentNames.set(seg.id, `Road ${index + 1}`);
  });

  return { nodeNames, segmentNames };
}

export function getNodeDisplayName(names: EntityDisplayNames, node: RoadNode): string {
  return names.nodeNames.get(node.id) ?? (node.label?.trim() || node.id);
}

export function getSegmentDisplayName(names: EntityDisplayNames, seg: RoadSegment): string {
  return names.segmentNames.get(seg.id) ?? seg.id;
}

export function formatSegmentDisplay(
  names: EntityDisplayNames,
  seg: RoadSegment,
  index?: number,
): string {
  const base =
    names.segmentNames.get(seg.id) ??
    (typeof index === 'number' ? `Road ${index + 1}` : seg.id);
  const kindLabel = seg.kind === 'curve' ? 'Curve' : 'Straight';
  return `${base} (${kindLabel})`;
}
