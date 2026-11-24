import type { RoadBuildMode } from '@tactical-td/shared';
import type { RoadPreviewHudState } from '../../engine';

const MODE_TIP: Record<RoadBuildMode, string> = {
  straight: 'Straight: click to place chained straight segments. Toggle Angle 15 deg for crisp grid/angle steps.',
  curve: 'Curve: click start, then the control point (snaps to previous tangent), then the end. Switch to Free for one-click smooth curves.',
  free: 'Free: draws symmetric flowing curves with one click per node. Hold Shift for straight; turns > 75 deg create a crisp corner.',
};

/** Live "New segment" readout card rendered in the Inspector while placing a road segment. */
export function NewSegmentPreviewInspector({
  hud,
  buildMode,
  roadWidth,
}: {
  hud: RoadPreviewHudState;
  buildMode: RoadBuildMode;
  roadWidth: number;
}) {
  const modeLabel = buildMode === 'curve' ? 'Curve' : buildMode === 'free' ? 'Free' : 'Straight';
  const radiusColor =
    hud.status === 'error' ? '#f87171' : hud.status === 'warn' ? '#fbbf24' : '#4ade80';
  const radiusText =
    hud.minRadius !== null && Number.isFinite(hud.minRadius)
      ? `${hud.minRadius.toFixed(1)} m  ${hud.status === 'ok' ? 'OK' : 'Tight'}`
      : 'Straight';

  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="flex items-center justify-between border-b pb-1.5" style={{ borderColor: 'var(--border-subtle)' }}>
        <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
          New segment
        </span>
        <span className="mono-num text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          {modeLabel}
        </span>
      </div>

      {hud.length !== null && (
        <div>
          <div className="dcc-section-title mb-0.5">Length</div>
          <div className="mono-num text-[18px] font-medium" style={{ color: '#ffffff' }}>
            {hud.length.toFixed(1)} m
          </div>
        </div>
      )}

      {hud.controlPoint && (
        <div>
          <div className="dcc-section-title mb-1">Control Point</div>
          <div className="mono-num grid grid-cols-3 gap-1.5 text-[11px]">
            {(
              [
                ['X', hud.controlPoint.x],
                ['Y', hud.controlPoint.y],
                ['Z', hud.controlPoint.z],
              ] as const
            ).map(([axis, val]) => (
              <div
                key={axis}
                className="flex justify-between rounded-[4px] border px-2 py-1"
                style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}
              >
                <span style={{ color: 'var(--text-muted)' }}>{axis}</span>
                <span>{val.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1 text-[11px]">
        {hud.elevationY !== undefined && (
          <div className="flex items-center justify-between">
            <span style={{ color: 'var(--text-secondary)' }}>Height</span>
            <span
              className="mono-num font-medium"
              style={{ color: hud.elevationY > 0.05 ? '#8db8ff' : 'var(--text-primary)' }}
            >
              Y {hud.elevationY.toFixed(1)} m
            </span>
          </div>
        )}
        {hud.slopePct !== undefined && hud.slopePct !== null && (
          <div className="flex items-center justify-between">
            <span style={{ color: 'var(--text-secondary)' }}>Grade</span>
            <span
              className="mono-num font-medium"
              style={{ color: hud.slopePct > 22 ? '#f87171' : 'var(--text-primary)' }}
            >
              {hud.slopePct.toFixed(0)}%
            </span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--text-secondary)' }}>Min radius</span>
          <span className="mono-num font-medium" style={{ color: radiusColor }}>
            {radiusText}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--text-secondary)' }}>Road width</span>
          <span className="mono-num" style={{ color: 'var(--text-primary)' }}>
            {roadWidth} m
          </span>
        </div>
      </div>

      <div
        className="rounded-[6px] border p-2.5 text-[11px] leading-relaxed"
        style={{
          backgroundColor: 'var(--bg-input)',
          borderColor: 'var(--border-subtle)',
          color: 'var(--text-secondary)',
        }}
      >
        {MODE_TIP[buildMode]}
      </div>
    </div>
  );
}
