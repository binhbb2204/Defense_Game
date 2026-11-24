import type { RoadGraphValidationIssue } from '@tactical-td/shared';

interface ValidationPanelProps {
  issues: RoadGraphValidationIssue[];
  onFocusIssue: (issue: RoadGraphValidationIssue) => void;
}

/**
 * Full-width non-blocking Road Graph Validation panel with click-to-focus rows.
 */
export function ValidationPanel({ issues, onFocusIssue }: ValidationPanelProps) {
  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto px-2.5 py-1.5 text-[11px]">
      {issues.length === 0 ? (
        <div className="flex items-center gap-2 py-2" style={{ color: 'var(--semantic-spawn)' }}>
          <i className="fas fa-check-circle" />
          <span>No validation warnings. All Spawn nodes reach a Base cleanly.</span>
        </div>
      ) : (
        issues.map((issue) => (
          <button
            key={issue.id}
            type="button"
            onClick={() => onFocusIssue(issue)}
            className="flex w-full cursor-pointer items-center justify-between rounded-[2px] border px-2.5 py-1.5 text-left hover:bg-[#242934]"
            style={{
              borderColor:
                issue.severity === 'error' ? 'var(--semantic-error)' : 'var(--border-strong)',
              backgroundColor:
                issue.severity === 'error'
                  ? 'rgba(239, 68, 68, 0.1)'
                  : 'rgba(234, 179, 8, 0.08)',
              color: issue.severity === 'error' ? '#fca5a5' : '#fde68a',
            }}
          >
            <span className="flex min-w-0 items-center gap-2">
              <i
                className={`fas ${
                  issue.severity === 'error' ? 'fa-times-circle' : 'fa-exclamation-triangle'
                }`}
              />
              <span className="truncate">{issue.message}</span>
            </span>
            <span
              className="mono-num ml-2 shrink-0 rounded px-1.5 py-0.5 text-[10px]"
              style={{
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
              }}
            >
              Focus
            </span>
          </button>
        ))
      )}
    </div>
  );
}
