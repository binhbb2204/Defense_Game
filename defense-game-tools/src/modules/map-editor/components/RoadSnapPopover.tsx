import { useEffect, useRef, useState } from 'react';

export interface RoadSnapPopoverProps {
  snapEnabled: boolean;
  gridEnabled: boolean;
  gridStep: number;
  angleSnap: boolean;
  anarchyEnabled: boolean;
  autoIntersect: boolean;
  onToggleSnap: () => void;
  onToggleGrid: () => void;
  onChangeGridStep: (step: number) => void;
  onToggleAngleSnap: () => void;
  onToggleAnarchy: () => void;
  onToggleAutoIntersect: () => void;
  onOpenMoreSettings: () => void;
}

/**
 * Clean native desktop popover anchored under `Snap · grid 2 m v`,
 * housing checkbox + subtitle rows without bloating the horizontal tool bar.
 */
export function RoadSnapPopover(p: RoadSnapPopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const summary = p.gridEnabled
    ? `Snap · grid ${p.gridStep} m`
    : p.snapEnabled
      ? 'Snap · nodes'
      : p.angleSnap
        ? 'Angle 15 deg'
        : 'Snap · off';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-6 cursor-pointer items-center gap-2 rounded-[4px] border px-2.5 text-[11px] font-medium whitespace-nowrap hover:border-[#3b82f6]"
        style={{
          backgroundColor: open ? '#1e2430' : '#191c22',
          borderColor: open ? 'var(--accent)' : '#2b303a',
          color: '#e4e6ea',
        }}
      >
        {p.anarchyEnabled && (
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: 'var(--semantic-warn)' }}
            title="Anarchy active"
          />
        )}
        <span>{summary}</span>
        <i className={`fas fa-chevron-down text-[9px] transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: '#8c919a' }} />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 z-50 mt-1.5 w-64 rounded-[6px] border p-1.5 shadow-2xl"
          style={{ backgroundColor: '#171a20', borderColor: '#2d323d', color: '#e5e7eb' }}
        >
          <PopoverCheckRow
            checked={p.snapEnabled}
            title="Snap to nodes and roads"
            subtitle="Connect when near an existing node"
            onClick={p.onToggleSnap}
          />
          <PopoverCheckRow
            checked={p.gridEnabled}
            title={`Snap to grid · ${p.gridStep} m`}
            subtitle="Grid shows only while drawing"
            onClick={p.onToggleGrid}
            rightControl={
              p.gridEnabled ? (
                <div className="flex gap-0.5" onClick={(e) => e.stopPropagation()}>
                  {[1, 2, 4].map((step) => (
                    <button
                      key={step}
                      type="button"
                      onClick={() => p.onChangeGridStep(step)}
                      className="mono-num cursor-pointer rounded-[3px] px-1.5 py-0.5 text-[10px]"
                      style={{
                        backgroundColor: p.gridStep === step ? '#252932' : '#0e1014',
                        color: p.gridStep === step ? '#ffffff' : '#8c919a',
                        border: '1px solid #2a2f3a',
                      }}
                    >
                      {step}m
                    </button>
                  ))}
                </div>
              ) : undefined
            }
          />
          <PopoverCheckRow
            checked={p.angleSnap}
            title="Angle snap · 15 deg"
            subtitle="Lock the direction in steps"
            onClick={p.onToggleAngleSnap}
          />
          <PopoverCheckRow
            checked={p.anarchyEnabled}
            warn={p.anarchyEnabled}
            title="Ignore rules (Anarchy)"
            subtitle="Allow overlap and sharp turns"
            onClick={p.onToggleAnarchy}
          />

          <hr className="my-1" style={{ borderColor: '#242832' }} />

          <div className="flex items-center justify-between px-2 py-1 text-[11px]">
            <button
              type="button"
              onClick={p.onToggleAutoIntersect}
              className="flex cursor-pointer items-center gap-1.5 hover:text-white"
              style={{ color: p.autoIntersect ? '#c4c8cf' : '#6b7280' }}
            >
              <i className={`fas ${p.autoIntersect ? 'fa-check-square text-[#3b82f6]' : 'fa-square text-[#4a4f58]'} text-[11px]`} />
              <span>Auto-intersect</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                p.onOpenMoreSettings();
              }}
              className="cursor-pointer text-[11px] hover:underline"
              style={{ color: '#8db8ff' }}
            >
              More settings...
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PopoverCheckRow({
  checked,
  warn,
  title,
  subtitle,
  rightControl,
  onClick,
}: {
  checked: boolean;
  warn?: boolean;
  title: string;
  subtitle: string;
  rightControl?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className="flex cursor-pointer items-start gap-2.5 rounded-[4px] px-2 py-1.5 hover:bg-[#1e222b]"
    >
      <span
        className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border text-[9px]"
        style={{
          backgroundColor: checked ? (warn ? '#eab308' : '#3b82f6') : 'transparent',
          borderColor: checked ? (warn ? '#eab308' : '#3b82f6') : '#4a4f58',
          color: checked && !warn ? '#ffffff' : '#0c0d0f',
        }}
      >
        {checked && <i className="fas fa-check" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium leading-tight" style={{ color: warn ? '#fde047' : '#e5e7eb' }}>
            {title}
          </span>
          {rightControl}
        </div>
        <div className="mt-0.5 text-[10px] leading-tight" style={{ color: '#8c919a' }}>
          {subtitle}
        </div>
      </div>
    </div>
  );
}
