import type { EditorTool, ToolboxAssetChoice, ToolboxLayer } from '../types';
import type { useRoadToolConfig, useShapeTool } from '../hooks';
import { handleRoadBackspace } from '../tools';
import type { MapDefinition } from '@tactical-td/shared';
import { MultitoolDrawerPanel } from './MultitoolDrawerPanel';
import { RoadDrawerPanel } from './RoadDrawerPanel';
import { ToolboxSidebar } from './ToolboxSidebar';

export type LeftDrawerTab = 'road' | 'shape' | 'props';

export interface LeftToolDrawerProps {
  open: boolean;
  width: number;
  drawerTab: LeftDrawerTab;
  activeTool: EditorTool;
  road: ReturnType<typeof useRoadToolConfig>;
  shape: ReturnType<typeof useShapeTool>;
  importedAssetNames: string[];
  mapRef: React.MutableRefObject<MapDefinition>;
  onChangeMapDirect: (next: MapDefinition) => void;
  onSelectTool: (tool: EditorTool) => void;
  onClose: () => void;
  // Props library state
  toolboxLayer: ToolboxLayer;
  importedCount: number;
  assetSearch: string;
  categoryFilter: string;
  categories: string[];
  filteredCatalog: ToolboxAssetChoice[];
  selectedAsset: ToolboxAssetChoice | null;
  thumbs: Record<string, string>;
  placeOnce: boolean;
  onChangePlaceOnce: (v: boolean) => void;
  onChangeLayer: (layer: ToolboxLayer) => void;
  onChangeSearch: (s: string) => void;
  onChangeCategory: (c: string) => void;
  onPickAsset: (item: ToolboxAssetChoice) => void;
}

/**
 * Contextual Left Drawer that hosts the unified [Draw Road | Multitool] suite or Props Library,
 * opening automatically for authoring tools and closing to maximize the 3D viewport otherwise.
 */
export function LeftToolDrawer(p: LeftToolDrawerProps) {
  if (!p.open) return null;

  const isRoadSuite = p.drawerTab === 'road' || p.drawerTab === 'shape';

  return (
    <aside
      style={{
        width: p.width,
        backgroundColor: 'var(--bg-panel)',
        borderColor: 'var(--border-subtle)',
      }}
      className="flex shrink-0 flex-col border-r"
    >
      {/* Unified Drawer Header */}
      <div
        className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-2"
        style={{ backgroundColor: 'var(--bg-header)', borderColor: 'var(--border-subtle)' }}
      >
        {isRoadSuite ? (
          <div className="dcc-seg-group flex-1">
            <button
              type="button"
              onClick={() => p.onSelectTool('road')}
              className={`dcc-seg-btn ${p.drawerTab === 'road' ? 'active' : ''}`}
            >
              <i className="fas fa-road text-[10px]" />
              <span>Draw Road</span>
              <span className="mono-num text-[9px] opacity-65">G</span>
            </button>
            <button
              type="button"
              onClick={() => p.onSelectTool('shape')}
              className={`dcc-seg-btn ${p.drawerTab === 'shape' ? 'active' : ''}`}
            >
              <i className="fas fa-bezier-curve text-[10px]" />
              <span>Multitool</span>
              <span className="mono-num text-[9px] opacity-65">T</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-between pl-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              Props Library
            </span>
            <label
              className="flex cursor-pointer items-center gap-1 text-[10px]"
              style={{ color: 'var(--text-secondary)' }}
              title="Switch back to Select after placing one prop"
            >
              <input
                type="checkbox"
                checked={p.placeOnce}
                onChange={(e) => p.onChangePlaceOnce(e.target.checked)}
                className="accent-[#3b82f6]"
              />
              <span>Once</span>
            </label>
          </div>
        )}

        <button
          type="button"
          onClick={p.onClose}
          title="Collapse Drawer"
          className="dcc-btn !min-h-[24px] !min-w-[24px] px-1"
        >
          <i className="fas fa-times text-[10px]" />
        </button>
      </div>

      {p.drawerTab === 'road' && (
        <RoadDrawerPanel
          roadState={p.road.roadState}
          buildMode={p.road.roadBuildMode}
          upgradeMode={p.road.roadUpgradeMode}
          angleSnap={p.road.angleSnap}
          joinStyle={p.road.roadJoinStyle}
          newNodeRole={p.road.newNodeRole}
          roadWidth={p.road.roadWidth}
          snapEnabled={p.road.snapEnabled}
          gridEnabled={p.road.gridEnabled}
          gridStep={p.road.gridStep}
          autoIntersect={p.road.autoIntersect}
          anarchyEnabled={p.road.anarchyEnabled}
          showRoadDebug={p.road.showRoadDebug}
          drawElevation={p.road.drawElevation}
          elevationMode={p.road.drawElevationMode}
          importedAssetNames={p.importedAssetNames}
          selectedRoadPart={p.road.selectedRoadPart}
          onChangeBuildMode={p.road.selectRoadBuildMode}
          onToggleUpgrade={p.road.toggleRoadUpgradeMode}
          onToggleAngleSnap={() => p.road.setAngleSnap((v) => !v)}
          onChangeJoinStyle={p.road.setRoadJoinStyle}
          onChangeNewNodeRole={p.road.setNewNodeRole}
          onChangeRoadWidth={p.road.setRoadWidth}
          onToggleSnap={() => p.road.setSnapEnabled((v) => !v)}
          onToggleGrid={() => p.road.setGridEnabled((v) => !v)}
          onChangeGridStep={p.road.setGridStep}
          onToggleAutoIntersect={() => p.road.setAutoIntersect((v) => !v)}
          onToggleAnarchy={() => p.road.setAnarchyEnabled((v) => !v)}
          onToggleRoadDebug={() => p.road.setShowRoadDebug((v) => !v)}
          onStepElevation={p.road.stepElevation}
          onResetElevation={p.road.resetElevation}
          onChangeElevationMode={p.road.selectElevationMode}
          onChangeRoadPart={p.road.setSelectedRoadPart}
          onFinishChain={() => {
            p.road.setRoadState({ status: 'idle' });
            p.road.setRoadBlockedReason(null);
          }}
          onBackspace={() => {
            const res = handleRoadBackspace(p.mapRef.current, p.road.roadState);
            p.road.setRoadState(res.nextState);
            if (res.reverted) p.onChangeMapDirect(res.nextMap);
          }}
        />
      )}

      {p.drawerTab === 'shape' && (
        <MultitoolDrawerPanel shape={p.shape} anarchyEnabled={p.road.anarchyEnabled} />
      )}

      {p.drawerTab === 'props' && (
        <ToolboxSidebar
          toolboxLayer={p.toolboxLayer}
          importedCount={p.importedCount}
          assetSearch={p.assetSearch}
          categoryFilter={p.categoryFilter}
          categories={p.categories}
          filteredCatalog={p.filteredCatalog}
          selectedAsset={p.selectedAsset}
          activeTool={p.activeTool}
          thumbs={p.thumbs}
          onChangeLayer={p.onChangeLayer}
          onChangeSearch={p.onChangeSearch}
          onChangeCategory={p.onChangeCategory}
          onPickAsset={p.onPickAsset}
        />
      )}
    </aside>
  );
}
