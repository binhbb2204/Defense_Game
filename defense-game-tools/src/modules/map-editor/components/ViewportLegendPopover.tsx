export const LEGEND_ITEMS: Array<{
  color: string;
  shape: 'dot' | 'swatch';
  label: string;
  detail: string;
}> = [
  { color: '#22c55e', shape: 'dot', label: 'Spawn Node', detail: 'Enemy entry point' },
  { color: '#ef4444', shape: 'dot', label: 'Base Node', detail: 'Defense goal endpoint' },
  { color: '#eab308', shape: 'swatch', label: 'Bridge / Elevated', detail: 'Raised deck & pillars' },
  { color: '#8b5cf6', shape: 'swatch', label: 'Tunnel', detail: 'Concealed deck (blocks LoS)' },
  { color: '#ef4444', shape: 'swatch', label: 'Violation Highlight', detail: 'Grade >22% or tight radius' },
  { color: '#3b82f6', shape: 'swatch', label: 'Active Selection', detail: 'Selected node, road, or prop' },
  { color: '#38bdf8', shape: 'swatch', label: 'Multitool Preview', detail: 'Pending curve / parallel shape' },
];

/** Compact floating viewport legend popover triggered from the StatusBar Legend button. */
export function ViewportLegendPopover({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="absolute right-2 bottom-8 z-30 w-72 overflow-hidden rounded-[6px] border shadow-2xl"
      style={{
        backgroundColor: 'var(--bg-panel)',
        borderColor: 'var(--border-strong)',
        color: 'var(--text-primary)',
      }}
    >
      <div
        className="flex items-center justify-between border-b px-3 py-1.5 text-[11px] font-semibold"
        style={{ backgroundColor: 'var(--bg-header)', borderColor: 'var(--border-subtle)' }}
      >
        <span>Viewport Color Legend</span>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer px-1"
          style={{ color: 'var(--text-muted)' }}
        >
          <i className="fas fa-times text-[10px]" />
        </button>
      </div>
      <div className="space-y-1.5 p-2.5 text-[11px]">
        {LEGEND_ITEMS.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 shrink-0 ${item.shape === 'dot' ? 'rounded-full' : 'rounded-[2px]'}`}
                style={{ backgroundColor: item.color }}
              />
              <span className="font-medium">{item.label}</span>
            </div>
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {item.detail}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
