import type { RoadPreviewHudState } from '../engine';

/**
 * Floating pointer telemetry box matching crisp native desktop CAD readouts (`42.6 m · 38°`, `R 14.2 m OK`)
 * and `CONTROL` tag projected near active control handle.
 */
export function RoadCursorHud({ hud }: { hud: RoadPreviewHudState | null }) {
  if (!hud || !hud.visible) return null;

  const statusColor =
    hud.status === 'error'
      ? '#f87171'
      : hud.status === 'warn'
        ? '#fbbf24'
        : '#4ade80';

  const hasFiniteRadius = hud.minRadius !== null && Number.isFinite(hud.minRadius);
  const topLineParts: string[] = [];
  if (hud.length !== null) topLineParts.push(`${hud.length.toFixed(1)} m`);
  if (hud.elevationY !== undefined && hud.elevationY > 0.05) {
    topLineParts.push(`Y ${hud.elevationY.toFixed(0)} m`);
  }
  if (hud.slopePct !== undefined && hud.slopePct !== null && hud.slopePct >= 1) {
    topLineParts.push(`${hud.slopePct.toFixed(0)}%`);
  }
  if (hud.angleDeg !== null) topLineParts.push(`${hud.angleDeg.toFixed(0)} deg`);
  if (hud.usedAngleSnap) topLineParts.push('15 deg');
  if (hud.snappedToTangent) topLineParts.push('Tangent');

  const bottomText =
    hud.status === 'error' || hud.status === 'warn'
      ? hud.statusText
      : hasFiniteRadius
        ? `R ${hud.minRadius!.toFixed(1)} m  OK`
        : hud.statusText;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {hud.stage === 'end' && hud.controlScreenPos && (
        <div
          className="mono-num absolute -translate-x-1/2 -translate-y-full rounded-[4px] border px-1.5 py-0.5 text-[10px] font-medium shadow"
          style={{
            left: hud.controlScreenPos.x,
            top: Math.max(24, hud.controlScreenPos.y - 10),
            backgroundColor: '#14171d',
            borderColor: '#3b82f6',
            color: '#8db8ff',
          }}
        >
          CONTROL
        </div>
      )}

      <div
        className="mono-num absolute rounded-[5px] border px-2.5 py-1.5 text-[11px] leading-snug shadow-xl"
        style={{
          left: Math.max(8, hud.screenX + 18),
          top: Math.max(24, hud.screenY - 12),
          backgroundColor: 'rgba(20, 23, 29, 0.94)',
          borderColor:
            hud.status === 'error'
              ? '#ef4444'
              : hud.status === 'warn'
                ? '#f59e0b'
                : '#2a2f3a',
        }}
      >
        {topLineParts.length > 0 && (
          <div style={{ color: '#e4e6ea' }}>{topLineParts.join(' · ')}</div>
        )}
        {bottomText && (
          <div style={{ color: hasFiniteRadius && hud.status === 'ok' ? statusColor : hud.status === 'ok' ? '#8db8ff' : statusColor }}>
            {bottomText}
          </div>
        )}
      </div>
    </div>
  );
}
