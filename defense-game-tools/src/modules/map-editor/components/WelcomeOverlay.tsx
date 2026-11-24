import { useEffect } from 'react';
import type { TemplateMapSummary } from '../types';
import { TemplateListRow } from './TemplateMiniPreview';

interface WelcomeOverlayProps {
  open: boolean;
  templates: TemplateMapSummary[];
  onNewEmpty: () => void;
  onStartTutorial: () => void;
  onLoadTemplate: (templateId: string) => void;
  onOpenJson: () => void;
  onDismiss: () => void;
}

/**
 * Clean 2-column friendly studio startup window displayed over an empty canvas,
 * pairing quick scene creation actions on the left with vector-previewed templates on the right.
 */
export function WelcomeOverlay({
  open,
  templates,
  onNewEmpty,
  onStartTutorial,
  onLoadTemplate,
  onOpenJson,
  onDismiss,
}: WelcomeOverlayProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onDismiss]);

  if (!open) return null;

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center p-5"
      style={{ backgroundColor: 'rgba(8, 10, 14, 0.72)', backdropFilter: 'blur(3px)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New scene"
        className="flex w-[700px] max-w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#14171f] text-[#eef1f6] shadow-[0_28px_80px_rgba(0,0,0,0.65)] sm:flex-row"
      >
        {/* Left Action Sidebar */}
        <div className="flex shrink-0 flex-col justify-between border-b border-white/[0.08] bg-[#10131a] p-5 sm:w-[252px] sm:border-r sm:border-b-0">
          <div>
            <h2 className="text-[16px] font-semibold tracking-[-0.015em] text-white">
              New scene
            </h2>
            <p className="mt-1 text-[12.5px] text-[#8b95a7]">Empty 3D canvas ready.</p>

            <div className="mt-5 space-y-1.5">
              <button
                type="button"
                onClick={onNewEmpty}
                className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg bg-[#2563eb] px-3 text-[13px] font-medium text-white transition-colors hover:bg-[#1d4ed8]"
              >
                <svg className="h-4 w-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                  <path d="M8 3.25v9.5M3.25 8h9.5" />
                </svg>
                <span>New Blank Map</span>
              </button>

              <button
                type="button"
                onClick={onOpenJson}
                className="flex h-9 w-full cursor-pointer items-center justify-between rounded-lg px-3 text-[13px] font-medium text-[#d1d6e0] transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                <span className="flex items-center gap-2">
                  <svg className="h-4 w-4 shrink-0 text-[#8b95a7]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2.25 4.25A1.25 1.25 0 0 1 3.5 3h3l1.4 1.5h4.6a1.25 1.25 0 0 1 1.25 1.25v6A1.25 1.25 0 0 1 12.5 13h-9a1.25 1.25 0 0 1-1.25-1.25v-7.5Z" />
                  </svg>
                  <span>Open JSON...</span>
                </span>
                <span className="text-[11px] text-[#6b7485]">.json</span>
              </button>

              <button
                type="button"
                onClick={onStartTutorial}
                className="flex h-9 w-full cursor-pointer items-center justify-between rounded-lg px-3 text-[13px] font-medium text-[#d1d6e0] transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                <span className="flex items-center gap-2">
                  <svg className="h-4 w-4 shrink-0 text-[#8b95a7]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="8" cy="8" r="5.75" />
                    <path d="m10.2 5.8-1.4 3.4-3.4 1.4 1.4-3.4 3.4-1.4Z" />
                  </svg>
                  <span>Interactive Guide</span>
                </span>
                <span className="text-[11px] text-[#6b7485]">6 steps</span>
              </button>
            </div>
          </div>

          <div className="mt-6 border-t border-white/[0.08] pt-4">
            <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[#6b7485]">
              Viewport Controls
            </div>
            <div className="space-y-1.5 text-[12px]">
              <div className="flex items-center justify-between">
                <span className="text-[#8b95a7]">Pan</span>
                <span className="font-medium text-[#cbd5e1]">LMB drag</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#8b95a7]">Orbit</span>
                <span className="font-medium text-[#cbd5e1]">RMB drag</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#8b95a7]">Zoom</span>
                <span className="font-medium text-[#cbd5e1]">Scroll</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Template Browser */}
        <div className="flex min-w-0 flex-1 flex-col bg-[#14171f]">
          <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3.5">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#8b95a7]">
                Templates
              </span>
              <span className="mono-num rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-[#949db0]">
                {templates.length}
              </span>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              title="Close (Esc)"
              aria-label="Close"
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-[#8b95a7] transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
                <path d="M2.5 2.5 9.5 9.5M9.5 2.5l-7 7" />
              </svg>
            </button>
          </div>

          <div className="max-h-[360px] flex-1 divide-y divide-white/[0.06] overflow-y-auto">
            {templates.length === 0 ? (
              <div className="px-5 py-12 text-center text-[13px] text-[#6b7485]">
                No templates in packages/shared/maps
              </div>
            ) : (
              templates.map((tpl) => (
                <TemplateListRow key={tpl.id} template={tpl} onSelect={onLoadTemplate} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
