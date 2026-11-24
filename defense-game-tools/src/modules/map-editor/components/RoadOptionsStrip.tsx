import { ROAD_WIDTH_PRESETS, type RoadBuildMode } from '@tactical-td/shared';
import type { useRoadToolConfig } from '../hooks';
import { RoadSnapPopover } from './RoadSnapPopover';

const ROAD_MODES: Array<{ id: RoadBuildMode; label: string; title: string }> = [
  { id: 'straight', label: 'Straight', title: 'Straight road segments (1)' },
  { id: 'curve', label: 'Curve', title: '3-click Bezier curve: Start -> Control -> End (2)' },
  { id: 'free', label: 'Free', title: 'Flowing 1-click curves (3) — Shift forces straight' },
];

function RoadModeSvg({ id }: { id: RoadBuildMode }) {
  return (
    <svg className="h-3 w-[18px] fill-none stroke-current" viewBox="0 0 22 14" strokeWidth={1.6} strokeLinecap="round">
      {id === 'straight' && <path d="M2 12L20 2" />}
      {id === 'curve' && (
        <>
          <path d="M2 12Q15 12 20 2" />
          <circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none" />
        </>
      )}
      {id === 'free' && <path d="M2 12C7 12 8 3 12 7S17 11 20 2" />}
    </svg>
  );
}

/** Flush Road options bar segment rendered inside ToolOptionsBar when Road tool is active. */
export function RoadOptionsStrip({
  road,
  leftDrawerOpen,
  onToggleLeftDrawer,
  onBackspaceRoad,
  onFinishRoadChain,
}: {
  road: ReturnType<typeof useRoadToolConfig>;
  leftDrawerOpen: boolean;
  onToggleLeftDrawer: () => void;
  onBackspaceRoad: () => void;
  onFinishRoadChain: () => void;
}) {
  const curveStep = road.roadState.status === 'idle' ? 0 : road.roadState.curveControl ? 2 : 1;

  return (
    <>
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="flex items-center gap-0.5">
          {ROAD_MODES.map((m) => {
            const active = !road.roadUpgradeMode && road.roadBuildMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                title={m.title}
                onClick={() => road.selectRoadBuildMode(m.id)}
                className="flex h-6 cursor-pointer items-center gap-1.5 rounded-[4px] px-2.5 text-[11px] font-medium whitespace-nowrap transition-colors"
                style={{
                  backgroundColor: active ? 'var(--accent)' : 'transparent',
                  color: active ? '#ffffff' : '#9aa0a9',
                }}
              >
                <RoadModeSvg id={m.id} />
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>

        <span className="mx-0.5 h-4 w-[1px] shrink-0" style={{ backgroundColor: 'var(--border-subtle)' }} />

        <div className="flex items-center gap-0.5">
          {ROAD_WIDTH_PRESETS.map((preset) => {
            const active = Math.abs(road.roadWidth - preset.width) < 0.05;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => road.setRoadWidth(preset.width)}
                title={`${preset.label} road (${preset.width} m)`}
                className="mono-num flex h-6 cursor-pointer items-center rounded-[4px] px-2 text-[11px] whitespace-nowrap"
                style={{
                  backgroundColor: active ? '#252932' : 'transparent',
                  color: active ? '#ffffff' : '#8c919a',
                  fontWeight: active ? 500 : 400,
                }}
              >
                {preset.width} m
              </button>
            );
          })}
        </div>

        <span className="mx-0.5 h-4 w-[1px] shrink-0" style={{ backgroundColor: 'var(--border-subtle)' }} />

        <div
          className="flex h-6 shrink-0 items-center overflow-hidden rounded-[4px] border"
          style={{
            backgroundColor: road.drawElevation > 0 ? '#18253f' : '#191c22',
            borderColor: road.drawElevation > 0 ? 'var(--accent)' : '#2b303a',
          }}
        >
          <button
            type="button"
            disabled={road.drawElevation <= 0}
            onClick={() => road.stepElevation(-2)}
            title="Lower elevation 2m (PageDown or [)"
            className="flex h-full cursor-pointer items-center px-1.5 text-[10px] text-[#9aa0a9] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
          >
            <i className="fas fa-minus" />
          </button>
          <button
            type="button"
            onClick={road.resetElevation}
            title="Draw height — click or press Home to reset to 0m"
            className="mono-num flex h-full cursor-pointer items-center gap-1 px-1.5 text-[11px] font-medium whitespace-nowrap"
            style={{ color: road.drawElevation > 0 ? '#8db8ff' : '#c4c8cf' }}
          >
            <i className="fas fa-layer-group text-[9px] opacity-75" />
            <span>Y {road.drawElevation}m</span>
          </button>
          <button
            type="button"
            disabled={road.drawElevation >= 24}
            onClick={() => road.stepElevation(2)}
            title="Raise elevation 2m (PageUp or ])"
            className="flex h-full cursor-pointer items-center px-1.5 text-[10px] text-[#9aa0a9] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
          >
            <i className="fas fa-plus" />
          </button>
        </div>

        <span className="mx-0.5 h-4 w-[1px] shrink-0" style={{ backgroundColor: 'var(--border-subtle)' }} />

        <RoadSnapPopover
          snapEnabled={road.snapEnabled}
          gridEnabled={road.gridEnabled}
          gridStep={road.gridStep}
          angleSnap={road.angleSnap}
          anarchyEnabled={road.anarchyEnabled}
          autoIntersect={road.autoIntersect}
          onToggleSnap={() => road.setSnapEnabled((v) => !v)}
          onToggleGrid={() => road.setGridEnabled((v) => !v)}
          onChangeGridStep={road.setGridStep}
          onToggleAngleSnap={() => road.setAngleSnap((v) => !v)}
          onToggleAnarchy={() => road.setAnarchyEnabled((v) => !v)}
          onToggleAutoIntersect={() => road.setAutoIntersect((v) => !v)}
          onOpenMoreSettings={onToggleLeftDrawer}
        />

        <button
          type="button"
          onClick={road.toggleRoadUpgradeMode}
          title="Upgrade Width (U): click any existing road segment to apply active width"
          className="flex h-6 cursor-pointer items-center gap-1 rounded-[4px] border px-2 text-[11px] font-medium whitespace-nowrap"
          style={{
            backgroundColor: road.roadUpgradeMode ? '#18253f' : 'transparent',
            borderColor: road.roadUpgradeMode ? 'var(--accent)' : 'transparent',
            color: road.roadUpgradeMode ? '#8db8ff' : '#8c919a',
          }}
        >
          <i className="fas fa-arrows-alt-h text-[10px]" />
          <span>Upgrade</span>
        </button>

        <button
          type="button"
          onClick={onToggleLeftDrawer}
          title="Elevation, Bridge/Tunnel, Node Role & 3D Parts"
          className={`dcc-btn !min-h-[24px] !min-w-[24px] px-1.5 text-[11px] ${leftDrawerOpen ? 'active' : ''}`}
        >
          <i className="fas fa-sliders-h text-[10px]" />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {!road.roadUpgradeMode && road.roadBuildMode === 'curve' ? (
          <div className="mono-num hidden items-center gap-1.5 text-[11px] md:flex">
            <StepText num={1} label="Start" done={curveStep > 0} active={curveStep === 0} />
            <span style={{ color: '#4a4f58' }}>&rsaquo;</span>
            <StepText num={2} label="Control" done={curveStep > 1} active={curveStep === 1} />
            <span style={{ color: '#4a4f58' }}>&rsaquo;</span>
            <StepText num={3} label="End" done={false} active={curveStep === 2} />
          </div>
        ) : (
          road.roadState.status === 'drawing' && (
            <span className="mono-num hidden text-[11px] md:inline" style={{ color: '#8db8ff' }}>
              {road.roadState.chainNodeCount} nodes
            </span>
          )
        )}

        <button
          type="button"
          disabled={road.roadState.status !== 'drawing'}
          onClick={onBackspaceRoad}
          title="Step back (Backspace)"
          className="flex h-6 cursor-pointer items-center gap-1.5 rounded-[4px] border px-2 text-[11px] disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            backgroundColor: '#191c22',
            borderColor: '#2a2f3a',
            color: '#c4c8cf',
          }}
        >
          <span>Undo node</span>
          <span className="dcc-kbd">Bksp</span>
        </button>

        <button
          type="button"
          onClick={onFinishRoadChain}
          title={road.roadState.status === 'drawing' ? 'Finish road chain (Esc)' : 'Exit Road tool (Esc)'}
          className="flex h-6 cursor-pointer items-center gap-1.5 rounded-[4px] border px-2.5 text-[11px] font-medium"
          style={{
            backgroundColor: road.roadState.status === 'drawing' ? '#18253f' : '#191c22',
            borderColor: road.roadState.status === 'drawing' ? 'var(--accent)' : '#2a2f3a',
            color: road.roadState.status === 'drawing' ? '#ffffff' : '#c4c8cf',
          }}
        >
          <span>Finish</span>
          <span className="dcc-kbd">Esc</span>
        </button>
      </div>
    </>
  );
}

function StepText({
  num,
  label,
  done,
  active,
}: {
  num: number;
  label: string;
  done: boolean;
  active: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1"
      style={{ color: active ? '#ffffff' : done ? '#c4c8cf' : '#6b7280', fontWeight: active ? 600 : 400 }}
    >
      <span>
        {num} {label}
      </span>
      {done && <i className="fas fa-check text-[9px]" style={{ color: 'var(--semantic-spawn)' }} />}
    </span>
  );
}
