import type { TemplateMapPreview, TemplateMapSummary } from '../types';

const VIEW_W = 82;
const VIEW_H = 54;
const PAD = 8;

/**
 * Compact vector blueprint preview of a template map's road graph,
 * rendered on a subtle CAD grid with green Spawn and red Base endpoints.
 */
export function TemplateMiniPreview({
  preview,
  className = '',
}: {
  preview?: TemplateMapPreview;
  className?: string;
}) {
  const pts: Array<{ x: number; z: number }> = [];
  if (preview) {
    for (const n of preview.nodes) pts.push({ x: n.x, z: n.z });
    for (const e of preview.edges) {
      if (typeof e.cx === 'number' && typeof e.cz === 'number') {
        pts.push({ x: e.cx, z: e.cz });
      }
    }
  }

  let mapX = (_x: number) => VIEW_W * 0.5;
  let mapY = (_z: number) => VIEW_H * 0.5;

  if (pts.length > 0) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const rawSpanX = maxX - minX;
    const rawSpanZ = maxZ - minZ;

    if (rawSpanX > 1e-3 || rawSpanZ > 1e-3) {
      const spanX = Math.max(1e-3, rawSpanX);
      const spanZ = Math.max(1e-3, rawSpanZ);
      const scale = Math.min((VIEW_W - PAD * 2) / spanX, (VIEW_H - PAD * 2) / spanZ);
      const midX = (minX + maxX) * 0.5;
      const midZ = (minZ + maxZ) * 0.5;
      mapX = (x: number) => VIEW_W * 0.5 + (x - midX) * scale;
      mapY = (z: number) => VIEW_H * 0.5 + (z - midZ) * scale;
    }
  }

  const hasGeometry = preview && (preview.edges.length > 0 || preview.nodes.length > 0);

  return (
    <svg
      width={VIEW_W}
      height={VIEW_H}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className={`rounded-lg border border-white/10 bg-[#0b0d12] ${className}`}
      aria-hidden="true"
    >
      {/* Hairline 4x3 technical grid */}
      <g stroke="#171b24" strokeWidth={0.75}>
        <line x1={20.5} y1={0} x2={20.5} y2={VIEW_H} />
        <line x1={41} y1={0} x2={41} y2={VIEW_H} />
        <line x1={61.5} y1={0} x2={61.5} y2={VIEW_H} />
        <line x1={0} y1={13.5} x2={VIEW_W} y2={13.5} />
        <line x1={0} y1={27} x2={VIEW_W} y2={27} />
        <line x1={0} y1={40.5} x2={VIEW_W} y2={40.5} />
      </g>

      {!hasGeometry && (
        <g stroke="#2a313e" strokeWidth={1.1}>
          <line x1={VIEW_W * 0.5 - 6} y1={VIEW_H * 0.5} x2={VIEW_W * 0.5 + 6} y2={VIEW_H * 0.5} />
          <line x1={VIEW_W * 0.5} y1={VIEW_H * 0.5 - 6} x2={VIEW_W * 0.5} y2={VIEW_H * 0.5 + 6} />
        </g>
      )}

      {preview?.edges.map((e, i) => {
        const d =
          typeof e.cx === 'number' && typeof e.cz === 'number'
            ? `M ${mapX(e.x1).toFixed(1)} ${mapY(e.z1).toFixed(1)} Q ${mapX(e.cx).toFixed(1)} ${mapY(e.cz).toFixed(1)} ${mapX(e.x2).toFixed(1)} ${mapY(e.z2).toFixed(1)}`
            : `M ${mapX(e.x1).toFixed(1)} ${mapY(e.z1).toFixed(1)} L ${mapX(e.x2).toFixed(1)} ${mapY(e.z2).toFixed(1)}`;
        return (
          <path
            key={i}
            d={d}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}

      {preview?.nodes.map((n, i) =>
        n.role === 'spawn' || n.role === 'base' ? (
          <circle
            key={i}
            cx={mapX(n.x).toFixed(1)}
            cy={mapY(n.z).toFixed(1)}
            r={2.5}
            fill={n.role === 'spawn' ? '#4ade80' : '#fb7185'}
          />
        ) : null,
      )}
    </svg>
  );
}

/** Shared friendly template row used by WelcomeOverlay and TemplatePickerModal. */
export function TemplateListRow({
  template,
  subtitle,
  onSelect,
}: {
  template: TemplateMapSummary;
  subtitle?: string;
  onSelect: (templateId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(template.id)}
      className="group flex w-full cursor-pointer items-center gap-3.5 px-5 py-3.5 text-left transition-colors hover:bg-white/[0.04]"
    >
      <TemplateMiniPreview
        preview={template.preview}
        className="shrink-0 text-[#6e7b91] transition-colors group-hover:border-[#3b82f6]/60 group-hover:text-[#93c5fd]"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold text-[#eef1f6] group-hover:text-white">
          {template.name}
        </div>
        <div className="mt-0.5 truncate text-[12px] text-[#7c8598]">
          {subtitle ?? template.fileName}
        </div>
        <div className="mono-num mt-1 flex items-center gap-1.5 text-[11.5px] text-[#949db0]">
          <span>{template.nodeCount} nodes</span>
          <span className="text-[#404859]">·</span>
          <span>{template.segmentCount} segs</span>
          <span className="text-[#404859]">·</span>
          <span>{template.obstacleCount} props</span>
        </div>
      </div>
      <svg
        className="h-3.5 w-3.5 shrink-0 text-[#8b95a7] opacity-0 transition-opacity group-hover:opacity-100"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4.5 2.5 8 6 4.5 9.5" />
      </svg>
    </button>
  );
}
