import type React from 'react';

export function ModalFrame({
  title,
  icon,
  width,
  onClose,
  children,
}: {
  title: string;
  icon: string;
  width: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(10, 12, 16, 0.72)' }}
    >
      <div
        className={`flex max-h-[85vh] ${width} flex-col overflow-hidden`}
        style={{
          backgroundColor: 'var(--bg-panel)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text-primary)',
        }}
      >
        <div
          className="flex shrink-0 items-center justify-between border-b px-3.5 py-2.5"
          style={{ backgroundColor: 'var(--bg-header)', borderColor: 'var(--border-subtle)' }}
        >
          <h2 className="flex items-center gap-2 text-[13px] font-semibold">
            <i className={`fas ${icon} text-xs`} style={{ color: 'var(--accent)' }} />
            <span>{title}</span>
          </h2>
          <button type="button" onClick={onClose} className="dcc-btn">
            <i className="fas fa-times text-xs" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
