import { useState } from 'react';
import { ModalFrame } from './ModalFrame';

interface PreferencesModalProps {
  open: boolean;
  boundsW: number;
  boundsD: number;
  snapRadius: number;
  onChangeSnapRadius: (r: number) => void;
  onApplyBounds: (w: number, d: number) => void;
  onClose: () => void;
}

export function PreferencesModal({
  open,
  boundsW,
  boundsD,
  snapRadius,
  onChangeSnapRadius,
  onApplyBounds,
  onClose,
}: PreferencesModalProps) {
  const [wVal, setWVal] = useState(boundsW);
  const [dVal, setDVal] = useState(boundsD);
  if (!open) return null;

  return (
    <ModalFrame title="Studio Preferences" icon="fa-sliders-h" onClose={onClose} width="w-[380px]">
      <div className="space-y-3 p-4 text-xs">
        <div>
          <label className="mb-1 block" style={{ color: 'var(--text-secondary)' }}>
            Arena Dimensions (W x D meters)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={20}
              max={240}
              value={wVal}
              onChange={(e) => setWVal(Math.max(20, Number(e.target.value) || boundsW))}
              className="mono-num h-7 w-20 rounded-[2px] border text-center outline-none"
              style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-strong)' }}
            />
            <span>x</span>
            <input
              type="number"
              min={20}
              max={240}
              value={dVal}
              onChange={(e) => setDVal(Math.max(20, Number(e.target.value) || boundsD))}
              className="mono-num h-7 w-20 rounded-[2px] border text-center outline-none"
              style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-strong)' }}
            />
            <button
              type="button"
              onClick={() => onApplyBounds(wVal, dVal)}
              className="dcc-btn active ml-auto"
            >
              Apply
            </button>
          </div>
        </div>

        <div>
          <label className="mb-1 block" style={{ color: 'var(--text-secondary)' }}>
            Road Snap Radius (meters)
          </label>
          <input
            type="number"
            min={1}
            max={8}
            step={0.5}
            value={snapRadius}
            onChange={(e) => onChangeSnapRadius(Math.max(1, Number(e.target.value) || 2.5))}
            className="mono-num h-7 w-24 rounded-[2px] border px-2 outline-none"
            style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-strong)' }}
          />
        </div>
      </div>

      <div
        className="flex justify-end border-t p-3"
        style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-header)' }}
      >
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded-[4px] px-4 py-1.5 text-xs font-medium text-white"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          Done
        </button>
      </div>
    </ModalFrame>
  );
}
