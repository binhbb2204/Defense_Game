import { useCallback, useEffect, useState } from 'react';
import {
  createEmptyMap,
  getMapGraph,
  HIGHWAY_01_MAP,
  MAPS,
  migrateMapDefinition,
  syncGraphToLegacyWaypoints,
  type MapDefinition,
} from '@tactical-td/shared';
import {
  arrayBufferToBase64,
  exportCompositeSceneGlb,
  parseImportedModelBuffer,
  thumbnailStudio,
  type ImportedAssetEntry,
} from '../rendering';
import type {
  ConsoleLogEntry,
  EditorTool,
  TemplateMapSummary,
  ToolboxAssetChoice,
  ToolboxLayer,
} from '../types';

const BUILTIN_TEMPLATE_FALLBACK: TemplateMapSummary[] = [
  {
    id: HIGHWAY_01_MAP.id,
    name: HIGHWAY_01_MAP.name,
    fileName: 'highway_01.json',
    version: HIGHWAY_01_MAP.version,
    nodeCount: HIGHWAY_01_MAP.waypoints.length,
    segmentCount: Math.max(0, HIGHWAY_01_MAP.waypoints.length - 1),
    obstacleCount: HIGHWAY_01_MAP.obstacles.length,
    preview: {
      nodes: HIGHWAY_01_MAP.waypoints.map((wp, i) => ({
        x: wp.x,
        z: wp.z,
        role: i === 0 ? 'spawn' : i === HIGHWAY_01_MAP.waypoints.length - 1 ? 'base' : 'normal',
      })),
      edges: HIGHWAY_01_MAP.waypoints.slice(1).map((wp, i) => ({
        x1: HIGHWAY_01_MAP.waypoints[i]!.x,
        z1: HIGHWAY_01_MAP.waypoints[i]!.z,
        x2: wp.x,
        z2: wp.z,
      })),
    },
  },
];

export function useMapFileIO(params: {
  map: MapDefinition;
  mapRef: React.MutableRefObject<MapDefinition>;
  assetCacheRef: React.MutableRefObject<Map<string, ImportedAssetEntry>>;
  setImportedAssets: React.Dispatch<React.SetStateAction<ImportedAssetEntry[]>>;
  onChangeMap: (next: MapDefinition) => void;
  commitMap: (next: MapDefinition, pushHistory?: boolean) => void;
  setThumbs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setToolboxLayer: (layer: ToolboxLayer) => void;
  setSelectedAsset: (asset: ToolboxAssetChoice | null) => void;
  setActiveTool: (tool: EditorTool) => void;
  onResetEditorTransient: () => void;
  onCloseWelcome: () => void;
  onCloseTemplateModal: () => void;
  onNotify: (type: 'ok' | 'err', msg: string) => void;
  pushLog: (tag: string, level: ConsoleLogEntry['level'], msg: string) => void;
}) {
  const {
    map,
    mapRef,
    assetCacheRef,
    setImportedAssets,
    onChangeMap,
    commitMap,
    setThumbs,
    setToolboxLayer,
    setSelectedAsset,
    setActiveTool,
    onResetEditorTransient,
    onCloseWelcome,
    onCloseTemplateModal,
    onNotify,
    pushLog,
  } = params;

  const [templates, setTemplates] = useState<TemplateMapSummary[]>(BUILTIN_TEMPLATE_FALLBACK);
  const [saving, setSaving] = useState(false);

  const refreshTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/shared/maps');
      if (!res.ok) return;
      const data = (await res.json()) as { ok: boolean; maps?: TemplateMapSummary[] };
      if (data.ok && Array.isArray(data.maps)) setTemplates(data.maps);
    } catch {
      // Fallback already populated
    }
  }, []);

  useEffect(() => {
    void refreshTemplates();
  }, [refreshTemplates]);

  useEffect(() => {
    for (const m of map.customModels ?? []) {
      if (assetCacheRef.current.has(m.assetName)) continue;
      fetch(`/api/shared/assets/${encodeURIComponent(m.assetName)}`)
        .then(async (res) => {
          if (!res.ok) return;
          const buf = await res.arrayBuffer();
          const parsed = await parseImportedModelBuffer(buf, m.assetName);
          parsed.uploadedToServer = true;
          assetCacheRef.current.set(m.assetName, parsed);
          const thumbUrl = thumbnailStudio.renderObjectThumbnail(`mdl:${parsed.assetName}`, parsed.template);
          setThumbs((prev) => ({ ...prev, [`mdl:${parsed.assetName}`]: thumbUrl }));
          setImportedAssets(Array.from(assetCacheRef.current.values()));
        })
        .catch(() => {
          // Non-fatal
        });
    }
  }, [assetCacheRef, map.customModels, setImportedAssets, setThumbs]);

  const handleSaveAndPack = useCallback(
    async (downloadGlbOnly = false, overrideId?: string, overrideName?: string) => {
      setSaving(true);
      try {
        const mapId = (overrideId ?? mapRef.current.id).trim() || 'untitled_map';
        const mapName = (overrideName ?? mapRef.current.name).trim() || mapId;
        const prepared = syncGraphToLegacyWaypoints({ ...mapRef.current, id: mapId, name: mapName });

        const { glbBuffer, exportedNodeCount } = await exportCompositeSceneGlb(prepared, assetCacheRef.current);
        if (downloadGlbOnly) {
          const blob = new Blob([glbBuffer], { type: 'model/gltf-binary' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${mapId}_scene.glb`;
          a.click();
          URL.revokeObjectURL(url);
          pushLog('Export', 'ok', `Exported ${mapId}_scene.glb (${exportedNodeCount} nodes).`);
          onNotify('ok', `Exported ${mapId}_scene.glb`);
          return;
        }

        const glbBase64 = arrayBufferToBase64(glbBuffer);
        const glbRes = await fetch('/api/shared/save-scene-glb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: mapId, glbBase64 }),
        });
        const glbData = (await glbRes.json()) as { ok: boolean; filePath?: string; error?: string };
        if (!glbRes.ok || !glbData.ok) throw new Error(glbData.error || 'Failed to save .glb');

        const nextMap = syncGraphToLegacyWaypoints({ ...prepared, sceneGlbPath: glbData.filePath });
        onChangeMap(nextMap);

        const jsonRes = await fetch('/api/shared/map', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextMap),
        });
        const jsonData = (await jsonRes.json()) as { ok: boolean; filePath?: string; error?: string };
        if (!jsonRes.ok || !jsonData.ok) throw new Error(jsonData.error || 'Failed to save JSON');

        pushLog('Save', 'ok', `Saved ${jsonData.filePath} and ${glbData.filePath}.`);
        onNotify('ok', `Saved ${mapId}.json + .glb`);
        void refreshTemplates();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Save failed';
        pushLog('Save', 'warn', msg);
        onNotify('err', msg);
      } finally {
        setSaving(false);
      }
    },
    [assetCacheRef, mapRef, onChangeMap, onNotify, pushLog, refreshTemplates],
  );

  const handleLoadTemplate = useCallback(
    async (templateId: string) => {
      try {
        let rawMap: MapDefinition | null = null;
        try {
          const res = await fetch(`/api/shared/maps/${encodeURIComponent(templateId)}`);
          if (res.ok) {
            const payload = (await res.json()) as { ok: boolean; map?: MapDefinition };
            if (payload.ok && payload.map) rawMap = payload.map;
          }
        } catch {
          // Local fallback
        }
        if (!rawMap && MAPS[templateId]) rawMap = structuredClone(MAPS[templateId]!);
        if (!rawMap) throw new Error(`Template "${templateId}" not found.`);

        const migrated = migrateMapDefinition(rawMap);
        commitMap(migrated);
        onResetEditorTransient();
        onCloseWelcome();
        onCloseTemplateModal();
        const { nodes, segments } = getMapGraph(migrated);
        pushLog('Template', 'ok', `Loaded "${migrated.name}" (${nodes.length} nodes, ${segments.length} segs).`);
        onNotify('ok', `Loaded ${migrated.name}`);
      } catch (err) {
        onNotify('err', err instanceof Error ? err.message : 'Failed to load template');
      }
    },
    [commitMap, onCloseTemplateModal, onCloseWelcome, onNotify, onResetEditorTransient, pushLog],
  );

  const handleImport3D = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      for (const file of Array.from(files)) {
        try {
          const buf = await file.arrayBuffer();
          const entry = await parseImportedModelBuffer(buf, file.name);
          assetCacheRef.current.set(entry.assetName, entry);
          const thumbUrl = thumbnailStudio.renderObjectThumbnail(`mdl:${entry.assetName}`, entry.template);
          setThumbs((prev) => ({ ...prev, [`mdl:${entry.assetName}`]: thumbUrl }));

          const base64 = arrayBufferToBase64(buf);
          const res = await fetch('/api/shared/upload-asset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: entry.assetName, base64 }),
          });
          const data = (await res.json()) as { ok: boolean; filePath?: string };
          if (res.ok && data.ok) {
            entry.uploadedToServer = true;
            pushLog('Import', 'ok', `Imported ${entry.assetName} -> ${data.filePath}`);
          }

          setImportedAssets(Array.from(assetCacheRef.current.values()));
          setToolboxLayer('imported');
          setSelectedAsset({
            kind: 'custom_model',
            key: `mdl:${entry.assetName}`,
            assetName: entry.assetName,
            category: entry.format.toUpperCase(),
            label: entry.assetName.replace(/\.[^/.]+$/, ''),
            format: entry.format,
            size: entry.dimensions,
          });
          setActiveTool('place');
          onCloseWelcome();
          onNotify('ok', `Imported ${entry.assetName}`);
        } catch (err) {
          onNotify('err', err instanceof Error ? err.message : 'Failed to import 3D model');
        }
      }
    },
    [assetCacheRef, onCloseWelcome, onNotify, pushLog, setActiveTool, setImportedAssets, setSelectedAsset, setThumbs, setToolboxLayer],
  );

  const handleOpenMapJson = useCallback(
    async (file: File | null) => {
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text()) as MapDefinition;
        if (!parsed || (!Array.isArray(parsed.waypoints) && !Array.isArray(parsed.nodes) && !Array.isArray(parsed.paths))) {
          throw new Error('Invalid map JSON schema.');
        }
        const migrated = migrateMapDefinition(parsed);
        commitMap(migrated);
        onResetEditorTransient();
        onCloseWelcome();
        const g = getMapGraph(migrated);
        pushLog('File', 'ok', `Loaded "${file.name}" (${g.nodes.length} nodes, ${g.segments.length} segs).`);
        onNotify('ok', `Loaded ${file.name}`);
      } catch (err) {
        onNotify('err', err instanceof Error ? err.message : 'Failed to open JSON');
      }
    },
    [commitMap, onCloseWelcome, onNotify, onResetEditorTransient, pushLog],
  );

  const handleNewEmptyMap = useCallback(() => {
    commitMap(createEmptyMap());
    onResetEditorTransient();
    onCloseWelcome();
    pushLog('File', 'action', 'Created empty map.');
  }, [commitMap, onCloseWelcome, onResetEditorTransient, pushLog]);

  return {
    templates,
    saving,
    refreshTemplates,
    handleSaveAndPack,
    handleLoadTemplate,
    handleImport3D,
    handleOpenMapJson,
    handleNewEmptyMap,
  };
}
