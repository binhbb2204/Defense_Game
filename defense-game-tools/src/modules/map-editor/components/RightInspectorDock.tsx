import { useState } from 'react';
import {
  splitSegment,
  toggleRoadSegmentKind,
  updateRoadNode,
  updateRoadSegment,
  type MapDefinition,
  type RoadBuildMode,
  type RoadNode,
  type RoadSegment,
  type Vec3,
} from '@tactical-td/shared';
import type { RoadPreviewHudState } from '../engine';
import type { EditorTool, SelectionItem } from '../types';
import { PropertiesPanel } from './properties';
import { NewSegmentPreviewInspector } from './properties/NewSegmentPreviewInspector';
import { SceneExplorerPanel } from './SceneExplorerPanel';

export function RightInspectorDock({
  width,
  map,
  graph,
  selection,
  drawingAnchorId,
  hiddenIds,
  lockedIds,
  explorerSearch,
  importedAssetNames,
  activeTool,
  roadPreviewHud,
  roadBuildMode,
  roadWidth,
  onSearchChange,
  onSelectItem,
  onFocusPos,
  onToggleHidden,
  onToggleLocked,
  onDeleteItems,
  onCommitMap,
}: {
  width: number;
  map: MapDefinition;
  graph: { nodes: RoadNode[]; segments: RoadSegment[] };
  selection: SelectionItem[];
  drawingAnchorId?: string | null;
  hiddenIds: ReadonlySet<string>;
  lockedIds: ReadonlySet<string>;
  explorerSearch: string;
  importedAssetNames: string[];
  activeTool?: EditorTool;
  roadPreviewHud?: RoadPreviewHudState | null;
  roadBuildMode?: RoadBuildMode;
  roadWidth?: number;
  onSearchChange: (q: string) => void;
  onSelectItem: (item: SelectionItem | null, additive?: boolean) => void;
  onFocusPos: (pos: Vec3) => void;
  onToggleHidden: (ids: string[]) => void;
  onToggleLocked: (ids: string[]) => void;
  onDeleteItems: (explicit?: SelectionItem[]) => void;
  onCommitMap: (next: MapDefinition) => void;
}) {
  const [showSearch, setShowSearch] = useState(false);

  const showNewSegInspector = Boolean(
    activeTool === 'road' &&
      roadPreviewHud?.visible &&
      (roadPreviewHud.stage === 'control' || roadPreviewHud.stage === 'end'),
  );

  return (
    <aside
      style={{
        width,
        backgroundColor: 'var(--bg-panel)',
        borderColor: 'var(--border-subtle)',
      }}
      className="flex shrink-0 flex-col border-l"
    >
      {/* Borderless Scene Section */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          className="flex h-8 shrink-0 items-center justify-between border-b px-3"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <span className="text-[12px] font-semibold" style={{ color: '#ffffff' }}>
            Scene
          </span>
          <div className="flex items-center gap-2">
            <span className="mono-num text-[11px]" style={{ color: '#8c919a' }}>
              {graph.nodes.length} node{graph.nodes.length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={() => setShowSearch((v) => !v)}
              title="Filter scene items"
              className="cursor-pointer p-1 hover:text-white"
              style={{ color: showSearch ? '#8db8ff' : '#6b7280' }}
            >
              <i className="fas fa-search text-[10px]" />
            </button>
          </div>
        </div>
        <SceneExplorerPanel
          map={map}
          selection={selection}
          drawingAnchorId={drawingAnchorId}
          hiddenIds={hiddenIds}
          lockedIds={lockedIds}
          search={explorerSearch}
          showSearch={showSearch}
          onSearchChange={onSearchChange}
          onSelectItem={onSelectItem}
          onFocusPos={onFocusPos}
          onToggleHidden={onToggleHidden}
          onToggleLocked={onToggleLocked}
          onDeleteItem={(item) => onDeleteItems([item])}
        />
      </div>

      {/* Bottom Entity Properties / New Segment Preview */}
      <div
        className="max-h-[56%] min-h-[120px] shrink-0 overflow-y-auto border-t"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        {showNewSegInspector && roadPreviewHud ? (
          <NewSegmentPreviewInspector
            hud={roadPreviewHud}
            buildMode={roadBuildMode ?? 'straight'}
            roadWidth={roadWidth ?? 6}
          />
        ) : (
          <PropertiesPanel
            map={map}
            selection={selection}
            drawingAnchorId={drawingAnchorId}
            importedAssetNames={importedAssetNames}
            onUpdateNode={(nodeId, patch) =>
              onCommitMap({ ...map, nodes: updateRoadNode(graph.nodes, nodeId, patch) })
            }
            onUpdateSegment={(segId, patch) =>
              onCommitMap({ ...map, segments: updateRoadSegment(graph.segments, segId, patch) })
            }
            onToggleSegmentKind={(segId) =>
              onCommitMap({ ...map, segments: toggleRoadSegmentKind(graph.nodes, graph.segments, segId) })
            }
            onSplitSegmentMid={(segId) => {
              const res = splitSegment(graph.nodes, graph.segments, segId, 0.5);
              if (res.insertedNode) {
                onCommitMap({ ...map, nodes: res.nodes, segments: res.segments });
                onSelectItem({ type: 'road_node', id: res.insertedNode.id }, false);
              }
            }}
            onUpdateObstacle={(id, patch) =>
              onCommitMap({
                ...map,
                obstacles: map.obstacles.map((o) => (o.id === id ? { ...o, ...patch } : o)),
              })
            }
            onUpdateZone={(id, patch) =>
              onCommitMap({
                ...map,
                elevatedZones: map.elevatedZones.map((z) => (z.id === id ? { ...z, ...patch } : z)),
              })
            }
            onUpdateCustomModel={(id, patch) =>
              onCommitMap({
                ...map,
                customModels: (map.customModels ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m)),
              })
            }
            onDeleteSelection={() => onDeleteItems()}
          />
        )}
      </div>
    </aside>
  );
}
