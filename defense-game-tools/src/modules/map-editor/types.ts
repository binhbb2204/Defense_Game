import type { ElevatedZone, ObstacleKind } from '@tactical-td/shared';

export type EditorTool =
  | 't-select'
  | 't-move'
  | 't-rotate'
  | 't-scale'
  | 'place'
  | 'road'
  | 'shape'
  | 'erase';

export type ToolboxLayer = 'props' | 'imported';

export type ToolboxAssetChoice =
  | {
      kind: 'obstacle';
      key: string;
      preset: ObstacleKind;
      category: string;
      label: string;
      size: { x: number; y: number; z: number };
      color: string;
    }
  | {
      kind: 'zone';
      key: string;
      preset: ElevatedZone['kind'];
      category: string;
      label: string;
      size: { x: number; y: number; z: number };
      color: string;
    }
  | {
      kind: 'custom_model';
      key: string;
      assetName: string;
      category: string;
      label: string;
      format: string;
      size: { x: number; y: number; z: number };
    };

export type SelectionKind =
  | 'road_node'
  | 'road_segment'
  | 'curve_handle'
  | 'obstacle'
  | 'zone'
  | 'custom_model';

export interface SelectionItem {
  type: SelectionKind;
  id: string;
}

export interface TemplatePreviewNode {
  x: number;
  z: number;
  role: 'normal' | 'spawn' | 'base';
}

export interface TemplatePreviewEdge {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  cx?: number;
  cz?: number;
}

export interface TemplateMapPreview {
  nodes: TemplatePreviewNode[];
  edges: TemplatePreviewEdge[];
}

export interface TemplateMapSummary {
  id: string;
  name: string;
  fileName: string;
  version: number;
  nodeCount: number;
  segmentCount: number;
  obstacleCount: number;
  preview?: TemplateMapPreview;
}

export interface ConsoleLogEntry {
  id: number;
  time: string;
  tag: string;
  level: 'info' | 'action' | 'ok' | 'warn';
  message: string;
}

export type CustomPropValue = string | number | boolean;

export function selectionKey(item: SelectionItem): string {
  return `${item.type}:${item.id}`;
}
