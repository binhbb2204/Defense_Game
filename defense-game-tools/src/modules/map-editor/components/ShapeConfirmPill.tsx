import type { useShapeTool } from '../hooks';

/**
 * Compact floating bottom-center confirmation pill shown in the 3D viewport ONLY when
 * Shape/Multitool has an active selection ready to apply, a warning, or a pick error.
 */
export function ShapeConfirmPill({
  shape,
  anarchyEnabled,
}: {
  shape: ReturnType<typeof useShapeTool>;
  anarchyEnabled: boolean;
}) {
  const { mode, step, sectionResult, error, preview } = shape;
  const blockedMsg = error ?? (preview && !preview.allowed ? preview.blockedReason : null);
  const hasViolations = Boolean(preview && preview.violations.length > 0);
  const canApply = Boolean(preview?.allowed && (anarchyEnabled || !hasViolations));
  const alts = sectionResult?.alternatives.length ?? 0;

  if (step !== 'ready' && !blockedMsg && !(preview && preview.warnings.length > 0)) {
    return null;
  }

  const lenReadout = preview?.length ?? sectionResult?.section?.length ?? 0;
  const radiusStr =
    preview && Number.isFinite(preview.minRadius) ? `${preview.minRadius.toFixed(1)}m` : 'Straight';

  return (
    <div className="pointer-events-none absolute right-3 bottom-3 left-3 z-20 flex flex-col items-center gap-1.5">
      {blockedMsg && (
        <div
          className="pointer-events-auto flex items-center gap-2 rounded-[4px] border px-3 py-1 text-[11px] font-medium shadow"
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.22)',
            borderColor: 'var(--semantic-error)',
            color: '#fecaca',
          }}
        >
          <i className="fas fa-exclamation-triangle" />
          <span>{blockedMsg}</span>
        </div>
      )}

      {preview && preview.warnings.length > 0 && (
        <div
          className="pointer-events-auto flex items-center gap-2 rounded-[4px] border px-3 py-1 text-[11px] shadow"
          style={{
            backgroundColor: hasViolations ? 'rgba(239, 68, 68, 0.22)' : 'rgba(245, 158, 11, 0.22)',
            borderColor: hasViolations ? 'var(--semantic-error)' : '#f59e0b',
            color: hasViolations ? '#fecaca' : '#fde68a',
          }}
        >
          <i className="fas fa-exclamation-circle" />
          <span>{preview.warnings[0]}</span>
          {hasViolations && (mode === 'smooth' || mode === 'curve' || mode === 'round_corner') && (
            <button
              type="button"
              onClick={shape.limitCurvature}
              className="ml-1 cursor-pointer rounded-[3px] border px-2 py-0.5 text-[10px] font-semibold"
              style={{ backgroundColor: 'var(--bg-panel)', borderColor: '#fca5a5', color: '#fecaca' }}
            >
              Limit curvature
            </button>
          )}
        </div>
      )}

      {step === 'ready' && (
        <div
          className="pointer-events-auto flex items-center gap-2 rounded-[6px] border px-2.5 py-1.5 text-[11px] shadow-xl"
          style={{
            backgroundColor: 'rgba(23, 26, 32, 0.94)',
            borderColor: 'var(--border-strong)',
            color: 'var(--text-primary)',
          }}
        >
          <span className="mono-num text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            {lenReadout.toFixed(1)}m | R {radiusStr}
          </span>
          {alts > 1 && (
            <button
              type="button"
              onClick={shape.cycleAlternative}
              className="dcc-btn !min-h-[24px] px-2 text-[11px]"
              style={{ border: '1px solid var(--border-subtle)' }}
            >
              <i className="fas fa-random text-[10px]" />
              <span>Alt</span>
            </button>
          )}
          <button
            type="button"
            disabled={!canApply}
            onClick={shape.applyShape}
            className="flex min-h-[24px] cursor-pointer items-center gap-1 rounded-[4px] px-2.5 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            <i className="fas fa-check text-[10px]" />
            <span>Apply (Enter)</span>
          </button>
          <button
            type="button"
            onClick={shape.cancelSession}
            className="dcc-btn !min-h-[24px] px-2 text-[11px]"
            style={{ border: '1px solid var(--border-subtle)' }}
          >
            Cancel (Esc)
          </button>
        </div>
      )}
    </div>
  );
}
