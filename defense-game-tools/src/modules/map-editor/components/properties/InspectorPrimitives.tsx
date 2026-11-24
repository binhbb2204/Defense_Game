import { useState } from 'react';
import type { Vec3 } from '@tactical-td/shared';
import type { CustomPropValue } from '../../types';

export function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div
      className="flex items-center justify-between gap-2 pb-1.5"
      style={{ color: '#ffffff' }}
    >
      <span className="truncate text-[12px] font-semibold">{title}</span>
      {subtitle && (
        <span
          className="mono-num shrink-0 truncate text-[10.5px]"
          style={{ color: '#8c919a' }}
          title={subtitle}
        >
          {subtitle}
        </span>
      )}
    </div>
  );
}

/** Boxed inline axis inputs (`X / Y / Z`) matching clean native desktop inspectors. */
export function Vec3InputRow({
  label,
  value,
  step = 0.5,
  onChange,
}: {
  label: string;
  value: Vec3;
  step?: number;
  onChange: (next: Vec3) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="dcc-section-title">{label} (M)</div>
      <div className="grid grid-cols-3 gap-1.5">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <label
            key={axis}
            className="flex items-center rounded-[4px] border px-1.5 py-1"
            style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}
          >
            <span className="mr-1 text-[10px] font-medium uppercase" style={{ color: '#6b7280' }}>
              {axis}
            </span>
            <input
              type="number"
              step={step}
              value={value[axis]}
              onChange={(e) => onChange({ ...value, [axis]: Number(e.target.value) || 0 })}
              className="mono-num min-w-0 flex-1 bg-transparent text-right text-[11px] outline-none"
              style={{ color: 'var(--text-primary)' }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

export function CustomAttributesEditor({
  customProps,
  onChange,
}: {
  customProps: Record<string, CustomPropValue>;
  onChange: (next: Record<string, CustomPropValue>) => void;
}) {
  const [newPropKey, setNewPropKey] = useState('');
  const [newPropType, setNewPropType] = useState<'string' | 'number' | 'boolean'>('string');
  const [newPropVal, setNewPropVal] = useState('');

  return (
    <>
      <SectionHeader title="Custom Attributes" />
      {Object.entries(customProps).map(([k, v]) => (
        <div key={k} className="prop-row">
          <div className="prop-name">{k}</div>
          <div className="prop-value flex items-center gap-1">
            {typeof v === 'boolean' ? (
              <input
                type="checkbox"
                checked={v}
                onChange={(e) => onChange({ ...customProps, [k]: e.target.checked })}
              />
            ) : (
              <input
                type={typeof v === 'number' ? 'number' : 'text'}
                value={String(v)}
                onChange={(e) =>
                  onChange({
                    ...customProps,
                    [k]: typeof v === 'number' ? Number(e.target.value) || 0 : e.target.value,
                  })
                }
              />
            )}
            <button
              type="button"
              onClick={() => {
                const next = { ...customProps };
                delete next[k];
                onChange(next);
              }}
              className="cursor-pointer px-1 text-[#ef4444]"
            >
              <i className="fas fa-times text-[10px]" />
            </button>
          </div>
        </div>
      ))}

      <div className="flex gap-1 pt-0.5">
        <input
          type="text"
          value={newPropKey}
          onChange={(e) => setNewPropKey(e.target.value)}
          placeholder="key"
          className="h-6 w-1/3 rounded-[2px] border px-1 text-[11px]"
          style={{
            backgroundColor: 'var(--bg-input)',
            borderColor: 'var(--border-strong)',
          }}
        />
        <select
          value={newPropType}
          onChange={(e) => setNewPropType(e.target.value as 'string' | 'number' | 'boolean')}
          className="h-6 w-1/4 rounded-[2px] border px-1 text-[11px]"
          style={{
            backgroundColor: 'var(--bg-input)',
            borderColor: 'var(--border-strong)',
          }}
        >
          <option value="string">str</option>
          <option value="number">num</option>
          <option value="boolean">bool</option>
        </select>
        <input
          type="text"
          value={newPropVal}
          onChange={(e) => setNewPropVal(e.target.value)}
          placeholder="val"
          className="h-6 flex-1 rounded-[2px] border px-1 text-[11px]"
          style={{
            backgroundColor: 'var(--bg-input)',
            borderColor: 'var(--border-strong)',
          }}
        />
        <button
          type="button"
          onClick={() => {
            const k = newPropKey.trim();
            if (!k) return;
            const parsed: CustomPropValue =
              newPropType === 'number'
                ? Number(newPropVal) || 0
                : newPropType === 'boolean'
                  ? newPropVal.toLowerCase() === 'true' || newPropVal === '1'
                  : newPropVal;
            onChange({ ...customProps, [k]: parsed });
            setNewPropKey('');
            setNewPropVal('');
          }}
          className="cursor-pointer rounded-[2px] px-2 text-[11px] font-medium text-white"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          Add
        </button>
      </div>
    </>
  );
}
