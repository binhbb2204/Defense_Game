import type { RoadGraphValidationIssue } from '@tactical-td/shared';
import type { ConsoleLogEntry } from '../types';
import { ValidationPanel } from './ValidationPanel';

/**
 * Expandable diagnostics drawer above StatusBar. Returns null (0px) when collapsed so
 * the 3D viewport gets full vertical space by default.
 */
export function BottomDockTray({
  collapsed,
  activeTab,
  validationIssues,
  logs,
  logFilter,
  logContainerRef,
  onToggleCollapse,
  onSelectTab,
  onChangeLogFilter,
  onClearLogs,
  onFocusIssue,
}: {
  collapsed: boolean;
  activeTab: 'output' | 'validation';
  validationIssues: RoadGraphValidationIssue[];
  logs: ConsoleLogEntry[];
  logFilter: string;
  logContainerRef: React.RefObject<HTMLDivElement | null>;
  onToggleCollapse: () => void;
  onSelectTab: (tab: 'output' | 'validation') => void;
  onChangeLogFilter: (filter: string) => void;
  onClearLogs: () => void;
  onFocusIssue: (issue: RoadGraphValidationIssue) => void;
}) {
  if (collapsed) return null;

  return (
    <footer
      className="flex h-36 shrink-0 flex-col border-t"
      style={{
        backgroundColor: 'var(--bg-panel)',
        borderColor: 'var(--border-subtle)',
      }}
    >
      <div
        className="flex h-7 shrink-0 items-center justify-between border-b px-2 text-[11px]"
        style={{ backgroundColor: 'var(--bg-header)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onSelectTab('validation')}
            className={`dcc-btn !min-h-[22px] px-2 text-[11px] ${activeTab === 'validation' ? 'active' : ''}`}
          >
            <span>Validation ({validationIssues.length})</span>
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('output')}
            className={`dcc-btn !min-h-[22px] px-2 text-[11px] ${activeTab === 'output' ? 'active' : ''}`}
          >
            <span>Output ({logs.length})</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'output' && (
            <>
              <input
                type="text"
                value={logFilter}
                onChange={(e) => onChangeLogFilter(e.target.value)}
                placeholder="Filter output..."
                className="h-5 w-36 rounded-[2px] border px-1.5 text-[10px] outline-none"
                style={{
                  backgroundColor: 'var(--bg-input)',
                  borderColor: 'var(--border-strong)',
                }}
              />
              <button
                type="button"
                onClick={onClearLogs}
                className="cursor-pointer text-[10px] hover:text-[#e5e7eb]"
                style={{ color: 'var(--text-muted)' }}
              >
                Clear
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onToggleCollapse}
            className="dcc-btn !min-h-[22px] !min-w-[22px] px-1"
            title="Collapse Drawer"
          >
            <i className="fas fa-chevron-down text-[10px]" />
          </button>
        </div>
      </div>

      {activeTab === 'validation' && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ValidationPanel issues={validationIssues} onFocusIssue={onFocusIssue} />
        </div>
      )}

      {activeTab === 'output' && (
        <div
          ref={logContainerRef}
          className="mono-num flex-1 overflow-y-auto px-2.5 py-1 text-[11px] leading-relaxed select-text"
          style={{ backgroundColor: 'var(--bg-input)' }}
        >
          {logs
            .filter(
              (l) =>
                !logFilter.trim() ||
                l.message.toLowerCase().includes(logFilter.toLowerCase()) ||
                l.tag.toLowerCase().includes(logFilter.toLowerCase()),
            )
            .map((entry) => (
              <div
                key={entry.id}
                style={{
                  color:
                    entry.level === 'ok'
                      ? '#86efac'
                      : entry.level === 'warn'
                        ? '#fde68a'
                        : entry.level === 'action'
                          ? '#93c5fd'
                          : 'var(--text-secondary)',
                }}
              >
                <span style={{ color: 'var(--text-muted)' }}>{entry.time}</span> [{entry.tag}]{' '}
                {entry.message}
              </div>
            ))}
        </div>
      )}
    </footer>
  );
}
