import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  RoadBuildMode,
  RoadJoinStyle,
  RoadNodeRole,
  WaypointElevationMode,
} from '@tactical-td/shared';
import type { RoadPreviewHudState, RoadRuntimeConfig } from '../engine';
import type { RoadToolState, SnapHitKind } from '../tools';
import type { EditorTool } from '../types';

export const MIN_DRAW_ELEVATION = 0;
export const MAX_DRAW_ELEVATION = 24;

export function useRoadToolConfig(_defaultRoadWidth: number, activeTool: EditorTool) {
  const [roadState, setRoadState] = useState<RoadToolState>({ status: 'idle' });
  const [roadBuildMode, setRoadBuildMode] = useState<RoadBuildMode>('straight');
  const [roadUpgradeMode, setRoadUpgradeMode] = useState(false);
  const [angleSnap, setAngleSnap] = useState(false);
  const [roadJoinStyle, setRoadJoinStyle] = useState<RoadJoinStyle>('miter');
  const [newNodeRole, setNewNodeRole] = useState<RoadNodeRole>('normal');
  const [roadWidth, setRoadWidth] = useState(6);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [gridEnabled, setGridEnabled] = useState(true);
  const [gridStep, setGridStep] = useState(2);
  const [snapRadius, setSnapRadius] = useState(2.8);
  const [autoIntersect, setAutoIntersect] = useState(true);
  const [anarchyEnabled, setAnarchyEnabled] = useState(false);
  const [showRoadDebug, setShowRoadDebug] = useState(false);
  const [drawElevation, setDrawElevation] = useState(0);
  const [drawElevationMode, setDrawElevationMode] = useState<WaypointElevationMode>('ground');
  const [selectedRoadPart, setSelectedRoadPart] = useState('');
  const [activeSnapKind, setActiveSnapKind] = useState<SnapHitKind>('grid');
  const [roadBlockedReason, setRoadBlockedReason] = useState<string | null>(null);
  const [roadPreviewHud, setRoadPreviewHud] = useState<RoadPreviewHudState | null>(null);

  const drawElevationRef = useRef(drawElevation);
  drawElevationRef.current = drawElevation;

  const drawElevationModeRef = useRef(drawElevationMode);
  drawElevationModeRef.current = drawElevationMode;

  const stepElevation = useCallback((delta: number) => {
    const nextY = Math.max(
      MIN_DRAW_ELEVATION,
      Math.min(MAX_DRAW_ELEVATION, drawElevationRef.current + delta),
    );
    drawElevationRef.current = nextY;
    setDrawElevation(nextY);
    if (nextY > 0 && drawElevationModeRef.current === 'ground') {
      drawElevationModeRef.current = 'bridge';
      setDrawElevationMode('bridge');
    } else if (
      nextY === 0 &&
      (drawElevationModeRef.current === 'bridge' || drawElevationModeRef.current === 'elevated')
    ) {
      drawElevationModeRef.current = 'ground';
      setDrawElevationMode('ground');
    }
  }, []);

  const resetElevation = useCallback(() => {
    drawElevationRef.current = 0;
    setDrawElevation(0);
    if (drawElevationModeRef.current === 'bridge' || drawElevationModeRef.current === 'elevated') {
      drawElevationModeRef.current = 'ground';
      setDrawElevationMode('ground');
    }
  }, []);

  const selectElevationMode = useCallback((mode: WaypointElevationMode) => {
    drawElevationModeRef.current = mode;
    setDrawElevationMode(mode);
    if (mode === 'ground') {
      drawElevationRef.current = 0;
      setDrawElevation(0);
    } else if ((mode === 'bridge' || mode === 'elevated') && drawElevationRef.current <= 0) {
      drawElevationRef.current = 4;
      setDrawElevation(4);
    }
  }, []);

  const adoptElevation = useCallback((y: number) => {
    if (drawElevationRef.current <= 0 && y > 0.5) {
      const clamped = Math.min(MAX_DRAW_ELEVATION, Math.max(0, Number(y.toFixed(1))));
      drawElevationRef.current = clamped;
      setDrawElevation(clamped);
      if (drawElevationModeRef.current === 'ground') {
        drawElevationModeRef.current = 'bridge';
        setDrawElevationMode('bridge');
      }
    }
  }, []);

  const selectRoadBuildMode = useCallback((mode: RoadBuildMode) => {
    setRoadBuildMode(mode);
    setRoadUpgradeMode(false);
    setRoadBlockedReason(null);
    setRoadState((s) => (s.status === 'drawing' ? { ...s, curveControl: null } : s));
  }, []);

  const toggleRoadUpgradeMode = useCallback(() => {
    setRoadUpgradeMode((prev) => {
      const next = !prev;
      if (next) {
        setRoadState({ status: 'idle' });
        setRoadBlockedReason(null);
        setRoadPreviewHud(null);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (activeTool !== 'road') {
      setRoadState({ status: 'idle' });
      setRoadUpgradeMode(false);
      setRoadBlockedReason(null);
      setRoadPreviewHud(null);
    }
  }, [activeTool]);

  const roadStateRef = useRef(roadState);
  roadStateRef.current = roadState;

  const roadUpgradeModeRef = useRef(roadUpgradeMode);
  roadUpgradeModeRef.current = roadUpgradeMode;

  const roadConfigRef = useRef<RoadRuntimeConfig>({
    roadWidth,
    roadBuildMode,
    roadUpgradeMode,
    angleSnap,
    roadJoinStyle,
    newNodeRole,
    snapEnabled,
    gridEnabled,
    gridStep,
    snapRadius,
    autoIntersect,
    anarchyEnabled,
    showRoadDebug,
    drawElevation,
    drawElevationMode,
    selectedRoadPart,
  });
  roadConfigRef.current = {
    roadWidth,
    roadBuildMode,
    roadUpgradeMode,
    angleSnap,
    roadJoinStyle,
    newNodeRole,
    snapEnabled,
    gridEnabled,
    gridStep,
    snapRadius,
    autoIntersect,
    anarchyEnabled,
    showRoadDebug,
    drawElevation,
    drawElevationMode,
    selectedRoadPart,
  };

  return {
    roadState,
    setRoadState,
    roadStateRef,
    roadUpgradeModeRef,
    roadConfigRef,
    roadBuildMode,
    selectRoadBuildMode,
    roadUpgradeMode,
    toggleRoadUpgradeMode,
    angleSnap,
    setAngleSnap,
    roadJoinStyle,
    setRoadJoinStyle,
    newNodeRole,
    setNewNodeRole,
    roadWidth,
    setRoadWidth,
    snapEnabled,
    setSnapEnabled,
    gridEnabled,
    setGridEnabled,
    gridStep,
    setGridStep,
    snapRadius,
    setSnapRadius,
    autoIntersect,
    setAutoIntersect,
    anarchyEnabled,
    setAnarchyEnabled,
    showRoadDebug,
    setShowRoadDebug,
    drawElevation,
    setDrawElevation,
    drawElevationMode,
    setDrawElevationMode,
    stepElevation,
    resetElevation,
    selectElevationMode,
    adoptElevation,
    selectedRoadPart,
    setSelectedRoadPart,
    activeSnapKind,
    setActiveSnapKind,
    roadBlockedReason,
    setRoadBlockedReason,
    roadPreviewHud,
    setRoadPreviewHud,
  };
}
