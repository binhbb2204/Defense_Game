import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  computeSafeShapeParams,
  findSection,
  getMapGraph,
  syncGraphToLegacyWaypoints,
  type MapDefinition,
  type ShapeMode,
} from '@tactical-td/shared';
import type { ShapePreviewRenderData } from '../rendering';
import type { ConsoleLogEntry, EditorTool, SelectionItem } from '../types';
import {
  buildShapePreviewRenderData,
  evaluateShapePreview,
  isChainShapeMode,
} from './shapeToolEvaluator';

export type ShapePickStep = 'pick_start' | 'pick_end' | 'ready';

export interface ShapeToolParams {
  tension: number;
  handleFactor: number;
  spacing: number;
  useNodeCount: boolean;
  nodeCount: number;
  equaliseSpacing: boolean;
  cornerRadius: number;
  connectRadius: number;
  parallelOffset: number;
  parallelSide: 'left' | 'right';
}

const DEFAULT_PARAMS: ShapeToolParams = {
  tension: 0.5,
  handleFactor: 0.4,
  spacing: 8,
  useNodeCount: false,
  nodeCount: 4,
  equaliseSpacing: false,
  cornerRadius: 10,
  connectRadius: 12,
  parallelOffset: 9,
  parallelSide: 'right',
};

/** Manages Shape tool state, section discovery, live pure preview evaluation, safety limiters, and 1-step Undo commit. */
export function useShapeTool({
  map,
  activeTool,
  anarchyEnabled,
  commitMap,
  onSetActiveTool,
  onNotify,
  pushLog,
}: {
  map: MapDefinition;
  activeTool: EditorTool;
  anarchyEnabled: boolean;
  commitMap: (next: MapDefinition, pushHistory?: boolean) => void;
  onSetActiveTool: (tool: EditorTool) => void;
  onNotify: (type: 'ok' | 'err', msg: string) => void;
  pushLog: (tag: string, level: ConsoleLogEntry['level'], message: string) => void;
}) {
  const [mode, setModeState] = useState<ShapeMode>('smooth');
  const [step, setStep] = useState<ShapePickStep>('pick_start');
  const [startNodeId, setStartNodeId] = useState<string | null>(null);
  const [endNodeId, setEndNodeId] = useState<string | null>(null);
  const [viaNodeId, setViaNodeId] = useState<string | null>(null);
  const [connectSegAId, setConnectSegAId] = useState<string | null>(null);
  const [connectSegBId, setConnectSegBId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useState<ShapeToolParams>(DEFAULT_PARAMS);

  const graph = useMemo(() => getMapGraph(map), [map]);

  const cancelSession = useCallback(() => {
    setStep('pick_start');
    setStartNodeId(null);
    setEndNodeId(null);
    setViaNodeId(null);
    setConnectSegAId(null);
    setConnectSegBId(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (activeTool !== 'shape') cancelSession();
  }, [activeTool, cancelSession]);

  const setMode = useCallback(
    (nextMode: ShapeMode) => {
      setError(null);
      if (nextMode === 'round_corner' || nextMode === 'connect') {
        setModeState(nextMode);
        cancelSession();
        return;
      }
      setModeState(nextMode);
      if (!isChainShapeMode(mode)) cancelSession();
    },
    [mode, cancelSession],
  );

  const sectionResult = useMemo(() => {
    if (!isChainShapeMode(mode) || !startNodeId || !endNodeId) return null;
    return findSection(graph.nodes, graph.segments, startNodeId, endNodeId, viaNodeId ?? undefined);
  }, [mode, startNodeId, endNodeId, viaNodeId, graph.nodes, graph.segments]);

  const preview = useMemo(
    () =>
      evaluateShapePreview({
        mode,
        step,
        activeToolActive: activeTool === 'shape',
        startNodeId,
        connectSegAId,
        connectSegBId,
        sectionResult,
        nodes: graph.nodes,
        segments: graph.segments,
        params,
        anarchyEnabled,
      }),
    [mode, step, activeTool, startNodeId, connectSegAId, connectSegBId, sectionResult, graph.nodes, graph.segments, params, anarchyEnabled],
  );

  const shapePreviewData = useMemo(
    () =>
      buildShapePreviewRenderData({
        activeToolActive: activeTool === 'shape',
        mode,
        step,
        startNodeId,
        endNodeId,
        connectSegAId,
        connectSegBId,
        sectionResult,
        preview,
        nodes: graph.nodes,
        segments: graph.segments,
      }),
    [activeTool, mode, step, startNodeId, endNodeId, connectSegAId, connectSegBId, sectionResult, preview, graph.nodes, graph.segments],
  );

  const shapePreviewDataRef = useRef<ShapePreviewRenderData | null>(null);
  shapePreviewDataRef.current = shapePreviewData;

  const handleViewportPick = useCallback(
    (picked: SelectionItem | null) => {
      if (!picked) {
        setError(null);
        return;
      }
      if (mode === 'connect') {
        if (picked.type !== 'road_segment') {
          setError('Connect mode: click two separate road segments.');
          return;
        }
        if (step === 'pick_start' || step === 'ready') {
          setConnectSegAId(picked.id);
          setConnectSegBId(null);
          setStep('pick_end');
          setError(null);
          return;
        }
        if (picked.id === connectSegAId) {
          setError('Pick a different second segment.');
          return;
        }
        setConnectSegBId(picked.id);
        setStep('ready');
        setError(null);
        return;
      }

      if (picked.type !== 'road_node') {
        setError('Click a Road Node.');
        return;
      }
      if (mode === 'round_corner') {
        setStartNodeId(picked.id);
        setEndNodeId(null);
        setStep('ready');
        setError(null);
        return;
      }
      if (step === 'pick_start') {
        setStartNodeId(picked.id);
        setEndNodeId(null);
        setViaNodeId(null);
        setStep('pick_end');
        setError(null);
        return;
      }
      if (step === 'pick_end') {
        if (picked.id === startNodeId) return;
        const found = findSection(graph.nodes, graph.segments, startNodeId!, picked.id);
        if (!found.section) {
          setError(found.warning ?? 'No valid degree-2 section between these nodes.');
          onNotify('err', found.warning ?? 'Invalid section');
          return;
        }
        setEndNodeId(picked.id);
        setViaNodeId(null);
        setError(null);
        setStep('ready');
        return;
      }

      if (
        sectionResult &&
        sectionResult.alternatives.length > 1 &&
        picked.id !== startNodeId &&
        picked.id !== endNodeId &&
        sectionResult.alternatives.some((alt) => alt.nodeIds.includes(picked.id))
      ) {
        setViaNodeId(picked.id);
        setError(null);
        return;
      }

      setStartNodeId(picked.id);
      setEndNodeId(null);
      setViaNodeId(null);
      setStep('pick_end');
      setError(null);
    },
    [mode, step, connectSegAId, startNodeId, endNodeId, graph.nodes, graph.segments, sectionResult, onNotify],
  );

  const limitCurvature = useCallback(() => {
    const safe = computeSafeShapeParams(mode, graph.nodes, graph.segments, sectionResult?.section ?? null, {
      tension: params.tension,
      handleFactor: params.handleFactor,
      spacing: params.spacing,
      radius: mode === 'round_corner' ? params.cornerRadius : params.connectRadius,
      singleNodeId: startNodeId ?? undefined,
    });
    setParams((prev) => ({
      ...prev,
      ...(safe.tension !== undefined ? { tension: safe.tension } : {}),
      ...(safe.handleFactor !== undefined ? { handleFactor: safe.handleFactor } : {}),
      ...(safe.radius !== undefined ? { cornerRadius: safe.radius } : {}),
    }));
    pushLog('Shape', 'action', 'Adjusted parameters to satisfy minimum bend radius.');
  }, [mode, graph.nodes, graph.segments, sectionResult, params, startNodeId, pushLog]);

  const applyShape = useCallback(() => {
    if (!preview) return;
    if (!preview.allowed) {
      onNotify('err', preview.blockedReason ?? 'Shape operation blocked.');
      return;
    }
    if (!anarchyEnabled && preview.violations.length > 0) {
      onNotify('err', 'Curvature radius < width/2 — click Limit curvature or enable Anarchy.');
      return;
    }
    const nextMap = syncGraphToLegacyWaypoints({ ...map, nodes: preview.nodes, segments: preview.segments });
    commitMap(nextMap);
    pushLog('Shape', 'ok', `Applied Shape "${mode}" (${preview.affectedSegmentIds.length} segments).`);
    onNotify('ok', `Applied ${mode}`);
    cancelSession();
  }, [preview, anarchyEnabled, map, commitMap, mode, pushLog, onNotify, cancelSession]);

  const handleEscape = useCallback(() => {
    if (startNodeId || connectSegAId) {
      cancelSession();
      return;
    }
    onSetActiveTool('t-select');
  }, [startNodeId, connectSegAId, cancelSession, onSetActiveTool]);

  const cycleAlternative = useCallback(() => {
    if (!sectionResult || sectionResult.alternatives.length < 2) return;
    const alts = sectionResult.alternatives;
    const curIdx = alts.findIndex((a) => a === sectionResult.section);
    const nextAlt = alts[(curIdx + 1) % alts.length]!;
    setViaNodeId(nextAlt.nodeIds[1] ?? null);
  }, [sectionResult]);

  return {
    mode,
    setMode,
    step,
    params,
    updateParams: (patch: Partial<ShapeToolParams>) => setParams((prev) => ({ ...prev, ...patch })),
    sectionResult,
    error,
    preview,
    shapePreviewData,
    shapePreviewDataRef,
    handleViewportPick,
    limitCurvature,
    applyShape,
    cancelSession,
    handleEscape,
    cycleAlternative,
  };
}
