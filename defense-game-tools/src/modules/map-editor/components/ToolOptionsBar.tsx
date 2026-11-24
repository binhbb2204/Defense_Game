import type { ShapeMode } from '@tactical-td/shared';
import type { useRoadToolConfig, useShapeTool } from '../hooks';
import type { EditorTool } from '../types';
import { RoadOptionsStrip } from './RoadOptionsStrip';

export interface ToolOptionsBarProps {
  activeTool: EditorTool;
  road: ReturnType<typeof useRoadToolConfig>;
  shape: ReturnType<typeof useShapeTool>;
  selectedAssetLabel?: string;
  placeOnce: boolean;
  selectionCount: number;
  showFloatingMinimap: boolean;
  rightDockOpen: boolean;
  leftDrawerOpen: boolean;
  onChangePlaceOnce: (v: boolean) => void;
  onRotateProp: () => void;
  onOpen3dPicker: () => void;
  onFinishRoadChain: () => void;
  onBackspaceRoad: () => void;
  onToggleLeftDrawer: () => void;
  onToggleMinimap: () => void;
  onToggleInspector: () => void;
  onToggleLockLos: () => void;
  onFocusSelection: () => void;
  onDeleteSelection: () => void;
}

const SHAPE_MODES: Array<{ id: ShapeMode; label: string }> = [
  { id: 'smooth', label: 'Smooth' },
  { id: 'curve', label: 'Curve' },
  { id: 'straighten', label: 'Straighten' },
  { id: 'reverse', label: 'Reverse' },
  { id: 'round_corner', label: 'Round' },
  { id: 'connect', label: 'Connect' },
  { id: 'parallel', label: 'Parallel' },
];

/**
 * Flush 36px CAD Tool Options bar directly under ToolShell so active-tool controls
 * stay clean and docked without floating pills blocking the 3D canvas.
 */
export function ToolOptionsBar(p: ToolOptionsBarProps) {
  const { road, shape } = p;

  return (
    <div
      className="z-30 flex h-9 shrink-0 items-center justify-between gap-2 border-b px-2.5 text-[11px]"
      style={{
        backgroundColor: 'var(--bg-header)',
        borderColor: 'var(--border-subtle)',
        color: 'var(--text-secondary)',
      }}
    >
      {p.activeTool === 'road' ? (
        <RoadOptionsStrip
          road={road}
          leftDrawerOpen={p.leftDrawerOpen}
          onToggleLeftDrawer={p.onToggleLeftDrawer}
          onBackspaceRoad={p.onBackspaceRoad}
          onFinishRoadChain={p.onFinishRoadChain}
        />
      ) : p.activeTool === 'shape' ? (
        <>
          <div className="flex items-center gap-1 overflow-x-auto">
            {SHAPE_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => shape.setMode(m.id)}
                className="flex h-6 cursor-pointer items-center rounded-[4px] px-2 text-[11px] font-medium whitespace-nowrap"
                style={{
                  backgroundColor: shape.mode === m.id ? 'var(--accent)' : 'transparent',
                  color: shape.mode === m.id ? '#ffffff' : '#9aa0a9',
                }}
              >
                {m.label}
              </button>
            ))}
            <button
              type="button"
              onClick={p.onToggleLeftDrawer}
              title="Toggle Multitool parameters drawer"
              className={`dcc-btn !min-h-[24px] px-1.5 text-[11px] ${p.leftDrawerOpen ? 'active' : ''}`}
            >
              <i className="fas fa-sliders-h text-[10px]" />
            </button>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {shape.step === 'ready' && (
              <button
                type="button"
                onClick={shape.applyShape}
                className="flex h-6 cursor-pointer items-center gap-1 rounded-[4px] px-2.5 text-[11px] font-medium text-white"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                <span>Apply</span>
                <span className="dcc-kbd">Enter</span>
              </button>
            )}
            <button
              type="button"
              onClick={shape.cancelSession}
              className="flex h-6 cursor-pointer items-center gap-1.5 rounded-[4px] border px-2 text-[11px]"
              style={{ backgroundColor: '#191c22', borderColor: '#2a2f3a', color: '#c4c8cf' }}
            >
              <span>Reset</span>
              <span className="dcc-kbd">Esc</span>
            </button>
          </div>
        </>
      ) : p.activeTool === 'place' ? (
        <>
          <div className="flex items-center gap-2">
            <span className="font-medium text-white">{p.selectedAssetLabel ?? 'Select a prop in drawer'}</span>
            <Divider />
            <button
              type="button"
              onClick={p.onRotateProp}
              className="flex h-6 cursor-pointer items-center gap-1.5 rounded-[4px] border px-2 text-[11px]"
              style={{ backgroundColor: '#191c22', borderColor: '#2a2f3a', color: '#c4c8cf' }}
            >
              <span>Rotate +15 deg</span>
              <span className="dcc-kbd">R</span>
            </button>
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px]">
              <input
                type="checkbox"
                checked={p.placeOnce}
                onChange={(e) => p.onChangePlaceOnce(e.target.checked)}
                className="accent-[#3b82f6]"
              />
              <span>Place once</span>
            </label>
            <button
              type="button"
              onClick={p.onOpen3dPicker}
              className="flex h-6 cursor-pointer items-center gap-1.5 rounded-[4px] border px-2 text-[11px]"
              style={{ backgroundColor: '#191c22', borderColor: '#2a2f3a', color: '#c4c8cf' }}
            >
              <i className="fas fa-file-import text-[10px]" />
              <span>Import 3D...</span>
            </button>
          </div>
          <UtilityRightControls
            showMinimap={p.showFloatingMinimap}
            rightDockOpen={p.rightDockOpen}
            onToggleMinimap={p.onToggleMinimap}
            onToggleInspector={p.onToggleInspector}
          />
        </>
      ) : (
        <>
          <div className="flex items-center gap-1.5">
            <span className="font-medium capitalize text-white">
              {p.activeTool.replace('t-', '')}
            </span>
            {p.selectionCount > 0 && (
              <>
                <Divider />
                <span className="mono-num text-[11px]">{p.selectionCount} selected</span>
                <button
                  type="button"
                  onClick={p.onFocusSelection}
                  className="flex h-6 cursor-pointer items-center gap-1 rounded-[4px] border px-2 text-[11px]"
                  style={{ backgroundColor: '#191c22', borderColor: '#2a2f3a', color: '#c4c8cf' }}
                >
                  <span>Focus</span>
                  <span className="dcc-kbd">F</span>
                </button>
                <button
                  type="button"
                  onClick={p.onToggleLockLos}
                  className="flex h-6 cursor-pointer items-center gap-1 rounded-[4px] border px-2 text-[11px]"
                  style={{ backgroundColor: '#191c22', borderColor: '#2a2f3a', color: '#c4c8cf' }}
                >
                  <i className="fas fa-shield-alt text-[10px]" />
                  <span>Toggle LoS Block</span>
                </button>
                <button
                  type="button"
                  onClick={p.onDeleteSelection}
                  className="flex h-6 cursor-pointer items-center gap-1 rounded-[4px] border px-2 text-[11px]"
                  style={{ backgroundColor: 'rgba(239,68,68,0.12)', borderColor: 'var(--semantic-error)', color: '#fca5a5' }}
                >
                  <span>Delete</span>
                  <span className="dcc-kbd">Del</span>
                </button>
              </>
            )}
          </div>
          <UtilityRightControls
            showMinimap={p.showFloatingMinimap}
            rightDockOpen={p.rightDockOpen}
            onToggleMinimap={p.onToggleMinimap}
            onToggleInspector={p.onToggleInspector}
          />
        </>
      )}
    </div>
  );
}

function Divider() {
  return <span className="mx-0.5 h-4 w-[1px] shrink-0" style={{ backgroundColor: 'var(--border-subtle)' }} />;
}

function UtilityRightControls({
  showMinimap,
  rightDockOpen,
  onToggleMinimap,
  onToggleInspector,
}: {
  showMinimap: boolean;
  rightDockOpen: boolean;
  onToggleMinimap: () => void;
  onToggleInspector: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onToggleMinimap}
        className={`dcc-btn !min-h-[24px] px-2 text-[11px] ${showMinimap ? 'active' : ''}`}
      >
        <span>Minimap (M)</span>
      </button>
      <button
        type="button"
        onClick={onToggleInspector}
        className={`dcc-btn !min-h-[24px] px-2 text-[11px] ${rightDockOpen ? 'active' : ''}`}
      >
        <span>Scene</span>
      </button>
    </div>
  );
}
