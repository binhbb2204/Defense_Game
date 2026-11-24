import type { EditorTool } from '../types';

export interface ViewportOverlaysProps {
  activeTool: EditorTool;
  losMode: boolean;
  losProbe: { visible: number; blocked: number } | null;
  onSnapView: (mode: 'top' | 'iso') => void;
}

/**
 * Minimal viewport corner HUD: optional LoS status badge and bottom-right Top/Iso camera preset switcher.
 */
export function ViewportOverlays(p: ViewportOverlaysProps) {
  return (
    <>
      {(p.losMode || p.losProbe) && (
        <div className="pointer-events-none absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2">
          {p.losMode && (
            <div
              className="flex items-center gap-2 rounded-[5px] border px-3 py-1 text-[11px] shadow-lg"
              style={{
                backgroundColor: '#14171d',
                borderColor: 'var(--accent)',
                color: '#e5e7eb',
              }}
            >
              <span className="font-medium text-[#8db8ff]">LoS Probe</span>
              <span>Click ground or road to test visibility</span>
              <span className="dcc-kbd">L</span>
            </div>
          )}
          {p.losProbe && (
            <div
              className="mono-num rounded-[5px] border px-2.5 py-1 text-[11px] font-medium shadow-lg"
              style={{
                backgroundColor: '#14171d',
                borderColor: '#2a2f3a',
                color: '#e5e7eb',
              }}
            >
              LoS Visible: {p.losProbe.visible} / {p.losProbe.visible + p.losProbe.blocked}
            </div>
          )}
        </div>
      )}

      {/* Bottom-Right View Switcher (Top | Iso) */}
      <div
        className="absolute right-3 bottom-3 z-10 flex items-center gap-0.5 rounded-[6px] border p-0.5 shadow-lg"
        style={{ backgroundColor: '#14171d', borderColor: '#2a2f3a' }}
        title="Camera: Left-drag Pan | Right-drag Orbit | Wheel Zoom"
      >
        <button
          type="button"
          onClick={() => p.onSnapView('top')}
          className="cursor-pointer rounded-[4px] px-2.5 py-1 text-[11px] font-medium text-[#9aa0a9] hover:bg-[#222630] hover:text-white"
        >
          Top
        </button>
        <button
          type="button"
          onClick={() => p.onSnapView('iso')}
          className="cursor-pointer rounded-[4px] bg-[#252932] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#2c313c]"
        >
          Iso
        </button>
      </div>
    </>
  );
}
