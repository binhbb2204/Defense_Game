import { useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ShellHeaderContext } from '../../../ui/ShellHeaderContext';

type OpenMenuId = 'file' | 'edit' | 'view' | null;

export interface MenuBarProps {
  mapId: string;
  saving: boolean;
  validationCount: number;
  showFloatingMinimap: boolean;
  showRoadDebug: boolean;
  rightDockOpen: boolean;
  tutorialOpen: boolean;
  onChangeMapId: (id: string) => void;
  onNewMap: () => void;
  onOpenTemplateModal: () => void;
  onOpenJsonPicker: () => void;
  onOpen3dPicker: () => void;
  onSave: () => void;
  onOpenSaveAsModal: () => void;
  onExportGlb: () => void;
  onOpenJsonModal: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenGenModal: () => void;
  onOpenPrefsModal: () => void;
  onToggleMinimap: () => void;
  onToggleRoadDebug: () => void;
  onOpenValidation: () => void;
  onToggleRightDock: () => void;
  onStartTutorial: () => void;
  onOpenGuideModal: () => void;
}

/**
 * Portals Map Studio's File/Edit/View dropdowns and right-side Undo/Redo/Export .glb/Save controls
 * directly into ToolShell's single 36px top bar so only one clean header exists.
 */
export function MenuBar(props: MenuBarProps) {
  const { leftSlot, rightSlot } = useContext(ShellHeaderContext);
  const [openMenu, setOpenMenu] = useState<OpenMenuId>(null);
  const menuGroupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (menuGroupRef.current && !menuGroupRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

  const runAction = (fn: () => void) => {
    setOpenMenu(null);
    fn();
  };

  const triggerClass = (id: Exclude<OpenMenuId, null>) =>
    `dcc-btn !min-h-[24px] !min-w-0 px-2 text-[12px] ${openMenu === id ? 'active' : ''}`;

  const dropdownStyle = {
    backgroundColor: '#161920',
    borderColor: 'var(--border-strong)',
    borderRadius: '5px',
    color: 'var(--text-primary)',
  };

  const leftContent = (
    <div ref={menuGroupRef} className="mr-1.5 flex items-center gap-0.5">
      <div className="relative" onMouseEnter={() => { if (openMenu) setOpenMenu('file'); }}>
        <button type="button" onClick={() => setOpenMenu((m) => (m === 'file' ? null : 'file'))} className={triggerClass('file')}>
          File
        </button>
        {openMenu === 'file' && (
          <div className="absolute top-full left-0 z-50 mt-1 w-56 border py-1 shadow-2xl" style={dropdownStyle}>
            <MenuRow icon="fa-file" label="New Map" onClick={() => runAction(props.onNewMap)} />
            <MenuRow icon="fa-layer-group" label="New from Template..." onClick={() => runAction(props.onOpenTemplateModal)} />
            <MenuRow icon="fa-folder-open" label="Open JSON..." onClick={() => runAction(props.onOpenJsonPicker)} />
            <MenuRow icon="fa-file-import" label="Import 3D (.glb/.fbx/.obj)" onClick={() => runAction(props.onOpen3dPicker)} />
            <hr className="my-1" style={{ borderColor: 'var(--border-subtle)' }} />
            <MenuRow icon="fa-save" label="Save" kbd="Ctrl+S" onClick={() => runAction(props.onSave)} />
            <MenuRow icon="fa-file-signature" label="Save As..." onClick={() => runAction(props.onOpenSaveAsModal)} />
            <MenuRow icon="fa-cubes" label="Export .glb" onClick={() => runAction(props.onExportGlb)} />
            <MenuRow icon="fa-code" label="View JSON..." onClick={() => runAction(props.onOpenJsonModal)} />
          </div>
        )}
      </div>

      <div className="relative" onMouseEnter={() => { if (openMenu) setOpenMenu('edit'); }}>
        <button type="button" onClick={() => setOpenMenu((m) => (m === 'edit' ? null : 'edit'))} className={triggerClass('edit')}>
          Edit
        </button>
        {openMenu === 'edit' && (
          <div className="absolute top-full left-0 z-50 mt-1 w-52 border py-1 shadow-2xl" style={dropdownStyle}>
            <MenuRow icon="fa-undo" label="Undo" kbd="Ctrl+Z" onClick={() => runAction(props.onUndo)} />
            <MenuRow icon="fa-redo" label="Redo" kbd="Ctrl+Y" onClick={() => runAction(props.onRedo)} />
            <hr className="my-1" style={{ borderColor: 'var(--border-subtle)' }} />
            <MenuRow icon="fa-magic" label="Auto Generate (DSA)..." onClick={() => runAction(props.onOpenGenModal)} />
            <MenuRow icon="fa-sliders-h" label="Preferences..." onClick={() => runAction(props.onOpenPrefsModal)} />
          </div>
        )}
      </div>

      <div className="relative" onMouseEnter={() => { if (openMenu) setOpenMenu('view'); }}>
        <button type="button" onClick={() => setOpenMenu((m) => (m === 'view' ? null : 'view'))} className={triggerClass('view')}>
          View
        </button>
        {openMenu === 'view' && (
          <div className="absolute top-full left-0 z-50 mt-1 w-56 border py-1 shadow-2xl" style={dropdownStyle}>
            <MenuRow icon="fa-map-marked-alt" label="Minimap (M)" checked={props.showFloatingMinimap} onClick={() => runAction(props.onToggleMinimap)} />
            <MenuRow icon="fa-draw-polygon" label="Road Debug (Shift+G)" checked={props.showRoadDebug} onClick={() => runAction(props.onToggleRoadDebug)} />
            <MenuRow icon="fa-check-double" label={`Validation (${props.validationCount})`} onClick={() => runAction(props.onOpenValidation)} />
            <MenuRow icon="fa-columns" label="Inspector" checked={props.rightDockOpen} onClick={() => runAction(props.onToggleRightDock)} />
            <hr className="my-1" style={{ borderColor: 'var(--border-subtle)' }} />
            <MenuRow icon="fa-graduation-cap" label="Interactive Tutorial" checked={props.tutorialOpen} onClick={() => runAction(props.onStartTutorial)} />
            <MenuRow icon="fa-book" label="Shortcuts & Reference" kbd="F1" onClick={() => runAction(props.onOpenGuideModal)} />
          </div>
        )}
      </div>

      <span className="ml-1.5 h-4 w-[1px]" style={{ backgroundColor: 'var(--border-strong)' }} />
    </div>
  );

  const rightContent = (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-1.5 px-1.5" title="Map filename ID">
        <input
          type="text"
          value={props.mapId}
          onChange={(e) => props.onChangeMapId(e.target.value)}
          placeholder="untitled_map"
          className="mono-num h-6 w-28 rounded-[3px] border border-transparent bg-transparent px-1 text-right text-[11px] outline-none hover:border-[#2a2f3a] focus:border-[#3b82f6] focus:bg-[#0e1014]"
          style={{ color: '#c4c8cf' }}
        />
        <span className="mono-num text-[11px]" style={{ color: 'var(--text-muted)' }}>
          .json
        </span>
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: props.validationCount === 0 ? '#eab308' : '#ef4444' }}
          title={props.validationCount === 0 ? 'Valid graph' : `${props.validationCount} validation issue(s)`}
        />
      </div>

      <TopBtn label="Undo" onClick={props.onUndo} title="Undo (Ctrl+Z)" />
      <TopBtn label="Redo" onClick={props.onRedo} title="Redo (Ctrl+Y)" />
      <TopBtn label="Export .glb" onClick={props.onExportGlb} title="Export composite 3D .glb scene" />

      <button
        type="button"
        onClick={props.onStartTutorial}
        title="Interactive Tutorial (or F1 for Reference Guide)"
        className={`dcc-btn !min-h-[24px] !min-w-[26px] px-1.5 text-[11px] ${props.tutorialOpen ? 'active' : ''}`}
        style={{ border: '1px solid var(--border-subtle)', backgroundColor: '#181b21' }}
      >
        <i className="fas fa-graduation-cap text-[11px]" />
      </button>

      <button
        type="button"
        disabled={props.saving}
        onClick={props.onSave}
        title="Save Map & Pack Assets (Ctrl+S)"
        className="flex h-6 cursor-pointer items-center gap-1.5 rounded-[4px] px-3 text-[11px] font-semibold text-white disabled:opacity-50"
        style={{ backgroundColor: 'var(--accent)' }}
      >
        <span>{props.saving ? 'Saving...' : 'Save'}</span>
      </button>
    </div>
  );

  if (leftSlot && rightSlot) {
    return (
      <>
        {createPortal(leftContent, leftSlot)}
        {createPortal(rightContent, rightSlot)}
      </>
    );
  }

  return (
    <div
      className="z-30 flex h-9 shrink-0 items-center justify-between border-b px-2.5 text-xs"
      style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-subtle)' }}
    >
      {leftContent}
      {rightContent}
    </div>
  );
}

function TopBtn({ label, title, onClick }: { label: string; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex h-6 cursor-pointer items-center rounded-[4px] border px-2.5 text-[11px] font-medium hover:bg-[#222630]"
      style={{
        backgroundColor: '#181b21',
        borderColor: '#2a2f3a',
        color: '#e4e6ea',
      }}
    >
      {label}
    </button>
  );
}

function MenuRow({
  icon,
  label,
  kbd,
  checked,
  onClick,
}: {
  icon: string;
  label: string;
  kbd?: string;
  checked?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="dcc-btn w-full !justify-between px-3">
      <span className="flex items-center gap-2">
        <i className={`fas ${icon} w-3.5 text-[11px]`} style={{ color: 'var(--text-muted)' }} />
        <span>{label}</span>
      </span>
      {kbd && (
        <span className="mono-num text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {kbd}
        </span>
      )}
      {checked && <i className="fas fa-check text-[10px]" style={{ color: 'var(--accent)' }} />}
    </button>
  );
}
