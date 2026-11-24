import type { ShapeMode } from '@tactical-td/shared';
import type { ShapeToolParams } from '../hooks/useShapeTool';

/** Per-mode parameter controls rendered inside MultitoolDrawerPanel. */
export function MultitoolParamsCard({
  mode,
  params,
  updateParams,
}: {
  mode: ShapeMode;
  params: ShapeToolParams;
  updateParams: (patch: Partial<ShapeToolParams>) => void;
}) {
  return (
    <section
      className="space-y-2.5 rounded-[4px] border p-2.5"
      style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}
    >
      <div className="dcc-section-title">Parameters</div>

      {mode === 'smooth' && (
        <DrawerSlider
          label="Tension"
          min={0}
          max={1}
          step={0.05}
          value={params.tension}
          display={params.tension.toFixed(2)}
          onChange={(v) => updateParams({ tension: v })}
        />
      )}

      {mode === 'curve' && (
        <>
          <DrawerSlider
            label="Handle Strength"
            min={0.1}
            max={0.8}
            step={0.05}
            value={params.handleFactor}
            display={params.handleFactor.toFixed(2)}
            onChange={(v) => updateParams({ handleFactor: v })}
          />
          <div className="dcc-seg-group">
            <button
              type="button"
              onClick={() => updateParams({ useNodeCount: false })}
              className={`dcc-seg-btn ${!params.useNodeCount ? 'active' : ''}`}
            >
              By Spacing
            </button>
            <button
              type="button"
              onClick={() => updateParams({ useNodeCount: true })}
              className={`dcc-seg-btn ${params.useNodeCount ? 'active' : ''}`}
            >
              By Count
            </button>
          </div>
          {params.useNodeCount ? (
            <DrawerSlider
              label="Node Count"
              min={2}
              max={18}
              step={1}
              value={params.nodeCount}
              display={`${params.nodeCount}`}
              onChange={(v) => updateParams({ nodeCount: v })}
            />
          ) : (
            <DrawerSlider
              label="Segment Step"
              min={3}
              max={20}
              step={1}
              value={params.spacing}
              display={`${params.spacing} m`}
              onChange={(v) => updateParams({ spacing: v })}
            />
          )}
        </>
      )}

      {mode === 'straighten' && (
        <label className="flex cursor-pointer items-center gap-2 text-[11px]" style={{ color: 'var(--text-primary)' }}>
          <input
            type="checkbox"
            checked={params.equaliseSpacing}
            onChange={(e) => updateParams({ equaliseSpacing: e.target.checked })}
            className="accent-[#3b82f6]"
          />
          <span>Equalise spacing along line</span>
        </label>
      )}

      {mode === 'reverse' && (
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          No extra sliders needed. Pick both ends of a chain to flip direction.
        </div>
      )}

      {mode === 'round_corner' && (
        <DrawerSlider
          label="Corner Radius"
          min={2}
          max={40}
          step={1}
          value={params.cornerRadius}
          display={`${params.cornerRadius} m`}
          onChange={(v) => updateParams({ cornerRadius: v })}
        />
      )}

      {mode === 'connect' && (
        <DrawerSlider
          label="Arc Radius"
          min={2}
          max={30}
          step={1}
          value={params.connectRadius}
          display={`${params.connectRadius} m`}
          onChange={(v) => updateParams({ connectRadius: v })}
        />
      )}

      {mode === 'parallel' && (
        <>
          <DrawerSlider
            label="Lateral Offset"
            min={3}
            max={30}
            step={1}
            value={params.parallelOffset}
            display={`${params.parallelOffset} m`}
            onChange={(v) => updateParams({ parallelOffset: v })}
          />
          <div className="dcc-seg-group">
            <button
              type="button"
              onClick={() => updateParams({ parallelSide: 'left' })}
              className={`dcc-seg-btn ${params.parallelSide === 'left' ? 'active' : ''}`}
            >
              Left Side
            </button>
            <button
              type="button"
              onClick={() => updateParams({ parallelSide: 'right' })}
              className={`dcc-seg-btn ${params.parallelSide === 'right' ? 'active' : ''}`}
            >
              Right Side
            </button>
          </div>
          <DrawerSlider
            label="Node Spacing"
            min={4}
            max={20}
            step={1}
            value={params.spacing}
            display={`${params.spacing} m`}
            onChange={(v) => updateParams({ spacing: v })}
          />
        </>
      )}
    </section>
  );
}

function DrawerSlider({
  label,
  min,
  max,
  step,
  value,
  display,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span className="mono-num font-medium" style={{ color: 'var(--text-primary)' }}>
          {display}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="dcc-slider"
      />
    </div>
  );
}
