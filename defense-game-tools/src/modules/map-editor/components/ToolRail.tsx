import type { EditorTool } from '../types';

export interface ToolRailProps {
  activeTool: EditorTool;
  losMode: boolean;
  showFloatingMinimap: boolean;
  leftDrawerOpen: boolean;
  onSelectTool: (t: EditorTool) => void;
  onToggleLos: () => void;
  onToggleMinimap: () => void;
  onToggleDrawer: () => void;
  onOpenGuide: () => void;
}

/**
 * Minimal 44px monochrome CAD tool rail with thin 1.5px stroke SVGs and solid blue active tile.
 */
export function ToolRail({
  activeTool,
  losMode,
  showFloatingMinimap,
  leftDrawerOpen,
  onSelectTool,
  onToggleLos,
  onToggleMinimap,
  onToggleDrawer,
  onOpenGuide,
}: ToolRailProps) {
  return (
    <nav
      aria-label="Map Studio Tools"
      className="z-20 flex w-11 shrink-0 flex-col items-center gap-1 border-r py-2"
      style={{
        backgroundColor: 'var(--bg-panel)',
        borderColor: 'var(--border-subtle)',
      }}
    >
      <RailBtn shortcut="1" label="Select (1)" active={activeTool === 't-select'} onClick={() => onSelectTool('t-select')}>
        <path d="M5 3l13 7-6 2-2 6z" />
      </RailBtn>
      <RailBtn shortcut="2" label="Move (2)" active={activeTool === 't-move'} onClick={() => onSelectTool('t-move')}>
        <path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
      </RailBtn>
      <RailBtn shortcut="3" label="Rotate (3)" active={activeTool === 't-rotate'} onClick={() => onSelectTool('t-rotate')}>
        <path d="M20 12a8 8 0 1 1-3-6.2M20 4v5h-5" />
      </RailBtn>
      <RailBtn shortcut="4" label="Scale (4)" active={activeTool === 't-scale'} onClick={() => onSelectTool('t-scale')}>
        <path d="M4 20L20 4M14 4h6v6M10 20H4v-6" />
      </RailBtn>

      <div className="my-1 h-[1px] w-6" style={{ backgroundColor: 'var(--border-subtle)' }} />

      <RailBtn shortcut="G" label="Road Tool (G)" active={activeTool === 'road'} onClick={() => onSelectTool('road')}>
        <path d="M6 21L10 3M18 21L14 3M12 5v3M12 11v3M12 17v3" />
      </RailBtn>
      <RailBtn shortcut="T" label="Network Multitool (T)" active={activeTool === 'shape'} onClick={() => onSelectTool('shape')}>
        <path d="M3 19c6 0 4-14 9-14s3 14 9 14" />
        <circle cx="3" cy="19" r="1.4" />
        <circle cx="21" cy="19" r="1.4" />
      </RailBtn>
      <RailBtn shortcut="B" label="Props Library (B)" active={activeTool === 'place'} onClick={() => onSelectTool('place')}>
        <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5" />
      </RailBtn>
      <RailBtn shortcut="X" label="Erase (X)" active={activeTool === 'erase'} onClick={() => onSelectTool('erase')}>
        <path d="M4 20h16M7 16L16 6l4 4-7 8H8z" />
      </RailBtn>

      <div className="my-1 h-[1px] w-6" style={{ backgroundColor: 'var(--border-subtle)' }} />

      <RailBtn shortcut="L" label="LoS Probe (L)" active={losMode} onClick={onToggleLos}>
        <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="2.5" />
      </RailBtn>
      <RailBtn shortcut="M" label="Minimap (M)" active={showFloatingMinimap} onClick={onToggleMinimap}>
        <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14" />
      </RailBtn>

      <div className="flex-1" />

      <RailBtn label={leftDrawerOpen ? 'Hide Drawer' : 'Open Tool Drawer'} active={leftDrawerOpen} onClick={onToggleDrawer}>
        <path d="M4 5h16v14H4zM9 5v14" />
      </RailBtn>
      <RailBtn shortcut="F1" label="Reference & Shortcuts (F1)" active={false} onClick={onOpenGuide}>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.5a2.5 2.5 0 0 1 5 .5c0 1.8-2.5 2-2.5 3.5M12 17h.01" />
      </RailBtn>
    </nav>
  );
}

function RailBtn({
  shortcut,
  label,
  active,
  onClick,
  children,
}: {
  shortcut?: string;
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`dcc-rail-btn ${active ? 'active' : ''}`}
    >
      <svg
        className="h-[17px] w-[17px] fill-none stroke-current"
        viewBox="0 0 24 24"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
      {shortcut && <span className="dcc-rail-key">{shortcut}</span>}
    </button>
  );
}
