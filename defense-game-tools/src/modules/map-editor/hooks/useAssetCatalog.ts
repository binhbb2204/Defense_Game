import { useEffect, useMemo, useRef, useState } from 'react';
import type { ElevatedZone, ObstacleKind } from '@tactical-td/shared';
import { thumbnailStudio, type ImportedAssetEntry } from '../rendering';
import type { ToolboxAssetChoice, ToolboxLayer } from '../types';

const OBSTACLE_PREFABS: Array<{
  preset: ObstacleKind;
  category: string;
  label: string;
  size: { x: number; y: number; z: number };
  color: string;
}> = [
  { preset: 'container', category: 'Cover', label: 'Shipping Container', size: { x: 4, y: 3.2, z: 9 }, color: '#b45309' },
  { preset: 'wall', category: 'Cover', label: 'Blast Wall', size: { x: 8, y: 2.8, z: 1.5 }, color: '#64748b' },
  { preset: 'pillar', category: 'Structure', label: 'Support Pillar', size: { x: 2.8, y: 6.5, z: 2.8 }, color: '#475569' },
  { preset: 'hill', category: 'Terrain', label: 'Concrete Berm', size: { x: 7, y: 3.6, z: 6 }, color: '#4b5563' },
  { preset: 'tunnel_shell', category: 'Structure', label: 'Tunnel Arch', size: { x: 9, y: 4.5, z: 10 }, color: '#334155' },
];

const ZONE_PREFABS: Array<{
  preset: ElevatedZone['kind'];
  category: string;
  label: string;
  size: { x: number; y: number; z: number };
  color: string;
}> = [
  { preset: 'rooftop', category: 'Platforms', label: 'Rooftop Pad', size: { x: 8, y: 4.2, z: 8 }, color: '#0284c7' },
  { preset: 'watchtower', category: 'Platforms', label: 'Sniper Watchtower', size: { x: 4.2, y: 7.2, z: 4.2 }, color: '#d97706' },
  { preset: 'overpass_deck', category: 'Platforms', label: 'Overpass Deck', size: { x: 10, y: 5.0, z: 6 }, color: '#0369a1' },
];

export function useAssetCatalog() {
  const assetCacheRef = useRef<Map<string, ImportedAssetEntry>>(new Map());
  const [importedAssets, setImportedAssets] = useState<ImportedAssetEntry[]>([]);
  const [toolboxLayer, setToolboxLayer] = useState<ToolboxLayer>('props');
  const [assetSearch, setAssetSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedAsset, setSelectedAsset] = useState<ToolboxAssetChoice | null>(null);
  const [placeOnce, setPlaceOnce] = useState(false);
  const [ghostRotDeg, setGhostRotDeg] = useState(0);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  const selectedAssetRef = useRef(selectedAsset);
  selectedAssetRef.current = selectedAsset;
  const placeOnceRef = useRef(placeOnce);
  placeOnceRef.current = placeOnce;
  const ghostRotDegRef = useRef(ghostRotDeg);
  ghostRotDegRef.current = ghostRotDeg;

  useEffect(() => {
    const generated: Record<string, string> = {};
    for (const obs of OBSTACLE_PREFABS) {
      generated[`obs:${obs.preset}`] = thumbnailStudio.renderPrefabThumbnail(
        `obs:${obs.preset}`,
        obs.preset,
        obs.size,
        obs.color,
      );
    }
    for (const z of ZONE_PREFABS) {
      generated[`zone:${z.preset}`] = thumbnailStudio.renderPrefabThumbnail(
        `zone:${z.preset}`,
        z.preset,
        z.size,
        z.color,
      );
    }
    setThumbs((prev) => ({ ...generated, ...prev }));
  }, []);

  useEffect(() => {
    if (toolboxLayer === 'imported' && importedAssets.length === 0) {
      setToolboxLayer('props');
    }
  }, [toolboxLayer, importedAssets.length]);

  const catalogItems = useMemo<ToolboxAssetChoice[]>(() => {
    if (toolboxLayer === 'imported') {
      return importedAssets.map((a) => ({
        kind: 'custom_model' as const,
        key: `mdl:${a.assetName}`,
        assetName: a.assetName,
        category: a.format.toUpperCase(),
        label: a.assetName.replace(/\.[^/.]+$/, ''),
        format: a.format,
        size: a.dimensions,
      }));
    }
    return [
      ...OBSTACLE_PREFABS.map((o) => ({
        kind: 'obstacle' as const,
        key: `obs:${o.preset}`,
        preset: o.preset,
        category: o.category,
        label: o.label,
        size: o.size,
        color: o.color,
      })),
      ...ZONE_PREFABS.map((z) => ({
        kind: 'zone' as const,
        key: `zone:${z.preset}`,
        preset: z.preset,
        category: z.category,
        label: z.label,
        size: z.size,
        color: z.color,
      })),
    ];
  }, [toolboxLayer, importedAssets]);

  const categories = useMemo(
    () => ['all', ...Array.from(new Set(catalogItems.map((i) => i.category)))],
    [catalogItems],
  );

  const filteredCatalog = useMemo(() => {
    return catalogItems.filter((item) => {
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (assetSearch.trim() && !item.label.toLowerCase().includes(assetSearch.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [catalogItems, categoryFilter, assetSearch]);

  return {
    assetCacheRef,
    importedAssets,
    setImportedAssets,
    toolboxLayer,
    setToolboxLayer,
    assetSearch,
    setAssetSearch,
    categoryFilter,
    setCategoryFilter,
    selectedAsset,
    setSelectedAsset,
    selectedAssetRef,
    placeOnce,
    setPlaceOnce,
    placeOnceRef,
    ghostRotDeg,
    setGhostRotDeg,
    ghostRotDegRef,
    thumbs,
    setThumbs,
    catalogItems,
    categories,
    filteredCatalog,
  };
}
