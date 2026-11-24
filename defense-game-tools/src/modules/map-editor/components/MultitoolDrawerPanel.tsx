import type { ShapeMode } from '@tactical-td/shared';
import type { useShapeTool } from '../hooks';
import { MultitoolParamsCard } from './MultitoolParamsCard';

const CORE_MODES: Array<{ id: ShapeMode; label: string; icon: string }> = [
  { id: 'smooth', label: 'Smooth', icon: 'fa-bezier-curve' },
  { id: 'curve', label: 'Curve', icon: 'fa-wave-square' },
  { id: 'straighten', label: 'Straighten', icon: 'fa-ruler-horizontal' },
  { id: 'reverse', label: 'Reverse', icon: 'fa-exchange-alt' },
];

const TIER2_MODES: Array<{ id: ShapeMode; label: string; icon: string }> = [
  { id: 'round_corner', label: 'Round', icon: 'fa-draw-polygon' },
  { id: 'connect', label: 'Connect', icon: 'fa-link' },
  { id: 'parallel', label: 'Parallel', icon: 'fa-road' },
];

const MODE_DESCRIPTIONS: Record<ShapeMode, string> = {
  smooth: 'Converts sharp corners along a section into smooth cubic curves without changing node count.',
  curve: 'Replaces intermediate nodes along a continuous Bezier arc between start and end nodes.',
  straighten: 'Aligns every interior node onto a clean straight line between both endpoints.',
  reverse: 'Reverses enemy flow direction and lane arrows across the chosen road section.',
  round_corner: 'Replaces a single corner node with a smooth rounded circular fillet arc.',
  connect: 'Bridges two separate road segments with a smooth tangent curve.',
  parallel: 'Clones a parallel lane beside an existing road section at a fixed lateral offset.',
};

/**
 * Unified Cities: Skylines Network Multitool panel docked inside LeftToolDrawer when Shape (`T`) is active.
 */
export function MultitoolDrawerPanel({
  shape,
  anarchyEnabled,
}: {
  shape: ReturnType<typeof useShapeTool>;
  anarchyEnabled: boolean;
}) {
  const { mode, setMode, step, params, updateParams, sectionResult, error, preview } = shape;
  const alts = sectionResult?.alternatives.length ?? 0;
  const blockedMsg = error ?? (preview && !preview.allowed ? preview.blockedReason : null);
  const hasViolations = Boolean(preview && preview.violations.length > 0);
  const canApply = Boolean(preview?.allowed && (anarchyEnabled || !hasViolations));

  const nodeReadout = preview?.affectedNodeIds.length ?? sectionResult?.section?.nodeIds.length ?? 0;
  const lenReadout = preview?.length ?? sectionResult?.section?.length ?? 0;
  const radiusStr =
    preview && Number.isFinite(preview.minRadius) ? `${preview.minRadius.toFixed(1)} m` : 'Straight';

  const stepLabels =
    mode === 'round_corner'
      ? ['1. Pick Corner', '2. Adjust & Apply']
      : mode === 'connect'
        ? ['1. First Road', '2. Second Road', '3. Apply']
        : ['1. Start Node', '2. End Node', '3. Apply'];

  const currentStepIdx =
    step === 'pick_start' ? 0 : step === 'pick_end' ? 1 : stepLabels.length - 1;

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-3 text-xs">
      <section className="space-y-1.5">
        <div className="dcc-section-title">Section Shaping</div>
        <div className="grid grid-cols-2 gap-1.5">
          {CORE_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`dcc-btn !justify-start px-2.5 text-[11px] ${mode === m.id ? 'active' : ''}`}
              style={{
                border: `1px solid ${mode === m.id ? 'var(--accent)' : 'var(--border-subtle)'}`,
              }}
            >
              <i className={`fas ${m.icon} text-[10px]`} />
              <span>{m.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-1.5">
        <div className="dcc-section-title">Corners &amp; Branches</div>
        <div className="grid grid-cols-3 gap-1.5">
          {TIER2_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`dcc-btn px-1.5 text-[11px] ${mode === m.id ? 'active' : ''}`}
              style={{
                border: `1px solid ${mode === m.id ? 'var(--accent)' : 'var(--border-subtle)'}`,
              }}
            >
              <i className={`fas ${m.icon} text-[10px]`} />
              <span>{m.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section
        className="space-y-2 rounded-[4px] border p-2.5"
        style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}
      >
        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {MODE_DESCRIPTIONS[mode]}
        </p>
        <div className="flex items-center gap-1">
          {stepLabels.map((lbl, idx) => {
            const done = idx < currentStepIdx || (step === 'ready' && idx === currentStepIdx);
            const active = idx === currentStepIdx;
            return (
              <div
                key={lbl}
                className="flex flex-1 items-center justify-center gap-1 rounded-[3px] border px-1.5 py-1 text-[10px] font-medium"
                style={{
                  backgroundColor: active ? 'var(--accent-subtle)' : 'var(--bg-panel)',
                  borderColor: active
                    ? 'var(--accent)'
                    : done
                      ? 'var(--semantic-spawn)'
                      : 'var(--border-subtle)',
                  color: active ? '#93c5fd' : done ? '#86efac' : 'var(--text-muted)',
                }}
              >
                {idx < currentStepIdx && <i className="fas fa-check text-[8px]" />}
                <span className="truncate">{lbl}</span>
              </div>
            );
          })}
        </div>
      </section>

      <MultitoolParamsCard mode={mode} params={params} updateParams={updateParams} />

      {blockedMsg && (
        <div
          className="flex items-start gap-2 rounded-[4px] border p-2 text-[11px]"
          style={{ backgroundColor: 'rgba(239, 68, 68, 0.14)', borderColor: 'var(--semantic-error)', color: '#fecaca' }}
        >
          <i className="fas fa-exclamation-triangle mt-0.5 shrink-0" />
          <span>{blockedMsg}</span>
        </div>
      )}

      {preview && preview.warnings.length > 0 && (
        <div
          className="space-y-1.5 rounded-[4px] border p-2 text-[11px]"
          style={{
            backgroundColor: hasViolations ? 'rgba(239, 68, 68, 0.14)' : 'rgba(245, 158, 11, 0.14)',
            borderColor: hasViolations ? 'var(--semantic-error)' : '#f59e0b',
            color: hasViolations ? '#fecaca' : '#fde68a',
          }}
        >
          <div className="flex items-start gap-1.5">
            <i className="fas fa-exclamation-circle mt-0.5 shrink-0" />
            <span>{preview.warnings[0]}</span>
          </div>
          {hasViolations && (mode === 'smooth' || mode === 'curve' || mode === 'round_corner') && (
            <button
              type="button"
              onClick={shape.limitCurvature}
              className="w-full cursor-pointer rounded-[3px] border px-2 py-1 text-[10px] font-semibold"
              style={{ backgroundColor: 'var(--bg-panel)', borderColor: '#fca5a5', color: '#fecaca' }}
            >
              Limit Curvature Automatically
            </button>
          )}
        </div>
      )}

      {step === 'ready' && (
        <section
          className="space-y-2 rounded-[4px] border p-2.5"
          style={{ backgroundColor: 'var(--bg-header)', borderColor: 'var(--border-strong)' }}
        >
          <div className="grid grid-cols-3 gap-1 text-center">
            <StatCell label="Nodes" value={`${nodeReadout}`} />
            <StatCell label="Length" value={`${lenReadout.toFixed(1)}m`} />
            <StatCell label="Min R" value={radiusStr} warn={hasViolations && !anarchyEnabled} />
          </div>

          {alts > 1 && (
            <button
              type="button"
              onClick={shape.cycleAlternative}
              className="dcc-btn w-full text-[11px]"
              style={{ border: '1px solid var(--border-strong)' }}
            >
              <i className="fas fa-random text-[10px]" />
              <span>Switch Alternate Route</span>
            </button>
          )}

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={!canApply}
              onClick={shape.applyShape}
              className="flex min-h-[28px] cursor-pointer items-center justify-center gap-1.5 rounded-[4px] px-2 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              <i className="fas fa-check text-[10px]" />
              <span>Apply (Enter)</span>
            </button>
            <button
              type="button"
              onClick={shape.cancelSession}
              className="dcc-btn !min-h-[28px] text-[11px]"
              style={{ border: '1px solid var(--border-strong)' }}
            >
              Cancel (Esc)
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function StatCell({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-[3px] border px-1.5 py-1" style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
      <div className="text-[9px] uppercase" style={{ color: 'var(--text-muted)' }}>
        {label}
      </div>
      <div className="mono-num text-[11px] font-semibold" style={{ color: warn ? '#fca5a5' : 'var(--text-primary)' }}>
        {value}
      </div>
    </div>
  );
}
