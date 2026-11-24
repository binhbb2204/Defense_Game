import { useState } from 'react';
import type {
  RoadBuildMode,
  RoadJoinStyle,
  RoadNodeRole,
  WaypointElevationMode,
} from '@tactical-td/shared';
import type { RoadToolState } from '../tools';
import { RoadDrawerDimensions } from './RoadDrawerDimensions';

export interface RoadDrawerPanelProps {
  roadState: RoadToolState;
  buildMode: RoadBuildMode;
  upgradeMode: boolean;
  angleSnap: boolean;
  joinStyle: RoadJoinStyle;
  newNodeRole: RoadNodeRole;
  roadWidth: number;
  snapEnabled: boolean;
  gridEnabled: boolean;
  gridStep: number;
  autoIntersect: boolean;
  anarchyEnabled: boolean;
  showRoadDebug: boolean;
  drawElevation: number;
  elevationMode: WaypointElevationMode;
  importedAssetNames: string[];
  selectedRoadPart: string;
  onChangeBuildMode: (mode: RoadBuildMode) => void;
  onToggleUpgrade: () => void;
  onToggleAngleSnap: () => void;
  onChangeJoinStyle: (style: RoadJoinStyle) => void;
  onChangeNewNodeRole: (role: RoadNodeRole) => void;
  onChangeRoadWidth: (width: number) => void;
  onToggleSnap: () => void;
  onToggleGrid: () => void;
  onChangeGridStep: (step: number) => void;
  onToggleAutoIntersect: () => void;
  onToggleAnarchy: () => void;
  onToggleRoadDebug: () => void;
  onStepElevation: (delta: number) => void;
  onResetElevation: () => void;
  onChangeElevationMode: (mode: WaypointElevationMode) => void;
  onChangeRoadPart: (assetName: string) => void;
  onFinishChain: () => void;
  onBackspace: () => void;
}

/** Vertical Road Settings drawer opened from Settings icon in ToolOptionsBar (Elevation, Node Role, Advanced). */
export function RoadDrawerPanel(p: RoadDrawerPanelProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const chainBannerText =
    p.roadState.status !== 'drawing'
      ? null
      : p.buildMode === 'curve' && !p.roadState.curveControl
        ? 'Curve 2/3: Click control handle'
        : p.roadState.curveControl
          ? 'Curve 3/3: Click end point'
          : `Drawing chain (${p.roadState.chainNodeCount} nodes)`;

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-3 text-xs">
      {chainBannerText && (
        <div
          className="space-y-2 rounded-[4px] border p-2.5"
          style={{ backgroundColor: 'var(--accent-subtle)', borderColor: 'var(--accent)' }}
        >
          <div className="flex items-center gap-2 text-[11px] font-semibold" style={{ color: '#93c5fd' }}>
            <i className="fas fa-circle text-[7px]" />
            <span>{chainBannerText}</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={p.onBackspace}
              className="dcc-btn !min-h-[26px] text-[11px]"
              style={{ border: '1px solid var(--border-strong)', backgroundColor: 'var(--bg-panel)' }}
            >
              <i className="fas fa-undo text-[10px]" />
              <span>Step Back</span>
            </button>
            <button
              type="button"
              onClick={p.onFinishChain}
              className="flex min-h-[26px] cursor-pointer items-center justify-center gap-1.5 rounded-[4px] px-2 text-[11px] font-semibold text-white"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              <i className="fas fa-check text-[10px]" />
              <span>Finish</span>
            </button>
          </div>
        </div>
      )}

      <section className="space-y-1.5">
        <div className="dcc-section-title">Build Mode</div>
        <div className="dcc-seg-group">
          {(
            [
              { id: 'straight', label: 'Straight' },
              { id: 'curve', label: 'Curve' },
              { id: 'free', label: 'Free' },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => p.onChangeBuildMode(m.id)}
              className={`dcc-seg-btn ${!p.upgradeMode && p.buildMode === m.id ? 'active' : ''}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={p.onToggleUpgrade}
          className={`dcc-btn w-full !justify-between px-2.5 text-[11px] ${p.upgradeMode ? 'active' : ''}`}
          style={{ border: '1px solid var(--border-subtle)' }}
        >
          <span className="flex items-center gap-1.5">
            <i className="fas fa-arrows-alt-h text-[10px]" />
            <span>Upgrade Road Width Tool</span>
          </span>
          <span className="dcc-kbd">U</span>
        </button>
      </section>

      <section className="space-y-1.5">
        <div className="dcc-section-title">New Node Role</div>
        <div className="dcc-seg-group">
          {(
            [
              { id: 'normal', label: 'Normal', dot: '#9ca3af' },
              { id: 'spawn', label: 'Spawn', dot: 'var(--semantic-spawn)' },
              { id: 'base', label: 'Base', dot: 'var(--semantic-base)' },
            ] as const
          ).map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => p.onChangeNewNodeRole(r.id)}
              className={`dcc-seg-btn ${p.newNodeRole === r.id ? 'active' : ''}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.dot }} />
              <span>{r.label}</span>
            </button>
          ))}
        </div>
      </section>

      <RoadDrawerDimensions
        roadWidth={p.roadWidth}
        drawElevation={p.drawElevation}
        elevationMode={p.elevationMode}
        importedAssetNames={p.importedAssetNames}
        selectedRoadPart={p.selectedRoadPart}
        onChangeRoadWidth={p.onChangeRoadWidth}
        onStepElevation={p.onStepElevation}
        onResetElevation={p.onResetElevation}
        onChangeElevationMode={p.onChangeElevationMode}
        onChangeRoadPart={p.onChangeRoadPart}
      />

      <section className="space-y-1.5">
        <div className="dcc-section-title">Snapping &amp; Rules</div>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={p.onToggleSnap}
            className={`dcc-btn !justify-start px-2.5 text-[11px] ${p.snapEnabled ? 'active' : ''}`}
            style={{ border: '1px solid var(--border-subtle)' }}
          >
            <i className="fas fa-magnet text-[10px]" />
            <span>Node Snap</span>
          </button>
          <button
            type="button"
            onClick={p.onToggleGrid}
            className={`dcc-btn !justify-start px-2.5 text-[11px] ${p.gridEnabled ? 'active' : ''}`}
            style={{ border: '1px solid var(--border-subtle)' }}
          >
            <i className="fas fa-border-all text-[10px]" />
            <span>Grid Snap</span>
          </button>
          <button
            type="button"
            onClick={p.onToggleAngleSnap}
            className={`dcc-btn !justify-start px-2.5 text-[11px] ${p.angleSnap ? 'active' : ''}`}
            style={{ border: '1px solid var(--border-subtle)' }}
          >
            <i className="fas fa-compass text-[10px]" />
            <span>Angle 15°</span>
          </button>
          <button
            type="button"
            onClick={p.onToggleAutoIntersect}
            className={`dcc-btn !justify-start px-2.5 text-[11px] ${p.autoIntersect ? 'active' : ''}`}
            style={{ border: '1px solid var(--border-subtle)' }}
          >
            <i className="fas fa-crosshairs text-[10px]" />
            <span>Intersect</span>
          </button>
          <button
            type="button"
            onClick={p.onToggleAnarchy}
            className="dcc-btn col-span-2 !justify-start px-2.5 text-[11px]"
            style={
              p.anarchyEnabled
                ? {
                    backgroundColor: 'rgba(234, 179, 8, 0.16)',
                    borderColor: 'var(--semantic-warn)',
                    color: '#fde047',
                  }
                : { border: '1px solid var(--border-subtle)' }
            }
          >
            <i className="fas fa-bolt text-[10px]" />
            <span>Anarchy Override (Ctrl+A)</span>
          </button>
        </div>

        {p.gridEnabled && (
          <div
            className="flex items-center justify-between rounded-[4px] border px-2.5 py-1.5 text-[11px]"
            style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}
          >
            <span style={{ color: 'var(--text-secondary)' }}>Grid Step (m)</span>
            <input
              type="number"
              min={0.5}
              max={10}
              step={0.5}
              value={p.gridStep}
              onChange={(e) => p.onChangeGridStep(Math.max(0.5, Number(e.target.value) || 1))}
              className="mono-num h-6 w-16 rounded-[2px] border px-1.5 text-center text-[11px] outline-none"
              style={{
                backgroundColor: 'var(--bg-panel)',
                borderColor: 'var(--border-strong)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
        )}
      </section>

      <section className="border-t pt-2" style={{ borderColor: 'var(--border-subtle)' }}>
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex w-full cursor-pointer items-center justify-between py-1 text-[11px] font-medium"
          style={{ color: 'var(--text-secondary)' }}
        >
          <span>Advanced Geometry</span>
          <i className={`fas ${advancedOpen ? 'fa-chevron-down' : 'fa-chevron-right'} text-[10px]`} />
        </button>

        {advancedOpen && (
          <div className="mt-2 space-y-2">
            <div className="space-y-1">
              <div className="dcc-section-title">Corner Join Style</div>
              <div className="dcc-seg-group">
                {(['miter', 'round', 'bevel'] as const).map((js) => (
                  <button
                    key={js}
                    type="button"
                    onClick={() => p.onChangeJoinStyle(js)}
                    className={`dcc-seg-btn capitalize ${p.joinStyle === js ? 'active' : ''}`}
                  >
                    {js}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={p.onToggleRoadDebug}
              className={`dcc-btn w-full !justify-between px-2.5 text-[11px] ${p.showRoadDebug ? 'active' : ''}`}
              style={{ border: '1px solid var(--border-subtle)' }}
            >
              <span className="flex items-center gap-1.5">
                <i className="fas fa-draw-polygon text-[10px]" />
                <span>Road Mesh Debug</span>
              </span>
              <span className="dcc-kbd">Shift+G</span>
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
