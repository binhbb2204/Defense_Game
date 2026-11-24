import {
  connectSegments,
  curveBetween,
  parallelSection,
  reverseSection,
  roundCorner,
  smoothSection,
  straightenSection,
  type FindSectionResult,
  type RoadNode,
  type RoadSegment,
  type ShapeMode,
  type ShapeOperationResult,
} from '@tactical-td/shared';
import type { ShapePreviewRenderData } from '../rendering';
import type { ShapePickStep, ShapeToolParams } from './useShapeTool';

export const isChainShapeMode = (m: ShapeMode) =>
  m === 'smooth' || m === 'curve' || m === 'straighten' || m === 'reverse' || m === 'parallel';

export function evaluateShapePreview({
  mode,
  step,
  activeToolActive,
  startNodeId,
  connectSegAId,
  connectSegBId,
  sectionResult,
  nodes,
  segments,
  params,
  anarchyEnabled,
}: {
  mode: ShapeMode;
  step: ShapePickStep;
  activeToolActive: boolean;
  startNodeId: string | null;
  connectSegAId: string | null;
  connectSegBId: string | null;
  sectionResult: FindSectionResult | null;
  nodes: readonly RoadNode[];
  segments: readonly RoadSegment[];
  params: ShapeToolParams;
  anarchyEnabled: boolean;
}): ShapeOperationResult | null {
  if (!activeToolActive || step !== 'ready') return null;
  if (mode === 'round_corner') {
    return startNodeId
      ? roundCorner(nodes, segments, startNodeId, { radius: params.cornerRadius, anarchyEnabled })
      : null;
  }
  if (mode === 'connect') {
    return connectSegAId && connectSegBId
      ? connectSegments(nodes, segments, connectSegAId, connectSegBId, {
          radius: params.connectRadius,
          anarchyEnabled,
        })
      : null;
  }

  const sec = sectionResult?.section;
  if (!sec) return null;
  if (mode === 'smooth') {
    return smoothSection(nodes, segments, sec, { tension: params.tension, anarchyEnabled });
  }
  if (mode === 'curve') {
    return curveBetween(nodes, segments, sec, {
      handleFactor: params.handleFactor,
      spacing: params.useNodeCount ? undefined : params.spacing,
      nodeCount: params.useNodeCount ? params.nodeCount : undefined,
      tension: params.tension,
      anarchyEnabled,
    });
  }
  if (mode === 'straighten') {
    return straightenSection(nodes, segments, sec, {
      equaliseSpacing: params.equaliseSpacing,
      anarchyEnabled,
    });
  }
  if (mode === 'reverse') {
    return reverseSection(nodes, segments, sec);
  }
  return parallelSection(nodes, segments, sec, {
    offset: params.parallelOffset,
    side: params.parallelSide,
    spacing: params.spacing,
    anarchyEnabled,
  });
}

export function buildShapePreviewRenderData({
  activeToolActive,
  mode,
  step,
  startNodeId,
  endNodeId,
  connectSegAId,
  connectSegBId,
  sectionResult,
  preview,
  nodes,
  segments,
}: {
  activeToolActive: boolean;
  mode: ShapeMode;
  step: ShapePickStep;
  startNodeId: string | null;
  endNodeId: string | null;
  connectSegAId: string | null;
  connectSegBId: string | null;
  sectionResult: FindSectionResult | null;
  preview: ShapeOperationResult | null;
  nodes: readonly RoadNode[];
  segments: readonly RoadSegment[];
}): ShapePreviewRenderData | null {
  if (!activeToolActive || (!startNodeId && !connectSegAId)) return null;
  const replacedSegmentIds = new Set<string>();
  if (step === 'ready' && preview?.allowed && mode !== 'parallel') {
    if (mode === 'round_corner' && startNodeId) {
      for (const s of segments) {
        if (s.a === startNodeId || s.b === startNodeId) replacedSegmentIds.add(s.id);
      }
    } else if (sectionResult?.section) {
      for (const sid of sectionResult.section.segmentIds) replacedSegmentIds.add(sid);
    }
  }
  return {
    originalNodes: nodes,
    originalSegments: segments,
    replacedSegmentIds,
    startNodeId,
    endNodeId,
    connectSegIds: [connectSegAId, connectSegBId].filter((id): id is string => Boolean(id)),
    originalSectionNodeIds: sectionResult?.section?.nodeIds ?? [],
    originalSectionSegIds: sectionResult?.section?.segmentIds ?? [],
    isParallel: mode === 'parallel',
    preview,
  };
}
