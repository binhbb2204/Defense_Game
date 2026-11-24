import type React from 'react';

export function TreeFolder({
  label,
  dotColor,
  rightText,
  open,
  onToggle,
}: {
  label: string;
  dotColor?: string;
  rightText?: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full cursor-pointer items-center justify-between py-1 pr-3 pl-3 text-left text-[12px] font-medium hover:bg-[#1a1d24]"
      style={{ color: '#d1d5db' }}
    >
      <span className="flex min-w-0 items-center gap-2">
        <i
          className={`fas ${open ? 'fa-caret-down' : 'fa-caret-right'} w-2.5 text-[10px]`}
          style={{ color: '#6b7280' }}
        />
        {dotColor && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: dotColor }} />}
        <span className="truncate">{label}</span>
      </span>
      {rightText && (
        <span className="mono-num ml-2 shrink-0 text-[10px]" style={{ color: '#8c919a' }}>
          {rightText}
        </span>
      )}
    </button>
  );
}

export function ExplorerLeafRow({
  indent,
  dotColor,
  icon,
  iconColor,
  label,
  rightBadge,
  rightBadgeColor,
  title,
  selected,
  hidden,
  locked,
  onClick,
  onDoubleClick,
  onToggleHidden,
  onToggleLocked,
  onDelete,
}: {
  indent: number;
  dotColor?: string;
  icon?: string;
  iconColor?: string;
  label: string;
  rightBadge?: string;
  rightBadgeColor?: string;
  title?: string;
  selected: boolean;
  hidden: boolean;
  locked: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onToggleHidden: () => void;
  onToggleLocked: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      title={title}
      className="group relative flex items-center py-1 pr-2.5 hover:bg-[#1a1d24]"
      style={{
        paddingLeft: `${indent * 4}px`,
        backgroundColor: selected ? '#18253f' : undefined,
        boxShadow: selected ? 'inset 2px 0 0 #3b82f6' : undefined,
        color: selected ? '#ffffff' : '#9aa0a9',
      }}
    >
      <button
        type="button"
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
      >
        {dotColor ? (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: dotColor }} />
        ) : (
          <i className={`fas ${icon ?? 'fa-circle'} shrink-0 text-[8px]`} style={{ color: iconColor ?? '#8c919a' }} />
        )}
        <span className="truncate text-[11.5px]">{label}</span>
      </button>

      {rightBadge && (
        <span
          className="mono-num ml-1.5 shrink-0 text-[10px] group-hover:hidden"
          style={{ color: rightBadgeColor ?? '#8c919a' }}
        >
          {rightBadge}
        </span>
      )}

      <div className="ml-1 hidden shrink-0 items-center gap-1 text-[10px] group-hover:flex" style={{ color: '#9aa0a9' }}>
        <button type="button" onClick={onToggleHidden} title="Toggle Visibility" className="cursor-pointer p-0.5 hover:text-white">
          <i className={`fas ${hidden ? 'fa-eye-slash' : 'fa-eye'}`} />
        </button>
        <button type="button" onClick={onToggleLocked} title="Toggle Lock" className="cursor-pointer p-0.5 hover:text-white">
          <i className={`fas ${locked ? 'fa-lock text-[#eab308]' : 'fa-lock-open'}`} />
        </button>
        <button type="button" onClick={onDelete} title="Delete (Del)" className="cursor-pointer p-0.5 hover:text-[#ef4444]">
          <i className="fas fa-trash-alt" />
        </button>
      </div>
    </div>
  );
}
