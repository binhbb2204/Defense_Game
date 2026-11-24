import type { EditorTool, ToolboxAssetChoice, ToolboxLayer } from '../types';

/** Inner Props & 3D Asset catalog content hosted inside LeftToolDrawer. */
export function ToolboxSidebar({
  toolboxLayer,
  importedCount,
  assetSearch,
  categoryFilter,
  categories,
  filteredCatalog,
  selectedAsset,
  activeTool,
  thumbs,
  onChangeLayer,
  onChangeSearch,
  onChangeCategory,
  onPickAsset,
}: {
  toolboxLayer: ToolboxLayer;
  importedCount: number;
  assetSearch: string;
  categoryFilter: string;
  categories: string[];
  filteredCatalog: ToolboxAssetChoice[];
  selectedAsset: ToolboxAssetChoice | null;
  activeTool: EditorTool;
  thumbs: Record<string, string>;
  onChangeLayer: (layer: ToolboxLayer) => void;
  onChangeSearch: (s: string) => void;
  onChangeCategory: (c: string) => void;
  onPickAsset: (item: ToolboxAssetChoice) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {importedCount > 0 && (
        <div
          className="flex shrink-0 border-b"
          style={{ backgroundColor: 'var(--bg-header)', borderColor: 'var(--border-subtle)' }}
        >
          <button
            type="button"
            onClick={() => {
              onChangeLayer('props');
              onChangeCategory('all');
            }}
            className={`dcc-tab flex-1 ${toolboxLayer === 'props' ? 'active' : ''}`}
          >
            Props
          </button>
          <button
            type="button"
            onClick={() => {
              onChangeLayer('imported');
              onChangeCategory('all');
            }}
            className={`dcc-tab flex-1 ${toolboxLayer === 'imported' ? 'active' : ''}`}
          >
            3D ({importedCount})
          </button>
        </div>
      )}

      <div className="space-y-1.5 border-b p-2" style={{ borderColor: 'var(--border-subtle)' }}>
        <input
          type="text"
          value={assetSearch}
          onChange={(e) => onChangeSearch(e.target.value)}
          placeholder="Filter props..."
          className="h-7 w-full rounded-[2px] border px-2 text-[11px] outline-none"
          style={{
            backgroundColor: 'var(--bg-input)',
            borderColor: 'var(--border-strong)',
            color: 'var(--text-primary)',
          }}
        />
        <select
          value={categoryFilter}
          onChange={(e) => onChangeCategory(e.target.value)}
          className="h-7 w-full rounded-[2px] border px-1.5 text-[11px] outline-none"
          style={{
            backgroundColor: 'var(--bg-input)',
            borderColor: 'var(--border-strong)',
            color: 'var(--text-primary)',
          }}
        >
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat === 'all' ? 'All Categories' : cat}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <div className="grid grid-cols-2 gap-1.5">
          {filteredCatalog.map((item) => {
            const selected = selectedAsset?.key === item.key && activeTool === 'place';
            const thumbSrc = thumbs[item.key];
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onPickAsset(item)}
                className="flex cursor-pointer flex-col overflow-hidden rounded-[4px] border text-left hover:border-[#353c4a]"
                style={{
                  backgroundColor: selected ? 'var(--accent-subtle)' : 'var(--bg-input)',
                  borderColor: selected ? 'var(--accent)' : 'var(--border-subtle)',
                }}
              >
                <div className="flex aspect-square w-full items-center justify-center p-1.5">
                  {thumbSrc ? (
                    <img src={thumbSrc} alt={item.label} className="h-full w-full object-contain" />
                  ) : (
                    <i className="fas fa-cube text-lg" style={{ color: 'var(--text-muted)' }} />
                  )}
                </div>
                <div
                  className="w-full border-t px-1.5 py-1 text-center text-[11px] font-medium"
                  style={{
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <div className="truncate">{item.label}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
