import type { useEditorTutorial } from '../hooks/useEditorTutorial';
import type { EditorTool } from '../types';

/**
 * Floating non-blocking interactive walkthrough anchored bottom-right in the 3D viewport,
 * collapsible down to a tiny `Guide X/6` pill.
 */
export function TutorialWidget({
  tutorial,
  onSelectTool,
  onOpenReference,
  onSave,
}: {
  tutorial: ReturnType<typeof useEditorTutorial>;
  onSelectTool: (t: EditorTool) => void;
  onOpenReference: () => void;
  onSave: () => void;
}) {
  if (!tutorial.open) return null;

  const { steps, activeStepIndex, completedCount, totalSteps, minimized } = tutorial;
  const current = steps[activeStepIndex] ?? steps[0]!;
  const progressPct = Math.round((completedCount / totalSteps) * 100);

  if (minimized) {
    return (
      <div className="pointer-events-auto absolute right-3 bottom-12 z-20 flex items-center gap-1">
        <button
          type="button"
          onClick={tutorial.toggleMinimized}
          className="flex cursor-pointer items-center gap-2 rounded-[5px] border px-3 py-1.5 text-[11px] font-medium shadow-xl"
          style={{
            backgroundColor: 'rgba(20, 23, 29, 0.94)',
            borderColor: 'var(--border-strong)',
            color: 'var(--text-primary)',
          }}
        >
          <i className="fas fa-graduation-cap text-xs" style={{ color: 'var(--accent)' }} />
          <span>Tutorial</span>
          <span className="mono-num text-[10px]" style={{ color: '#93c5fd' }}>
            {completedCount}/{totalSteps}
          </span>
        </button>
      </div>
    );
  }

  const handlePrimaryAction = () => {
    if (current.recommendedTool) {
      onSelectTool(current.recommendedTool);
      return;
    }
    if (current.id === 'camera') {
      tutorial.markStepDone('camera');
      tutorial.goToStep(activeStepIndex + 1);
      return;
    }
    if (current.id === 'validate') {
      onSave();
      tutorial.markStepDone('validate');
    }
  };

  return (
    <div
      className="pointer-events-auto absolute right-3 bottom-12 z-20 w-[316px] max-w-[calc(100%-24px)] overflow-hidden rounded-[6px] border shadow-2xl"
      style={{
        backgroundColor: 'rgba(23, 26, 32, 0.96)',
        borderColor: 'var(--border-strong)',
        color: 'var(--text-primary)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between border-b px-3 py-2"
        style={{ backgroundColor: 'var(--bg-header)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="flex items-center gap-2 text-[11px] font-semibold">
          <i className="fas fa-graduation-cap" style={{ color: 'var(--accent)' }} />
          <span>Quick-Start Tutorial</span>
          <span
            className="mono-num rounded px-1.5 py-0.5 text-[10px]"
            style={{ backgroundColor: 'var(--bg-input)', color: '#93c5fd' }}
          >
            {completedCount}/{totalSteps}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={tutorial.toggleMinimized}
            title="Minimize"
            className="dcc-btn !min-h-[22px] !min-w-[22px] px-1"
          >
            <i className="fas fa-minus text-[10px]" />
          </button>
          <button
            type="button"
            onClick={tutorial.closeTutorial}
            title="Close Guide"
            className="dcc-btn !min-h-[22px] !min-w-[22px] px-1"
          >
            <i className="fas fa-times text-[10px]" />
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-1 w-full" style={{ backgroundColor: 'var(--bg-input)' }}>
        <div
          className="h-full transition-all duration-200"
          style={{ width: `${progressPct}%`, backgroundColor: 'var(--accent)' }}
        />
      </div>

      {/* Step Dots */}
      <div className="flex items-center gap-1 border-b px-3 py-1.5" style={{ borderColor: 'var(--border-subtle)' }}>
        {steps.map((s, idx) => {
          const isCur = idx === activeStepIndex;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => tutorial.goToStep(idx)}
              title={`${s.number}. ${s.title}`}
              className="mono-num flex h-5 flex-1 cursor-pointer items-center justify-center rounded-[3px] border text-[10px] font-medium"
              style={{
                backgroundColor: isCur
                  ? 'var(--accent-subtle)'
                  : s.completed
                    ? 'rgba(34, 197, 94, 0.14)'
                    : 'var(--bg-input)',
                borderColor: isCur
                  ? 'var(--accent)'
                  : s.completed
                    ? 'var(--semantic-spawn)'
                    : 'var(--border-subtle)',
                color: isCur ? '#93c5fd' : s.completed ? '#86efac' : 'var(--text-muted)',
              }}
            >
              {s.completed ? <i className="fas fa-check text-[9px]" /> : s.number}
            </button>
          );
        })}
      </div>

      {/* Step Body */}
      <div className="space-y-2.5 p-3 text-xs">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            {current.number}. {current.title}
          </h4>
          {current.completed && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: 'rgba(34, 197, 94, 0.16)', color: '#86efac' }}
            >
              <i className="fas fa-check-circle text-[9px]" />
              Done
            </span>
          )}
        </div>

        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {current.summary}
        </p>

        <div className="flex flex-wrap gap-1">
          {current.keys.map((k) => (
            <span key={k} className="dcc-kbd">
              {k}
            </span>
          ))}
        </div>

        {/* Step Actions */}
        <div className="flex items-center gap-1.5 pt-1">
          <button
            type="button"
            onClick={handlePrimaryAction}
            className="flex min-h-[26px] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[4px] px-2.5 text-[11px] font-semibold text-white"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            <span>{current.actionLabel}</span>
            <i className="fas fa-arrow-right text-[9px]" />
          </button>

          {!current.completed && current.id !== 'camera' && (
            <button
              type="button"
              onClick={() => tutorial.markStepDone(current.id)}
              className="dcc-btn !min-h-[26px] px-2 text-[10px]"
              style={{ border: '1px solid var(--border-subtle)' }}
              title="Skip / Mark Step Complete"
            >
              Done
            </button>
          )}
        </div>
      </div>

      {/* Footer Nav */}
      <div
        className="flex items-center justify-between border-t px-2.5 py-1.5 text-[11px]"
        style={{ backgroundColor: 'var(--bg-header)', borderColor: 'var(--border-subtle)' }}
      >
        <button
          type="button"
          onClick={onOpenReference}
          className="cursor-pointer text-[11px] hover:underline"
          style={{ color: '#93c5fd' }}
        >
          <i className="fas fa-book mr-1 text-[10px]" />
          Shortcuts &amp; Reference (F1)
        </button>

        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={activeStepIndex === 0}
            onClick={() => tutorial.goToStep(activeStepIndex - 1)}
            className="dcc-btn !min-h-[22px] px-2 text-[10px]"
            style={{ border: '1px solid var(--border-subtle)' }}
          >
            Prev
          </button>
          <button
            type="button"
            disabled={activeStepIndex === totalSteps - 1}
            onClick={() => tutorial.goToStep(activeStepIndex + 1)}
            className="dcc-btn !min-h-[22px] px-2 text-[10px]"
            style={{ border: '1px solid var(--border-subtle)' }}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
