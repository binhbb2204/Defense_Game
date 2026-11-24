import { useState } from 'react';
import { ModalFrame } from './ModalFrame';

export function SaveAsModal({
  open,
  initialId,
  initialName,
  onConfirm,
  onClose,
}: {
  open: boolean;
  initialId: string;
  initialName: string;
  onConfirm: (id: string, name: string) => void;
  onClose: () => void;
}) {
  const [idVal, setIdVal] = useState(initialId || 'custom_map');
  const [nameVal, setNameVal] = useState(initialName || 'Custom Map');
  if (!open) return null;

  return (
    <ModalFrame title="Save Map As..." icon="fa-save" onClose={onClose} width="w-[360px]">
      <div className="space-y-3 p-4 text-xs">
        <div>
          <label className="mb-1 block" style={{ color: 'var(--text-secondary)' }}>
            Map ID (filename)
          </label>
          <input
            type="text"
            value={idVal}
            onChange={(e) => setIdVal(e.target.value)}
            className="mono-num h-7 w-full rounded-[2px] border px-2 outline-none"
            style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-strong)' }}
          />
        </div>
        <div>
          <label className="mb-1 block" style={{ color: 'var(--text-secondary)' }}>
            Display Name
          </label>
          <input
            type="text"
            value={nameVal}
            onChange={(e) => setNameVal(e.target.value)}
            className="h-7 w-full rounded-[2px] border px-2 outline-none"
            style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-strong)' }}
          />
        </div>
      </div>

      <div
        className="flex justify-end gap-2 border-t p-3 text-xs"
        style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-header)' }}
      >
        <button type="button" onClick={onClose} className="dcc-btn">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onConfirm(idVal.trim() || 'custom_map', nameVal.trim() || 'Custom Map')}
          className="cursor-pointer rounded-[4px] px-3.5 py-1.5 font-medium text-white"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          Save As
        </button>
      </div>
    </ModalFrame>
  );
}
