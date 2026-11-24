import type {
  MapDefinition,
  RoadBuildMode,
  RoadJoinStyle,
  RoadNodeRole,
  Vec3,
  WaypointElevationMode,
} from '@tactical-td/shared';
import type { ImportedAssetEntry, ShapePreviewRenderData } from '../rendering';
import type { RoadToolState, SnapHitKind } from '../tools';
import type { ConsoleLogEntry, EditorTool, SelectionItem, ToolboxAssetChoice } from '../types';

export interface RoadPreviewHudState {
  visible: boolean;
  screenX: number;
  screenY: number;
  controlScreenPos?: { x: number; y: number } | null;
  mode: RoadBuildMode;
  stage: 'idle' | 'control' | 'end' | 'upgrade';
  length: number | null;
  angleDeg: number | null;
  minRadius: number | null;
  roadWidth: number;
  controlPoint: Vec3 | null;
  elevationY?: number;
  slopePct?: number | null;
  snappedToTangent?: boolean;
  usedAngleSnap?: boolean;
  status: 'ok' | 'warn' | 'error';
  statusText: string | null;
}

export interface RoadRuntimeConfig {
  roadWidth: number;
  roadBuildMode: RoadBuildMode;
  roadUpgradeMode: boolean;
  angleSnap: boolean;
  roadJoinStyle: RoadJoinStyle;
  newNodeRole: RoadNodeRole;
  snapEnabled: boolean;
  gridEnabled: boolean;
  gridStep: number;
  snapRadius: number;
  autoIntersect: boolean;
  anarchyEnabled: boolean;
  showRoadDebug: boolean;
  drawElevation: number;
  drawElevationMode: WaypointElevationMode;
  selectedRoadPart: string;
}

export interface ViewportEngineHost {
  getMap: () => MapDefinition;
  getActiveTool: () => EditorTool;
  getRoadState: () => RoadToolState;
  getRoadConfig: () => RoadRuntimeConfig;
  getSelection: () => SelectionItem[];
  getHiddenIds: () => Set<string>;
  getLockedIds: () => Set<string>;
  getSelectedAsset: () => ToolboxAssetChoice | null;
  getPlaceOnce: () => boolean;
  getGhostRotDeg: () => number;
  getLosMode: () => boolean;
  getAssetCache: () => Map<string, ImportedAssetEntry>;
  getShapePreviewData: () => ShapePreviewRenderData | null;
  onCommitMap: (next: MapDefinition, pushHistory?: boolean) => void;
  onReplaceMapDirect: (next: MapDefinition) => void;
  onPushUndoSnapshot: (snapshot: MapDefinition) => void;
  onSelectItem: (item: SelectionItem | null, additive?: boolean) => void;
  onSetSelection: (next: SelectionItem[]) => void;
  onDeleteItems: (items: SelectionItem[]) => void;
  onShapePick: (picked: SelectionItem | null) => void;
  onSetRoadState: (next: RoadToolState) => void;
  onSetRoadBlockedReason: (reason: string | null) => void;
  onSetRoadPreviewHud: (hud: RoadPreviewHudState | null) => void;
  onAdoptRoadElevation?: (y: number) => void;
  onSetActiveSnapKind: (kind: SnapHitKind) => void;
  onSetCursorCoords: (coords: { x: number; z: number }) => void;
  onSetActiveTool: (tool: EditorTool) => void;
  onDismissWelcome: () => void;
  onSetLosProbe: (probe: { visible: number; blocked: number } | null) => void;
  onNotify: (type: 'ok' | 'err', msg: string) => void;
  onPushLog: (tag: string, level: ConsoleLogEntry['level'], message: string) => void;
}

export interface ViewportCameraCallbacks {
  shouldYieldToGizmo: () => boolean;
  onLeftClick: (ev: PointerEvent) => void;
  onRightClick: (ev: PointerEvent) => void;
  onDoubleClick: (ev: MouseEvent) => void;
  onPointerMoveHover?: (clientX: number, clientY: number, altHeld: boolean, shiftHeld: boolean) => void;
}

export type DragMode = 'none' | 'pan' | 'rotate';

/** Creates a stable forwarding proxy so ViewportEngine initializes once without stale closures. */
export function createViewportHostProxy(
  hostRef: { readonly current: ViewportEngineHost },
): ViewportEngineHost {
  return {
    getMap: () => hostRef.current.getMap(),
    getActiveTool: () => hostRef.current.getActiveTool(),
    getRoadState: () => hostRef.current.getRoadState(),
    getRoadConfig: () => hostRef.current.getRoadConfig(),
    getSelection: () => hostRef.current.getSelection(),
    getHiddenIds: () => hostRef.current.getHiddenIds(),
    getLockedIds: () => hostRef.current.getLockedIds(),
    getSelectedAsset: () => hostRef.current.getSelectedAsset(),
    getPlaceOnce: () => hostRef.current.getPlaceOnce(),
    getGhostRotDeg: () => hostRef.current.getGhostRotDeg(),
    getLosMode: () => hostRef.current.getLosMode(),
    getAssetCache: () => hostRef.current.getAssetCache(),
    getShapePreviewData: () => hostRef.current.getShapePreviewData(),
    onCommitMap: (n, p) => hostRef.current.onCommitMap(n, p),
    onReplaceMapDirect: (n) => hostRef.current.onReplaceMapDirect(n),
    onPushUndoSnapshot: (s) => hostRef.current.onPushUndoSnapshot(s),
    onSelectItem: (i, a) => hostRef.current.onSelectItem(i, a),
    onSetSelection: (s) => hostRef.current.onSetSelection(s),
    onDeleteItems: (i) => hostRef.current.onDeleteItems(i),
    onShapePick: (p) => hostRef.current.onShapePick(p),
    onSetRoadState: (s) => hostRef.current.onSetRoadState(s),
    onSetRoadBlockedReason: (r) => hostRef.current.onSetRoadBlockedReason(r),
    onSetRoadPreviewHud: (h) => hostRef.current.onSetRoadPreviewHud(h),
    onAdoptRoadElevation: (y) => hostRef.current.onAdoptRoadElevation?.(y),
    onSetActiveSnapKind: (k) => hostRef.current.onSetActiveSnapKind(k),
    onSetCursorCoords: (c) => hostRef.current.onSetCursorCoords(c),
    onSetActiveTool: (t) => hostRef.current.onSetActiveTool(t),
    onDismissWelcome: () => hostRef.current.onDismissWelcome(),
    onSetLosProbe: (p) => hostRef.current.onSetLosProbe(p),
    onNotify: (t, m) => hostRef.current.onNotify(t, m),
    onPushLog: (tag, lvl, msg) => hostRef.current.onPushLog(tag, lvl, msg),
  };
}

const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'range',
  'button',
  'submit',
  'reset',
  'color',
]);

export function isTypingTarget(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(type);
  }
  return false;
}
