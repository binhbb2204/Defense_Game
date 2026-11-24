import { useCallback, useMemo, useRef, useState } from 'react';
import {
  findRoutes,
  getMapGraph,
  syncGraphToLegacyWaypoints,
  validateRoadGraph,
  type MapDefinition,
  type RoadGraphValidationIssue,
} from '@tactical-td/shared';
import type { LeftDrawerTab } from '../components';
import type { ConsoleLogEntry, EditorTool } from '../types';
import { useAssetCatalog } from './useAssetCatalog';
import { isMapEmpty, useEditorDialogsAndLogs } from './useEditorDialogsAndLogs';
import { useEditorSelection } from './useEditorSelection';
import { useEditorShortcuts } from './useEditorShortcuts';
import { useEditorTutorial } from './useEditorTutorial';
import { useMapFileIO } from './useMapFileIO';
import { useMapHistory } from './useMapHistory';
import { useRoadToolConfig } from './useRoadToolConfig';
import { useShapeTool } from './useShapeTool';
import { useViewportBridge } from './useViewportBridge';

/**
 * Orchestrates Map Studio state, tool routing, docked drawers, keyboard shortcuts,
 * Three.js viewport synchronization, and interactive tutorial tracking.
 */
export function useMapEditorController({
  map,
  onChangeMap,
  onNotify,
}: {
  map: MapDefinition;
  onChangeMap: (next: MapDefinition) => void;
  onNotify: (type: 'ok' | 'err', text: string) => void;
}) {
  const fileInput3dRef = useRef<HTMLInputElement>(null);
  const fileInputJsonRef = useRef<HTMLInputElement>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);
  const graph = useMemo(() => getMapGraph(map), [map]);

  const [bottomCollapsed, setBottomCollapsed] = useState(true);
  const [bottomTab, setBottomTab] = useState<'output' | 'validation'>('validation');
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<LeftDrawerTab>('road');
  const [rightDockOpen, setRightDockOpen] = useState(true);
  const [showFloatingMinimap, setShowFloatingMinimap] = useState(false);
  const [floatPos, setFloatPos] = useState({ x: 84, y: 84 });
  const [showWelcome, setShowWelcome] = useState(() => isMapEmpty(map));
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [showLegendPopover, setShowLegendPopover] = useState(false);
  const [activeTool, setActiveTool] = useState<EditorTool>('t-select');
  const [explorerSearch, setExplorerSearch] = useState('');
  const [losMode, setLosMode] = useState(false);
  const [losProbe, setLosProbe] = useState<{ visible: number; blocked: number } | null>(null);
  const [cursorCoords, setCursorCoords] = useState({ x: 0, z: 0 });

  const pushLogRef = useRef<(tag: string, lvl: ConsoleLogEntry['level'], msg: string) => void>(() => {});
  const stablePushLog = useCallback((tag: string, lvl: ConsoleLogEntry['level'], msg: string) => {
    pushLogRef.current(tag, lvl, msg);
  }, []);

  const catalog = useAssetCatalog();
  const selectEditorTool = useCallback(
    (next: EditorTool) => {
      if (next === 'place' && !catalog.selectedAssetRef.current && catalog.catalogItems.length > 0) {
        catalog.setSelectedAsset(catalog.catalogItems[0]!);
      }
      setActiveTool(next);
      if (next === 'road') {
        setDrawerTab('road');
        setLeftDrawerOpen(false);
      } else if (next === 'shape') {
        setDrawerTab('shape');
        setLeftDrawerOpen(true);
      } else if (next === 'place') {
        setDrawerTab('props');
        setLeftDrawerOpen(true);
      } else {
        setLeftDrawerOpen(false);
      }
    },
    [catalog.catalogItems, catalog.selectedAssetRef, catalog.setSelectedAsset],
  );

  const road = useRoadToolConfig(map.defaultRoadWidth, activeTool);
  const history = useMapHistory(map, onChangeMap, stablePushLog);
  const sel = useEditorSelection(
    history.mapRef,
    history.commitMap,
    useCallback(() => road.setRoadState({ status: 'idle' }), [road]),
    useCallback((d: number) => catalog.setGhostRotDeg((prev) => (prev + d + 360) % 360), [catalog]),
    stablePushLog,
  );
  const ui = useEditorDialogsAndLogs({
    map,
    bottomCollapsed,
    bottomTab,
    commitMap: history.commitMap,
    onClearSelection: () => sel.setSelection([]),
    onResetRoadState: () => road.setRoadState({ status: 'idle' }),
    onDismissWelcome: () => setShowWelcome(false),
    onNotify,
  });
  pushLogRef.current = ui.pushLog;

  const shape = useShapeTool({
    map,
    activeTool,
    anarchyEnabled: road.anarchyEnabled,
    commitMap: history.commitMap,
    onSetActiveTool: selectEditorTool,
    onNotify,
    pushLog: ui.pushLog,
  });

  const io = useMapFileIO({
    map,
    mapRef: history.mapRef,
    assetCacheRef: catalog.assetCacheRef,
    setImportedAssets: catalog.setImportedAssets,
    onChangeMap,
    commitMap: history.commitMap,
    setThumbs: catalog.setThumbs,
    setToolboxLayer: catalog.setToolboxLayer,
    setSelectedAsset: catalog.setSelectedAsset,
    setActiveTool: selectEditorTool,
    onResetEditorTransient: useCallback(() => {
      sel.setSelection([]);
      road.setRoadState({ status: 'idle' });
      shape.cancelSession();
    }, [road, sel, shape]),
    onCloseWelcome: useCallback(() => setShowWelcome(false), []),
    onCloseTemplateModal: useCallback(() => ui.setModals((m) => ({ ...m, template: false })), [ui]),
    onNotify,
    pushLog: ui.pushLog,
  });

  const vp = useViewportBridge({
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
    setActiveTool: selectEditorTool,
    setShowWelcome,
    setLosProbe,
    onNotify,
    pushLog: ui.pushLog,
  });

  const validationIssues = useMemo(
    () => validateRoadGraph(map, { anarchyEnabled: road.anarchyEnabled }),
    [map, road.anarchyEnabled],
  );
  const routesCount = useMemo(
    () => findRoutes(graph.nodes, graph.segments, 32).length,
    [graph.nodes, graph.segments],
  );
  const hasCurvedSegment = useMemo(() => graph.segments.some((s) => s.kind === 'curve'), [graph.segments]);
  const propCount = map.obstacles.length + map.elevatedZones.length + (map.customModels?.length ?? 0);

  const tutorial = useEditorTutorial({
    segmentCount: graph.segments.length,
    routesCount,
    hasCurvedSegment,
    propCount,
    validationIssueCount: validationIssues.length,
  });

  const handleSave = useCallback(
    (exportGlb = false) => {
      void io.handleSaveAndPack(exportGlb).then(() => {
        if (!exportGlb) tutorial.markSaved();
      });
    },
    [io, tutorial],
  );

  const adjustSelectedRoadElevation = useCallback(
    (mode: 'step' | 'reset', delta = 0): boolean => {
      if (vp.activeToolRef.current === 'road') return false;
      const items = sel.selectionRef.current;
      if (items.length === 0) return false;

      const curMap = history.mapRef.current;
      const curGraph = getMapGraph(curMap);
      const locked = sel.lockedIdsRef.current;
      const targetNodeIds = new Set<string>();

      for (const item of items) {
        if (item.type === 'road_node' && !locked.has(item.id)) {
          targetNodeIds.add(item.id);
        } else if (item.type === 'road_segment' && !locked.has(item.id)) {
          const seg = curGraph.segments.find((s) => s.id === item.id);
          if (seg) {
            if (!locked.has(seg.a)) targetNodeIds.add(seg.a);
            if (!locked.has(seg.b)) targetNodeIds.add(seg.b);
          }
        }
      }
      if (targetNodeIds.size === 0) return false;

      const nextNodes = curGraph.nodes.map((n) => {
        if (!targetNodeIds.has(n.id)) return n;
        const nextY =
          mode === 'reset'
            ? 0
            : Math.max(0, Math.min(24, Number((n.y + delta).toFixed(1))));
        return { ...n, y: nextY };
      });
      const nodeMap = new Map(nextNodes.map((n) => [n.id, n]));

      const nextSegments = curGraph.segments.map((s) => {
        if (!targetNodeIds.has(s.a) && !targetNodeIds.has(s.b)) return s;
        const na = nodeMap.get(s.a);
        const nb = nodeMap.get(s.b);
        if (!na || !nb) return s;
        const elevated = na.y > 0.6 || nb.y > 0.6;
        const curMode = s.elevationMode ?? (s.isTunnel ? 'tunnel' : s.isOverpass ? 'bridge' : 'ground');
        const nextMode: typeof curMode =
          curMode === 'tunnel'
            ? 'tunnel'
            : elevated
              ? curMode === 'elevated'
                ? 'elevated'
                : 'bridge'
              : 'ground';
        return {
          ...s,
          control: s.control
            ? { ...s.control, y: Number(((na.y + nb.y) * 0.5).toFixed(2)) }
            : undefined,
          isOverpass: elevated ? true : undefined,
          elevationMode: nextMode,
        };
      });

      const nextMap = syncGraphToLegacyWaypoints({
        ...curMap,
        nodes: nextNodes,
        segments: nextSegments,
      });
      history.commitMap(nextMap);
      const sampleNode = nextNodes.find((n) => targetNodeIds.has(n.id));
      ui.pushLog(
        'Road',
        'action',
        `Set height of ${targetNodeIds.size} node(s) to Y=${sampleNode?.y ?? 0}m.`,
      );
      return true;
    },
    [history, sel.lockedIdsRef, sel.selectionRef, ui, vp.activeToolRef],
  );

  useEditorShortcuts({
    engineRef: vp.engineRef,
    activeToolRef: vp.activeToolRef,
    roadStateRef: road.roadStateRef,
    roadUpgradeModeRef: road.roadUpgradeModeRef,
    selectionRef: sel.selectionRef,
    mapRef: history.mapRef,
    onSave: () => handleSave(false),
    onUndo: history.handleUndo,
    onRedo: history.handleRedo,
    onToggleAnarchy: () => road.setAnarchyEnabled((v) => !v),
    onToggleRoadDebug: () => road.setShowRoadDebug((v) => !v),
    onStepElevation: (d) => {
      if (!adjustSelectedRoadElevation('step', d)) road.stepElevation(d);
    },
    onResetElevation: () => {
      if (!adjustSelectedRoadElevation('reset')) road.resetElevation();
    },
    onSetRoadState: road.setRoadState,
    onSetRoadBlockedReason: road.setRoadBlockedReason,
    onSetRoadBuildMode: road.selectRoadBuildMode,
    onToggleRoadUpgrade: road.toggleRoadUpgradeMode,
    onChangeMapDirect: onChangeMap,
    onDeleteSelected: () => sel.deleteSelectedItems(),
    onClearSelection: () => { sel.setSelection([]); setLosMode(false); },
    onToggleLos: () => setLosMode((v) => !v),
    onToggleMinimap: () => setShowFloatingMinimap((v) => !v),
    onSetActiveTool: selectEditorTool,
    onApplyShape: shape.applyShape,
    onEscapeShape: shape.handleEscape,
    onRotate: sel.rotateSelectedOrGhost,
    onToggleGuide: () => setShowGuideModal((v) => !v),
    onPushLog: ui.pushLog,
  });

  const handleFocusValidationIssue = (issue: RoadGraphValidationIssue) => {
    vp.engineRef.current?.focusOn(issue.focusPos, 20);
    if (issue.entityType && issue.entityId) {
      sel.selectItem({ type: issue.entityType, id: issue.entityId }, false);
    }
  };

  const toggleDiagnostics = useCallback(
    (tab: 'output' | 'validation') => {
      if (!bottomCollapsed && bottomTab === tab) setBottomCollapsed(true);
      else {
        setBottomTab(tab);
        setBottomCollapsed(false);
      }
    },
    [bottomCollapsed, bottomTab],
  );

  return {
    fileInput3dRef,
    fileInputJsonRef,
    minimapCanvasRef,
    graph,
    validationIssues,
    routesCount,
    catalog,
    road,
    history,
    sel,
    ui,
    shape,
    io,
    vp,
    tutorial,
    activeTool,
    selectEditorTool,
    bottomCollapsed,
    setBottomCollapsed,
    bottomTab,
    setBottomTab,
    leftDrawerOpen,
    setLeftDrawerOpen,
    drawerTab,
    rightDockOpen,
    setRightDockOpen,
    showFloatingMinimap,
    setShowFloatingMinimap,
    floatPos,
    setFloatPos,
    showWelcome,
    setShowWelcome,
    showGuideModal,
    setShowGuideModal,
    showLegendPopover,
    setShowLegendPopover,
    explorerSearch,
    setExplorerSearch,
    losMode,
    setLosMode,
    losProbe,
    cursorCoords,
    handleSave,
    handleFocusValidationIssue,
    toggleDiagnostics,
  };
}
