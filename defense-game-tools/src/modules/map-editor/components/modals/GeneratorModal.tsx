import { DSA_ALGORITHMS, type DsaMapAlgorithm } from '../../generators';
import { ModalFrame } from './ModalFrame';

interface GeneratorModalProps {
  open: boolean;
  algorithm: DsaMapAlgorithm;
  seed: number;
  density: number;
  gridW: number;
  gridD: number;
  onChangeAlgorithm: (alg: DsaMapAlgorithm) => void;
  onChangeSeed: (seed: number) => void;
  onChangeDensity: (density: number) => void;
  onChangeGridW: (w: number) => void;
  onChangeGridD: (d: number) => void;
  onRandomizeAll: () => void;
  onGenerate: () => void;
  onClose: () => void;
}

export function GeneratorModal({
  open,
  algorithm,
  seed,
  density,
  gridW,
  gridD,
  onChangeAlgorithm,
  onChangeSeed,
  onChangeDensity,
  onChangeGridW,
  onChangeGridD,
  onRandomizeAll,
  onGenerate,
  onClose,
}: GeneratorModalProps) {
  if (!open) return null;

  return (
    <ModalFrame title="Procedural DSA Generator" icon="fa-magic" onClose={onClose} width="w-[500px]">
      <div className="flex-1 space-y-3 overflow-y-auto p-4 text-xs">
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            Algorithm
          </div>
          <div className="space-y-1">
            {DSA_ALGORITHMS.map((alg) => {
              const selected = algorithm === alg.id;
              return (
                <button
                  key={alg.id}
                  type="button"
                  onClick={() => onChangeAlgorithm(alg.id)}
                  className="w-full cursor-pointer rounded-[2px] border p-2.5 text-left"
                  style={{
                    backgroundColor: selected ? 'var(--accent-subtle)' : 'var(--bg-input)',
                    borderColor: selected ? 'var(--accent)' : 'var(--border-subtle)',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{alg.label}</span>
                    <span className="mono-num text-[10px]" style={{ color: 'var(--accent)' }}>
                      {alg.complexity}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                    {alg.summary}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5 border-t pt-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center justify-between">
            <span>Cover &amp; Platform Density</span>
            <span className="mono-num" style={{ color: 'var(--accent)' }}>
              {Math.round(density * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.1}
            value={density}
            onChange={(e) => onChangeDensity(Number(e.target.value))}
            className="w-full accent-[#3b82f6]"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 border-t pt-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
          <div>
            <label className="mb-1 block" style={{ color: 'var(--text-secondary)' }}>
              Arena Bounds (m)
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={40}
                max={200}
                value={gridW}
                onChange={(e) => onChangeGridW(Math.max(40, Number(e.target.value) || 80))}
                className="mono-num h-7 w-16 rounded-[2px] border text-center outline-none"
                style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-strong)' }}
              />
              <span>x</span>
              <input
                type="number"
                min={40}
                max={200}
                value={gridD}
                onChange={(e) => onChangeGridD(Math.max(40, Number(e.target.value) || 60))}
                className="mono-num h-7 w-16 rounded-[2px] border text-center outline-none"
                style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-strong)' }}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block" style={{ color: 'var(--text-secondary)' }}>
              World Seed
            </label>
            <div className="flex gap-1.5">
              <input
                type="number"
                value={seed}
                onChange={(e) => onChangeSeed(Number(e.target.value) || 1)}
                className="mono-num h-7 flex-1 rounded-[2px] border px-2 outline-none"
                style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-strong)' }}
              />
              <button
                type="button"
                onClick={() => onChangeSeed(Math.floor(Math.random() * 99999))}
                className="dcc-btn"
                style={{ border: '1px solid var(--border-strong)' }}
                title="Randomize Seed"
              >
                <i className="fas fa-dice" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        className="flex items-center justify-end gap-2 border-t p-3 text-xs"
        style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-header)' }}
      >
        <button
          type="button"
          onClick={onRandomizeAll}
          className="dcc-btn mr-auto"
          style={{ border: '1px solid var(--border-strong)' }}
        >
          Randomize
        </button>
        <button type="button" onClick={onClose} className="dcc-btn">
          Cancel
        </button>
        <button
          type="button"
          onClick={onGenerate}
          className="cursor-pointer rounded-[4px] px-3.5 py-1.5 text-xs font-medium text-white"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          Generate Map
        </button>
      </div>
    </ModalFrame>
  );
}
