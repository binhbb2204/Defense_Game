import { useState } from 'react';
import {
  connectedComponents,
  getMapGraph,
  type MapDefinition,
  type Vec3,
} from '@tactical-td/shared';
import type { SelectionItem } from '../types';
import {
  buildEntityDisplayNames,
  getNodeDisplayName,
  getSegmentDisplayName,
} from '../utils/entityDisplayNames';
import { ExplorerLeafRow, TreeFolder } from './SceneExplorerPrimitives';

interface SceneExplorerPanelProps {
  map: MapDefinition;
  selection: SelectionItem[];
  drawingAnchorId?: string | null;
  hiddenIds: ReadonlySet<string>;
  lockedIds: ReadonlySet<string>;
  search: string;
  showSearch: boolean;
  onSearchChange: (q: string) => void;
  onSelectItem: (item: SelectionItem, additive: boolean) => void;
  onFocusPos: (pos: Vec3, distance?: number) => void;
  onToggleHidden: (ids: string[]) => void;
  onToggleLocked: (ids: string[]) => void;
  onDeleteItem: (item: SelectionItem) => void;
}

/** Clean borderless Scene outliner with color dots and hover-only actions. */
export function SceneExplorerPanel({
  map,
  selection,
  drawingAnchorId,
  hiddenIds,
  lockedIds,
  search,
  showSearch,
  onSearchChange,
  onSelectItem,
  onFocusPos,
  onToggleHidden,
  onToggleLocked,
  onDeleteItem,
}: SceneExplorerPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ props: false });

  const { nodes, segments } = getMapGraph(map);
  const components = connectedComponents(nodes, segments);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const segMap = new Map(segments.map((s) => [s.id, s]));
  const entityNames = buildEntityDisplayNames(nodes, segments);

  const selectedSet = new Set(selection.map((s) => `${s.type}:${s.id}`));
  const matches = (txt: string) =>
    !search.trim() || txt.toLowerCase().includes(search.trim().toLowerCase());
  const totalProps =
    map.obstacles.length + map.elevatedZones.length + (map.customModels?.length ?? 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden text-xs">
      {showSearch && (
        <div className="relative shrink-0 border-b px-2.5 py-1.5" style={{ borderColor: 'var(--border-subtle)' }}>
          <i className="fas fa-search absolute top-3.5 left-4.5 text-[10px]" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            autoFocus
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Filter scene..."
            className="h-6 w-full rounded-[4px] border pr-2 pl-6 text-[11px] outline-none"
            style={{
              backgroundColor: 'var(--bg-input)',
              borderColor: 'var(--border-strong)',
              color: 'var(--text-primary)',
            }}
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-1">
        <div className="px-3 py-1 text-[12px] font-semibold" style={{ color: '#ffffff' }}>
          {map.name || map.id || 'Untitled Map'}
        </div>

        {/* Road Networks */}
        {components.map((comp) => {
          const compOpen = expanded[comp.id] ?? true;
          const segOpen = expanded[`${comp.id}:segs`] ?? false;
          const isDrawingThisNet = Boolean(drawingAnchorId && comp.nodeIds.includes(drawingAnchorId));
          const allCompIds = [...comp.nodeIds, ...comp.segmentIds];
          const isHidden = allCompIds.length > 0 && allCompIds.every((id) => hiddenIds.has(id));
          const isLocked = allCompIds.length > 0 && allCompIds.every((id) => lockedIds.has(id));

          return (
            <div key={comp.id}>
              <div className="group flex items-center justify-between py-1 pr-2.5 pl-4 hover:bg-[#1a1d24]">
                <button
                  type="button"
                  onClick={() => setExpanded((s) => ({ ...s, [comp.id]: !compOpen }))}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-[11.5px] font-medium"
                  style={{ color: '#e5e7eb' }}
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: '#4c8dff' }} />
                  <span className="truncate">Network {comp.index + 1}</span>
                </button>

                <span
                  className="mono-num shrink-0 text-[10px] group-hover:hidden"
                  style={{ color: isDrawingThisNet ? '#8db8ff' : '#8c919a' }}
                >
                  {isDrawingThisNet ? 'drawing' : `${comp.nodeIds.length}n`}
                </span>

                <div className="hidden shrink-0 items-center gap-1 text-[10px] group-hover:flex" style={{ color: '#9aa0a9' }}>
                  <button type="button" onClick={() => onToggleHidden(allCompIds)} title={isHidden ? 'Show Network' : 'Hide Network'} className="cursor-pointer p-0.5 hover:text-white">
                    <i className={`fas ${isHidden ? 'fa-eye-slash' : 'fa-eye'}`} />
                  </button>
                  <button type="button" onClick={() => onToggleLocked(allCompIds)} title={isLocked ? 'Unlock Network' : 'Lock Network'} className="cursor-pointer p-0.5 hover:text-white">
                    <i className={`fas ${isLocked ? 'fa-lock text-[#eab308]' : 'fa-lock-open'}`} />
                  </button>
                </div>
              </div>

              {compOpen && (
                <>
                  {comp.nodeIds.map((nid) => {
                    const node = nodeMap.get(nid);
                    if (!node) return null;
                    const displayName = getNodeDisplayName(entityNames, node);
                    if (!matches(displayName) && !matches(node.id) && !matches(node.role)) return null;
                    const isDrawingAnchor = drawingAnchorId === node.id;
                    const dotColor =
                      node.role === 'spawn'
                        ? '#22c55e'
                        : node.role === 'base'
                          ? '#ef4444'
                          : isDrawingAnchor
                            ? '#ffffff'
                            : '#8c919a';

                    return (
                      <ExplorerLeafRow
                        key={node.id}
                        indent={8}
                        dotColor={dotColor}
                        label={isDrawingAnchor ? `${displayName} · last` : displayName}
                        title={`${displayName} (${node.id})`}
                        selected={selectedSet.has(`road_node:${node.id}`)}
                        hidden={hiddenIds.has(node.id)}
                        locked={lockedIds.has(node.id)}
                        onClick={(e) => onSelectItem({ type: 'road_node', id: node.id }, e.shiftKey || e.ctrlKey || e.metaKey)}
                        onDoubleClick={() => onFocusPos({ x: node.x, y: node.y, z: node.z }, 16)}
                        onToggleHidden={() => onToggleHidden([node.id])}
                        onToggleLocked={() => onToggleLocked([node.id])}
                        onDelete={() => onDeleteItem({ type: 'road_node', id: node.id })}
                      />
                    );
                  })}

                  {comp.segmentIds.length > 0 && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setExpanded((s) => ({ ...s, [`${comp.id}:segs`]: !segOpen }))}
                        className="flex w-full cursor-pointer items-center justify-between py-0.5 pr-3 pl-8 text-left text-[10.5px] hover:bg-[#1a1d24]"
                        style={{ color: '#6b7280' }}
                      >
                        <span className="flex items-center gap-1.5">
                          <i className={`fas ${segOpen ? 'fa-caret-down' : 'fa-caret-right'} text-[9px]`} />
                          <span>Segments</span>
                        </span>
                        <span className="mono-num">{comp.segmentIds.length}</span>
                      </button>

                      {segOpen &&
                        comp.segmentIds.map((sid) => {
                          const seg = segMap.get(sid);
                          if (!seg) return null;
                          const displayName = getSegmentDisplayName(entityNames, seg);
                          const kindLabel = seg.kind === 'curve' ? 'Curve' : 'Straight';
                          if (!matches(displayName) && !matches(seg.id) && !matches(seg.kind)) return null;
                          return (
                            <ExplorerLeafRow
                              key={seg.id}
                              indent={10}
                              icon={seg.kind === 'curve' ? 'fa-bezier-curve' : 'fa-minus'}
                              iconColor={seg.kind === 'curve' ? '#8db8ff' : '#6b7280'}
                              label={displayName}
                              rightBadge={kindLabel}
                              title={`${displayName} (${seg.id})`}
                              selected={selectedSet.has(`road_segment:${seg.id}`)}
                              hidden={hiddenIds.has(seg.id)}
                              locked={lockedIds.has(seg.id)}
                              onClick={(e) => onSelectItem({ type: 'road_segment', id: seg.id }, e.shiftKey || e.ctrlKey || e.metaKey)}
                              onDoubleClick={() => {
                                const a = nodeMap.get(seg.a);
                                const b = nodeMap.get(seg.b);
                                if (a && b) onFocusPos({ x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5, z: (a.z + b.z) * 0.5 }, 20);
                              }}
                              onToggleHidden={() => onToggleHidden([seg.id])}
                              onToggleLocked={() => onToggleLocked([seg.id])}
                              onDelete={() => onDeleteItem({ type: 'road_segment', id: seg.id })}
                            />
                          );
                        })}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}

        {/* Props */}
        <TreeFolder
          label="Props"
          dotColor="#a78b6a"
          rightText={String(totalProps)}
          open={expanded.props ?? false}
          onToggle={() => setExpanded((s) => ({ ...s, props: !s.props }))}
        />

        {expanded.props && (
          <>
            {map.obstacles
              .filter((o) => matches(o.id) || matches(o.kind))
              .map((obs) => (
                <ExplorerLeafRow
                  key={obs.id}
                  indent={8}
                  dotColor={obs.color ?? '#a78b6a'}
                  label={obs.id}
                  selected={selectedSet.has(`obstacle:${obs.id}`)}
                  hidden={obs.visible === false || hiddenIds.has(obs.id)}
                  locked={Boolean(obs.locked) || lockedIds.has(obs.id)}
                  onClick={(e) => onSelectItem({ type: 'obstacle', id: obs.id }, e.shiftKey || e.ctrlKey || e.metaKey)}
                  onDoubleClick={() => onFocusPos(obs.position, 18)}
                  onToggleHidden={() => onToggleHidden([obs.id])}
                  onToggleLocked={() => onToggleLocked([obs.id])}
                  onDelete={() => onDeleteItem({ type: 'obstacle', id: obs.id })}
                />
              ))}

            {map.elevatedZones
              .filter((z) => matches(z.id) || matches(z.label))
              .map((zone) => (
                <ExplorerLeafRow
                  key={zone.id}
                  indent={8}
                  dotColor="#3b82f6"
                  label={zone.label || zone.id}
                  selected={selectedSet.has(`zone:${zone.id}`)}
                  hidden={zone.visible === false || hiddenIds.has(zone.id)}
                  locked={Boolean(zone.locked) || lockedIds.has(zone.id)}
                  onClick={(e) => onSelectItem({ type: 'zone', id: zone.id }, e.shiftKey || e.ctrlKey || e.metaKey)}
                  onDoubleClick={() => onFocusPos(zone.position, 18)}
                  onToggleHidden={() => onToggleHidden([zone.id])}
                  onToggleLocked={() => onToggleLocked([zone.id])}
                  onDelete={() => onDeleteItem({ type: 'zone', id: zone.id })}
                />
              ))}

            {(map.customModels ?? [])
              .filter((m) => matches(m.name) || matches(m.assetName))
              .map((mdl) => (
                <ExplorerLeafRow
                  key={mdl.id}
                  indent={8}
                  dotColor="#a855f7"
                  label={mdl.name}
                  selected={selectedSet.has(`custom_model:${mdl.id}`)}
                  hidden={mdl.visible === false || hiddenIds.has(mdl.id)}
                  locked={Boolean(mdl.locked) || lockedIds.has(mdl.id)}
                  onClick={(e) => onSelectItem({ type: 'custom_model', id: mdl.id }, e.shiftKey || e.ctrlKey || e.metaKey)}
                  onDoubleClick={() => onFocusPos(mdl.position, 18)}
                  onToggleHidden={() => onToggleHidden([mdl.id])}
                  onToggleLocked={() => onToggleLocked([mdl.id])}
                  onDelete={() => onDeleteItem({ type: 'custom_model', id: mdl.id })}
                />
              ))}
          </>
        )}
      </div>
    </div>
  );
}
