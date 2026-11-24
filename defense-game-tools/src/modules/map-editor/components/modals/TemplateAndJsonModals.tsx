import type { MapDefinition } from '@tactical-td/shared';
import type { TemplateMapSummary } from '../../types';
import { TemplateListRow } from '../TemplateMiniPreview';
import { ModalFrame } from './ModalFrame';

export function JsonExportModal({
  open,
  map,
  onCopy,
  onDownloadGlb,
  onClose,
}: {
  open: boolean;
  map: MapDefinition;
  onCopy: () => void;
  onDownloadGlb: () => void;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <ModalFrame
      title={`Map JSON (${map.id || 'untitled_map'}.json)`}
      icon="fa-code"
      onClose={onClose}
      width="w-[620px]"
    >
      <div className="flex-1 overflow-hidden p-3">
        <textarea
          readOnly
          value={JSON.stringify(map, null, 2)}
          className="mono-num h-80 w-full resize-none rounded-[2px] border p-2.5 text-[11px] outline-none select-text"
          style={{
            backgroundColor: 'var(--bg-input)',
            borderColor: 'var(--border-subtle)',
            color: '#a7f3d0',
          }}
        />
      </div>
      <div
        className="flex items-center justify-end gap-2 border-t p-3 text-xs"
        style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-header)' }}
      >
        <button
          type="button"
          onClick={onDownloadGlb}
          className="dcc-btn"
          style={{ border: '1px solid var(--border-strong)' }}
        >
          <i className="fas fa-cubes text-[11px]" />
          <span>Export .glb</span>
        </button>
        <button
          type="button"
          onClick={onCopy}
          className="cursor-pointer rounded-[4px] px-3 py-1.5 text-xs font-medium text-white"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          Copy JSON
        </button>
      </div>
    </ModalFrame>
  );
}

export function TemplatePickerModal({
  open,
  templates,
  onSelectTemplate,
  onClose,
}: {
  open: boolean;
  templates: TemplateMapSummary[];
  onSelectTemplate: (templateId: string) => void;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <ModalFrame title="New from Template" icon="fa-layer-group" onClose={onClose} width="w-[540px]">
      <div className="flex-1 divide-y divide-white/[0.06] overflow-y-auto text-[13px]">
        {templates.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13px] text-[#6b7485]">
            No templates in packages/shared/maps
          </div>
        ) : (
          templates.map((tpl) => (
            <TemplateListRow
              key={tpl.id}
              template={tpl}
              subtitle={`packages/shared/maps/${tpl.fileName}`}
              onSelect={onSelectTemplate}
            />
          ))
        )}
      </div>
    </ModalFrame>
  );
}
