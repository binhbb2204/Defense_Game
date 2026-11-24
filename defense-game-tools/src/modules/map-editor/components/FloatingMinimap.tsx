export function FloatingMinimap({
  open,
  pos,
  canvasRef,
  onMove,
  onClose,
}: {
  open: boolean;
  pos: { x: number; y: number };
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onMove: (next: { x: number; y: number }) => void;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div
      style={{
        width: 240,
        height: 204,
        left: pos.x,
        top: pos.y,
        backgroundColor: 'var(--bg-panel)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-md)',
      }}
      className="fixed z-50 flex flex-col overflow-hidden"
    >
      <div
        onMouseDown={(e) => {
          const sx = e.clientX - pos.x;
          const sy = e.clientY - pos.y;
          const onDrag = (ev: MouseEvent) =>
            onMove({ x: Math.max(0, ev.clientX - sx), y: Math.max(0, ev.clientY - sy) });
          const onUp = () => {
            window.removeEventListener('mousemove', onDrag);
            window.removeEventListener('mouseup', onUp);
          };
          window.addEventListener('mousemove', onDrag);
          window.addEventListener('mouseup', onUp);
        }}
        className="flex h-7 cursor-move items-center justify-between border-b px-2.5 text-[11px] font-medium select-none"
        style={{ backgroundColor: 'var(--bg-header)', borderColor: 'var(--border-subtle)' }}
      >
        <span>Minimap (M)</span>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer px-1"
          style={{ color: 'var(--text-muted)' }}
        >
          <i className="fas fa-times text-[10px]" />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center p-1" style={{ backgroundColor: 'var(--bg-input)' }}>
        <canvas ref={canvasRef} width={228} height={164} className="h-full w-full object-contain" />
      </div>
    </div>
  );
}
