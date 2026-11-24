import type { MapDefinition } from '@tactical-td/shared';
import type { DsaMapAlgorithm } from '../../generators';
import type { TemplateMapSummary } from '../../types';
import {
  GeneratorModal,
  JsonExportModal,
  PreferencesModal,
  SaveAsModal,
  TemplatePickerModal,
} from './index';

export function EditorModals({
  map,
  templates,
  openTemplateModal,
  openSaveAsModal,
  openGenModal,
  openPrefsModal,
  openJsonModal,
  dsaAlgo,
  dsaSeed,
  dsaDensity,
  dsaW,
  dsaD,
  snapRadius,
  onSelectTemplate,
  onCloseTemplateModal,
  onSaveAs,
  onCloseSaveAsModal,
  onChangeDsaAlgo,
  onChangeDsaSeed,
  onChangeDsaDensity,
  onChangeDsaW,
  onChangeDsaD,
  onRandomizeDsa,
  onGenerateDsa,
  onCloseGenModal,
  onChangeSnapRadius,
  onApplyBounds,
  onClosePrefsModal,
  onCopyJson,
  onDownloadGlb,
  onCloseJsonModal,
}: {
  map: MapDefinition;
  templates: TemplateMapSummary[];
  openTemplateModal: boolean;
  openSaveAsModal: boolean;
  openGenModal: boolean;
  openPrefsModal: boolean;
  openJsonModal: boolean;
  dsaAlgo: DsaMapAlgorithm;
  dsaSeed: number;
  dsaDensity: number;
  dsaW: number;
  dsaD: number;
  snapRadius: number;
  onSelectTemplate: (id: string) => void;
  onCloseTemplateModal: () => void;
  onSaveAs: (id: string, name: string) => void;
  onCloseSaveAsModal: () => void;
  onChangeDsaAlgo: (alg: DsaMapAlgorithm) => void;
  onChangeDsaSeed: (seed: number) => void;
  onChangeDsaDensity: (d: number) => void;
  onChangeDsaW: (w: number) => void;
  onChangeDsaD: (d: number) => void;
  onRandomizeDsa: () => void;
  onGenerateDsa: () => void;
  onCloseGenModal: () => void;
  onChangeSnapRadius: (r: number) => void;
  onApplyBounds: (w: number, d: number) => void;
  onClosePrefsModal: () => void;
  onCopyJson: () => void;
  onDownloadGlb: () => void;
  onCloseJsonModal: () => void;
}) {
  return (
    <>
      <TemplatePickerModal
        open={openTemplateModal}
        templates={templates}
        onSelectTemplate={onSelectTemplate}
        onClose={onCloseTemplateModal}
      />
      <SaveAsModal
        open={openSaveAsModal}
        initialId={map.id}
        initialName={map.name}
        onConfirm={onSaveAs}
        onClose={onCloseSaveAsModal}
      />
      <GeneratorModal
        open={openGenModal}
        algorithm={dsaAlgo}
        seed={dsaSeed}
        density={dsaDensity}
        gridW={dsaW}
        gridD={dsaD}
        onChangeAlgorithm={onChangeDsaAlgo}
        onChangeSeed={onChangeDsaSeed}
        onChangeDensity={onChangeDsaDensity}
        onChangeGridW={onChangeDsaW}
        onChangeGridD={onChangeDsaD}
        onRandomizeAll={onRandomizeDsa}
        onGenerate={onGenerateDsa}
        onClose={onCloseGenModal}
      />
      <PreferencesModal
        open={openPrefsModal}
        boundsW={map.bounds.width}
        boundsD={map.bounds.depth}
        snapRadius={snapRadius}
        onChangeSnapRadius={onChangeSnapRadius}
        onApplyBounds={onApplyBounds}
        onClose={onClosePrefsModal}
      />
      <JsonExportModal
        open={openJsonModal}
        map={map}
        onCopy={onCopyJson}
        onDownloadGlb={onDownloadGlb}
        onClose={onCloseJsonModal}
      />
    </>
  );
}
