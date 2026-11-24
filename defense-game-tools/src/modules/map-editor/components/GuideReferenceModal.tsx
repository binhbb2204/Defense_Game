import { useEffect, useState } from 'react';
import { LEGEND_ITEMS } from './ViewportLegendPopover';

type GuideTab = 'workflow' | 'shortcuts' | 'legend';

const WORKFLOW_CARDS = [
  {
    icon: 'fa-road',
    title: '1. Road Graph & Auto-Branching',
    body: 'Draw roads freely with Draw Road (G). Clicking a midpoint on an existing road automatically splits it into a T/4-way junction. Right-click or press Esc to end a chain cleanly without leaving stray links.',
  },
  {
    icon: 'fa-bezier-curve',
    title: '2. Free Curve vs. Network Multitool (T)',
    body: 'Use Free Curve in Draw Road for single-segment curves (Start -> Handle -> End). Use Network Multitool (T) afterward to Smooth, Curve, Straighten, Reverse, Round corners, Connect two roads, or build Parallel lanes.',
  },
  {
    icon: 'fa-layer-group',
    title: '3. Elevation, Bridges, Tunnels & Anarchy',
    body: 'Adjust road height using PageUp / PageDown or [ / ] (or the toolbar Y +/- control). Switch to Bridge or Tunnel (tunnels conceal enemies from tower Line of Sight). Toggle Anarchy (Ctrl+A) to override steep grade and radius limits.',
  },
  {
    icon: 'fa-bullseye',
    title: '4. Spawn/Base Routes & LoS Testing',
    body: 'Enemy paths flow automatically from every green Spawn node to red Base nodes. Use LoS Probe (L) anywhere on the ground to inspect which road nodes a tower placed at that spot can see.',
  },
];

const SHORTCUT_GROUPS: Array<{ title: string; rows: Array<[string, string]> }> = [
  {
    title: 'Camera & Navigation',
    rows: [
      ['WASD / Q E', 'Move / fly camera (+Shift fast)'],
      ['Left-Drag', 'Pan camera across map'],
      ['Right-Drag', 'Orbit / rotate 3D angle'],
      ['Mouse Wheel', 'Zoom in / out'],
      ['F', 'Focus camera on selected object'],
      ['M', 'Toggle floating Minimap'],
    ],
  },
  {
    title: 'Tools',
    rows: [
      ['1 / 2 / 3 / 4', 'Select / Move / Rotate / Scale'],
      ['G', 'Draw Road tool'],
      ['T', 'Network Multitool (Shape)'],
      ['B', 'Props & Obstacles library'],
      ['X', 'Erase tool'],
      ['L', 'Line of Sight Probe'],
    ],
  },
  {
    title: 'Road Drawing & Multitool',
    rows: [
      ['1 / 2 / 3 (in Road)', 'Switch Straight / Curve / Free mode'],
      ['PgUp/Dn or [ / ]', 'Raise / lower road elevation (Home = 0m)'],
      ['U (in Road)', 'Toggle Road Width Upgrade click mode'],
      ['Shift (Free mode)', 'Force straight segment for click'],
      ['Right-Click / Esc', 'Finish active road chain cleanly'],
      ['Backspace', 'Step back Control -> Start -> Last segment'],
      ['Hold Alt', 'Temporarily disable road & tangent snap'],
      ['Ctrl+A', 'Toggle Anarchy bypass mode'],
      ['Enter', 'Apply Multitool preview or end chain'],
    ],
  },
  {
    title: 'Editing & File',
    rows: [
      ['R / Shift+R', 'Rotate prop by +15 / -15 deg'],
      ['Delete', 'Delete selected item (reconnects deg-2 nodes)'],
      ['Ctrl+Z / Ctrl+Y', 'Undo / Redo edit history'],
      ['Ctrl+S', 'Save map JSON and pack 3D assets'],
      ['Shift+G', 'Toggle Road Geometry debug lines'],
      ['F1', 'Open / close this Reference Guide'],
    ],
  },
];

/** Clean 3-tab Workflow, Keyboard Shortcuts, and Legend reference modal (`F1`). */
export function GuideReferenceModal({
  open,
  onClose,
  onRestartTutorial,
}: {
  open: boolean;
  onClose: () => void;
  onRestartTutorial: () => void;
}) {
  const [tab, setTab] = useState<GuideTab>('workflow');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(10, 12, 16, 0.72)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[84vh] w-[660px] max-w-full flex-col overflow-hidden rounded-[6px] border shadow-2xl"
        style={{
          backgroundColor: 'var(--bg-panel)',
          borderColor: 'var(--border-strong)',
          color: 'var(--text-primary)',
        }}
      >
        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between border-b px-4 py-2.5"
          style={{ backgroundColor: 'var(--bg-header)', borderColor: 'var(--border-subtle)' }}
        >
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <i className="fas fa-book text-xs" style={{ color: 'var(--accent)' }} />
            <span>Map Studio Reference Guide</span>
          </div>
          <button type="button" onClick={onClose} className="dcc-btn !min-h-[24px] px-2">
            <i className="fas fa-times text-xs" />
          </button>
        </div>

        {/* Tabs */}
        <div
          className="flex shrink-0 border-b px-2"
          style={{ backgroundColor: 'var(--bg-header)', borderColor: 'var(--border-subtle)' }}
        >
          {(
            [
              { id: 'workflow', label: 'Workflow Overview' },
              { id: 'shortcuts', label: 'Controls & Shortcuts' },
              { id: 'legend', label: 'Viewport Legend' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`dcc-tab ${tab === t.id ? 'active' : ''}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 text-xs">
          {tab === 'workflow' && (
            <div className="grid gap-3 sm:grid-cols-2">
              {WORKFLOW_CARDS.map((c) => (
                <div
                  key={c.title}
                  className="space-y-1.5 rounded-[4px] border p-3"
                  style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-2 text-[12px] font-semibold">
                    <i className={`fas ${c.icon} text-[11px]`} style={{ color: 'var(--accent)' }} />
                    <span>{c.title}</span>
                  </div>
                  <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    {c.body}
                  </p>
                </div>
              ))}
            </div>
          )}

          {tab === 'shortcuts' && (
            <div className="grid gap-4 sm:grid-cols-2">
              {SHORTCUT_GROUPS.map((group) => (
                <div key={group.title} className="space-y-1.5">
                  <div className="dcc-section-title">{group.title}</div>
                  <div
                    className="divide-y rounded-[4px] border"
                    style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}
                  >
                    {group.rows.map(([keys, desc]) => (
                      <div
                        key={keys}
                        className="flex items-center justify-between gap-2 px-2.5 py-1.5"
                        style={{ borderColor: 'var(--border-subtle)' }}
                      >
                        <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                          {desc}
                        </span>
                        <span className="dcc-kbd shrink-0">{keys}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'legend' && (
            <div
              className="divide-y rounded-[4px] border"
              style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}
            >
              {LEGEND_ITEMS.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between px-3 py-2"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`h-3 w-3 shrink-0 ${item.shape === 'dot' ? 'rounded-full' : 'rounded-[2px]'}`}
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="font-medium">{item.label}</span>
                  </div>
                  <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                    {item.detail}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex shrink-0 items-center justify-between border-t px-4 py-2"
          style={{ backgroundColor: 'var(--bg-header)', borderColor: 'var(--border-subtle)' }}
        >
          <button
            type="button"
            onClick={() => {
              onClose();
              onRestartTutorial();
            }}
            className="dcc-btn text-[11px]"
            style={{ border: '1px solid var(--border-strong)' }}
          >
            <i className="fas fa-graduation-cap text-[11px]" />
            <span>Restart Interactive Tutorial</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-[4px] px-3 py-1 text-[11px] font-semibold text-white"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            Close (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}
