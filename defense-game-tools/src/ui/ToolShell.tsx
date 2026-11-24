import { useState, type ReactNode } from 'react';
import { ShellHeaderContext } from './ShellHeaderContext';

export type ToolTabId = 'map-editor' | 'wave-designer' | 'tower-lab' | 'balance-sim';

export interface ToolTabInfo {
  id: ToolTabId;
  label: string;
  targetFile: string;
  hint: string;
}

export const TOOL_TABS: ToolTabInfo[] = [
  {
    id: 'map-editor',
    label: 'Map Studio',
    targetFile: 'packages/shared/maps/untitled_map.json',
    hint: 'Left-drag pan | Right-drag orbit | Wheel zoom | G Road tool | S Multitool | B Props | M Minimap',
  },
  {
    id: 'wave-designer',
    label: 'Wave Designer',
    targetFile: 'packages/shared/waves/highway_01.json',
    hint: 'Adjust spawn count, interval, and start delay for each wave group.',
  },
  {
    id: 'tower-lab',
    label: 'Tower Lab',
    targetFile: 'packages/shared/towers/*.json',
    hint: 'Preview turret yaw rotation speed (rad/s), muzzle position, and range rings.',
  },
  {
    id: 'balance-sim',
    label: 'Balance Sim',
    targetFile: 'Headless 60Hz DPS vs Wave Sim',
    hint: 'Simulate your defense squad against every wave at 60Hz.',
  },
];

interface ToolShellProps {
  activeTab: ToolTabId;
  currentMapId?: string;
  onSelectTab: (tab: ToolTabId) => void;
  toast: { type: 'ok' | 'err'; text: string } | null;
  children: ReactNode;
}

/**
 * Minimal native-desktop top bar without branding/app-title clutter.
 * Hosts File/Edit/View portal slots on left, flat underline module tabs, and action portal slots on right.
 */
export function ToolShell({ activeTab, currentMapId: _currentMapId, onSelectTab, toast, children }: ToolShellProps) {
  const [leftSlot, setLeftSlot] = useState<HTMLDivElement | null>(null);
  const [rightSlot, setRightSlot] = useState<HTMLDivElement | null>(null);

  return (
    <ShellHeaderContext.Provider value={{ leftSlot, rightSlot }}>
      <div
        className="flex h-screen w-screen flex-col overflow-hidden select-none"
        style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-primary)' }}
      >
        <header
          className="z-40 flex h-11 shrink-0 items-center justify-between border-b px-3.5 text-[13px]"
          style={{
            backgroundColor: 'var(--bg-panel)',
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-secondary)',
          }}
        >
          <div className="flex h-full items-center gap-1.5">
            <div ref={setLeftSlot} className="flex items-center" />
            <nav className="flex h-full items-center gap-1">
              {TOOL_TABS.map((tab) => {
                const active = tab.id === activeTab;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => onSelectTab(tab.id)}
                    title={tab.hint}
                    className="relative flex cursor-pointer items-center rounded-lg px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors hover:bg-white/[0.05]"
                    style={{
                      color: active ? '#ffffff' : '#949db0',
                    }}
                  >
                    <span>{tab.label}</span>
                    {active && (
                      <span
                        className="absolute right-2 -bottom-[5px] left-2 h-[2.5px] rounded-full"
                        style={{ backgroundColor: 'var(--accent)' }}
                      />
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2.5">
            {toast && (
              <span
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-[12px] font-medium"
                style={{
                  backgroundColor: toast.type === 'ok' ? '#16261e' : '#28171b',
                  borderColor: toast.type === 'ok' ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)',
                  color: toast.type === 'ok' ? '#86efac' : '#fca5a5',
                }}
              >
                {toast.type === 'ok' ? (
                  <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="6" cy="6" r="4.75" />
                    <path d="m4 6.2 1.3 1.3 2.7-2.8" />
                  </svg>
                ) : (
                  <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 1.5 11 10H1L6 1.5Z" />
                    <path d="M6 4.75v2.25M6 8.5h.01" />
                  </svg>
                )}
                <span>{toast.text}</span>
              </span>
            )}
            <div ref={setRightSlot} className="flex items-center gap-2" />
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </ShellHeaderContext.Provider>
  );
}
