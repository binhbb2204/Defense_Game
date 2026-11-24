import type { RoadBuildMode, ShapeMode } from '@tactical-td/shared';
import type { ShapePickStep } from '../hooks/useShapeTool';
import type { RoadToolState, SnapHitKind } from '../tools';
import type { EditorTool } from '../types';
import { ViewportLegendPopover } from './ViewportLegendPopover';

export interface StatusBarProps {
  activeTool: EditorTool;
  roadBuildMode: RoadBuildMode;
  roadUpgradeMode: boolean;
  roadState: RoadToolState;
  shapeMode: ShapeMode;
  shapeStep: ShapePickStep;
  activeSnapKind: SnapHitKind;
  gridEnabled: boolean;
  gridStep: number;
  anarchyEnabled: boolean;
  nodeCount: number;
  segmentCount: number;
  drawElevation?: number;
  cursorCoords: { x: number; z: number };
  validationCount: number;
  logCount: number;
  bottomCollapsed: boolean;
  bottomTab: 'output' | 'validation';
  legendOpen: boolean;
  onToggleDiagnostics: (tab: 'output' | 'validation') => void;
  onToggleLegend: () => void;
  onCloseLegend: () => void;
}

const SHAPE_LABELS: Record<ShapeMode, string> = {
  smooth: 'Smooth',
  curve: 'Curve',
  straighten: 'Straighten',
  reverse: 'Reverse',
  round_corner: 'Round',
  connect: 'Connect',
  parallel: 'Parallel',
};

function getModePillLabel(p: StatusBarProps): string {
  if (p.activeTool === 'road') {
    if (p.roadUpgradeMode) return 'Road · Upgrade';
    if (p.roadBuildMode === 'curve') return 'Road · Curve';
    if (p.roadBuildMode === 'free') return 'Road · Free';
    return 'Road · Straight';
  }
  if (p.activeTool === 'shape') return `Multitool · ${SHAPE_LABELS[p.shapeMode]}`;
  if (p.activeTool === 'place') return 'Place Prop';
  if (p.activeTool === 'erase') return 'Erase';
  if (p.activeTool === 't-move') return 'Move';
  if (p.activeTool === 't-rotate') return 'Rotate';
  if (p.activeTool === 't-scale') return 'Scale';
  return 'Select';
}

function getInlineHint(p: StatusBarProps): { text: string; keys: Array<[string, string]> } {
  if (p.activeTool === 'road') {
    if (p.roadUpgradeMode) {
      return { text: 'Click segment to apply width', keys: [['Esc', 'exit']] };
    }
    if (p.roadBuildMode === 'curve') {
      const action =
        p.roadState.status === 'idle'
          ? 'Click start'
          : p.roadState.curveControl
            ? 'Click end point'
            : 'Click control point';
      return {
        text: action,
        keys: [['[ / ]', 'height'], ['Bksp', 'step back'], ['Alt', 'no snap'], ['Esc', 'finish']],
      };
    }
    if (p.roadBuildMode === 'free') {
      return {
        text: p.roadState.status === 'drawing' ? 'Click next node' : 'Click start',
        keys: [['[ / ]', 'height'], ['Shift', 'straight'], ['Bksp', 'undo'], ['Esc', 'finish']],
      };
    }
    return {
      text: p.roadState.status === 'drawing' ? 'Click next node' : 'Click start',
      keys: [['[ / ]', 'height'], ['Bksp', 'undo'], ['Alt', 'no snap'], ['Esc', 'finish']],
    };
  }
  if (p.activeTool === 'shape') {
    const action =
      p.shapeStep === 'ready'
        ? 'Adjust & apply'
        : p.shapeStep === 'pick_end'
          ? 'Click end'
          : 'Click start';
    return { text: action, keys: [['Enter', 'apply'], ['Esc', 'cancel']] };
  }
  if (p.activeTool === 'place') {
    return { text: 'Click ground to place', keys: [['R', 'rotate'], ['Esc', 'exit']] };
  }
  if (p.activeTool === 'erase') {
    return { text: 'Click entity to delete', keys: [['Esc', 'exit']] };
  }
  return {
    text: 'Click select',
    keys: [['LMB', 'pan'], ['RMB', 'orbit'], ['Wheel', 'zoom'], ['Del', 'delete']],
  };
}

/**
 * Compact 26px CAD footer with solid blue active-tool pill, inline keycap hints,
 * diagnostic drawer triggers (`Valid`, `Output`, `Legend`), and monospace telemetry.
 */
export function StatusBar(p: StatusBarProps) {
  const valActive = !p.bottomCollapsed && p.bottomTab === 'validation';
  const outActive = !p.bottomCollapsed && p.bottomTab === 'output';
  const hint = getInlineHint(p);
  const snapLabel =
    p.activeTool === 'road'
      ? p.activeSnapKind === 'grid'
        ? `Snap grid ${p.gridStep} m`
        : `Snap ${p.activeSnapKind}`
      : p.gridEnabled
        ? `Snap grid ${p.gridStep} m`
        : 'Snap off';

  return (
    <div
      className="relative flex h-[26px] shrink-0 items-center justify-between border-t px-2 text-[11px]"
      style={{
        backgroundColor: 'var(--bg-panel)',
        borderColor: 'var(--border-subtle)',
        color: '#9aa0a9',
      }}
    >
      <ViewportLegendPopover open={p.legendOpen} onClose={p.onCloseLegend} />

      {/* Left: Solid Blue Tool Pill + Inline Action & Shortcut Chips */}
      <div className="flex min-w-0 items-center gap-2.5 overflow-hidden">
        <span
          className="mono-num shrink-0 rounded-[3px] px-2 py-0.5 text-[10.5px] font-medium text-white"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          {getModePillLabel(p)}
        </span>

        <span className="shrink-0" style={{ color: '#c4c8cf' }}>
          {hint.text}
        </span>

        <div className="hidden items-center gap-2 sm:flex">
          {hint.keys.map(([k, desc]) => (
            <span key={k} className="inline-flex items-center gap-1 whitespace-nowrap" style={{ color: '#8c919a' }}>
              <span className="dcc-kbd">{k}</span>
              <span>{desc}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Right: Diagnostics + Snap + Nodes/Segs + Coordinates */}
      <div className="mono-num flex shrink-0 items-center gap-2.5 text-[10.5px]">
        <button
          type="button"
          onClick={() => p.onToggleDiagnostics('validation')}
          className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 hover:bg-[#1d2129]"
          style={{
            color: valActive ? '#ffffff' : p.validationCount === 0 ? '#9aa0a9' : '#fbbf24',
            backgroundColor: valActive ? '#18253f' : undefined,
          }}
          title="Toggle Validation Issues Drawer"
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: p.validationCount === 0 ? '#22c55e' : '#eab308' }}
          />
          <span>{p.validationCount === 0 ? 'Valid' : `${p.validationCount} Issues`}</span>
        </button>

        <button
          type="button"
          onClick={() => p.onToggleDiagnostics('output')}
          className="cursor-pointer rounded px-1.5 py-0.5 hover:bg-[#1d2129]"
          style={{
            color: outActive ? '#ffffff' : '#8c919a',
            backgroundColor: outActive ? '#18253f' : undefined,
          }}
          title="Toggle Console Output"
        >
          Output ({p.logCount})
        </button>

        <button
          type="button"
          onClick={p.onToggleLegend}
          className="cursor-pointer rounded px-1.5 py-0.5 hover:bg-[#1d2129]"
          style={{
            color: p.legendOpen ? '#ffffff' : '#8c919a',
            backgroundColor: p.legendOpen ? '#18253f' : undefined,
          }}
          title="Viewport Color Legend"
        >
          Legend
        </button>

        <span className="h-3.5 w-[1px]" style={{ backgroundColor: 'var(--border-subtle)' }} />

        {p.anarchyEnabled && (
          <span className="font-medium" style={{ color: '#fde047' }}>
            ANARCHY
          </span>
        )}
        <span className="hidden md:inline">{snapLabel}</span>
        <span>Nodes {p.nodeCount}</span>
        <span>Segs {p.segmentCount}</span>
        {p.activeTool === 'road' && (p.drawElevation ?? 0) > 0 && (
          <span className="font-medium" style={{ color: '#8db8ff' }}>
            Y {p.drawElevation}m
          </span>
        )}
        <span className="w-20 text-right" style={{ color: '#c4c8cf' }}>
          X {p.cursorCoords.x}  Z {p.cursorCoords.z}
        </span>
      </div>
    </div>
  );
}
