import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import type { MapDefinition } from '@tactical-td/shared';
import { createViewportHostProxy, ViewportEngine, type ViewportEngineHost } from '../engine';
import { renderMinimapCanvas } from '../rendering';
import type { ConsoleLogEntry, EditorTool } from '../types';
import type { useAssetCatalog } from './useAssetCatalog';
import type { useEditorSelection } from './useEditorSelection';
import type { useMapHistory } from './useMapHistory';
import type { useRoadToolConfig } from './useRoadToolConfig';
import type { useShapeTool } from './useShapeTool';

export interface UseViewportBridgeParams {
  map: MapDefinition;
  onChangeMap: (next: MapDefinition) => void;
  activeTool: EditorTool;
  losMode: boolean;
  showFloatingMinimap: boolean;
  minimapCanvasRef: RefObject<HTMLCanvasElement | null>;
  history: ReturnType<typeof useMapHistory>;
  road: ReturnType<typeof useRoadToolConfig>;
  sel: ReturnType<typeof useEditorSelection>;
  catalog: ReturnType<typeof useAssetCatalog>;
  shape: ReturnType<typeof useShapeTool>;
  setCursorCoords: (coords: { x: number; z: number }) => void;
  setActiveTool: (tool: EditorTool) => void;
  setShowWelcome: (v: boolean) => void;
  setLosProbe: (probe: { visible: number; blocked: number } | null) => void;
  onNotify: (type: 'ok' | 'err', msg: string) => void;
  pushLog: (tag: string, level: ConsoleLogEntry['level'], message: string) => void;
}

/**
 * Owns ViewportEngine mounting/disposal, host callback proxy, scene/ghost/minimap sync effects,
 * and resizable dock column widths for MapEditor.
 */
export function useViewportBridge({
  map,
  onChangeMap,
  activeTool,
  losMode,
  showFloatingMinimap,
  minimapCanvasRef,
  history,
  road,
  sel,
  catalog,
  shape,
  setCursorCoords,
  setActiveTool,
  setShowWelcome,
  setLosProbe,
  onNotify,
  pushLog,
}: UseViewportBridgeParams) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ViewportEngine | null>(null);
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const losModeRef = useRef(losMode);
  losModeRef.current = losMode;

  const [leftWidth, setLeftWidth] = useState(248);
  const [rightWidth, setRightWidth] = useState(264);

  const hostRef = useRef<ViewportEngineHost>(null!);
  hostRef.current = {
    getMap: () => history.mapRef.current,
    getActiveTool: () => activeToolRef.current,
    getRoadState: () => road.roadStateRef.current,
    getRoadConfig: () => road.roadConfigRef.current,
    getSelection: () => sel.selectionRef.current,
    getHiddenIds: () => sel.hiddenIdsRef.current,
    getLockedIds: () => sel.lockedIdsRef.current,
    getSelectedAsset: () => catalog.selectedAssetRef.current,
    getPlaceOnce: () => catalog.placeOnceRef.current,
    getGhostRotDeg: () => catalog.ghostRotDegRef.current,
    getLosMode: () => losModeRef.current,
    getAssetCache: () => catalog.assetCacheRef.current,
    getShapePreviewData: () => shape.shapePreviewDataRef.current,
    onCommitMap: history.commitMap,
    onReplaceMapDirect: onChangeMap,
    onPushUndoSnapshot: history.pushUndoSnapshot,
    onSelectItem: sel.selectItem,
    onSetSelection: sel.setSelection,
    onDeleteItems: sel.deleteSelectedItems,
    onShapePick: shape.handleViewportPick,
    onSetRoadState: road.setRoadState,
    onSetRoadBlockedReason: road.setRoadBlockedReason,
    onSetRoadPreviewHud: road.setRoadPreviewHud,
    onAdoptRoadElevation: road.adoptElevation,
    onSetActiveSnapKind: road.setActiveSnapKind,
    onSetCursorCoords: setCursorCoords,
    onSetActiveTool: setActiveTool,
    onDismissWelcome: () => setShowWelcome(false),
    onSetLosProbe: setLosProbe,
    onNotify,
    onPushLog: pushLog,
  };

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const engine = new ViewportEngine(el, createViewportHostProxy(hostRef));
    engineRef.current = engine;
    engine.syncScene();
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.syncScene();
  }, [
    map,
    sel.selection,
    activeTool,
    road.roadState,
    road.roadBuildMode,
    road.roadUpgradeMode,
    road.angleSnap,
    road.roadWidth,
    road.gridEnabled,
    road.gridStep,
    road.anarchyEnabled,
    road.roadJoinStyle,
    road.showRoadDebug,
    road.drawElevation,
    road.drawElevationMode,
    sel.hiddenIds,
    sel.lockedIds,
    catalog.importedAssets,
    shape.shapePreviewData,
  ]);

  useEffect(() => {
    if (activeTool === 'road') {
      engineRef.current?.refreshHover();
    }
  }, [
    activeTool,
    road.drawElevation,
    road.drawElevationMode,
    road.roadWidth,
    road.roadBuildMode,
    road.anarchyEnabled,
    road.angleSnap,
    road.snapEnabled,
    road.gridEnabled,
    road.gridStep,
  ]);

  useEffect(() => {
    engineRef.current?.rebuildGhostProp(catalog.selectedAsset, activeTool, catalog.ghostRotDeg);
  }, [catalog.selectedAsset, activeTool, catalog.ghostRotDeg, catalog.importedAssets]);

  useEffect(() => {
    if (showFloatingMinimap) {
      renderMinimapCanvas(
        minimapCanvasRef.current,
        map,
        new Set(sel.selection.map((s) => s.id)),
        sel.hiddenIds,
      );
    }
  }, [map, sel.selection, sel.hiddenIds, showFloatingMinimap, minimapCanvasRef]);

  const startColumnResize = (side: 'left' | 'right', e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = side === 'left' ? leftWidth : rightWidth;
    document.body.style.cursor = 'col-resize';
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      if (side === 'left') setLeftWidth(Math.max(190, Math.min(380, startW + delta)));
      else setRightWidth(Math.max(240, Math.min(440, startW - delta)));
    };
    const onUp = () => {
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return {
    viewportRef,
    engineRef,
    activeToolRef,
    leftWidth,
    rightWidth,
    startColumnResize,
  };
}
