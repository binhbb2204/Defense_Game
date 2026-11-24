import {
  evaluateRoadSegmentAt,
  getMapGraph,
  type MapDefinition,
} from '@tactical-td/shared';

/**
 * Renders the 2D Road Graph tactical minimap (hidden by default, toggled with M).
 */
export function renderMinimapCanvas(
  canvas: HTMLCanvasElement | null,
  map: MapDefinition,
  selectedIds: ReadonlySet<string>,
  hiddenIds: ReadonlySet<string> = new Set(),
): void {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const cw = canvas.width;
  const ch = canvas.height;
  const worldW = Math.max(20, map.bounds.width);
  const worldD = Math.max(20, map.bounds.depth);
  const scale = Math.min((cw - 20) / worldW, (ch - 20) / worldD);
  const renderW = worldW * scale;
  const renderH = worldD * scale;
  const ox = (cw - renderW) / 2;
  const oz = (ch - renderH) / 2;

  const toCanvasX = (wx: number) => ox + (wx + worldW * 0.5) * scale;
  const toCanvasY = (wz: number) => oz + (wz + worldD * 0.5) * scale;

  ctx.fillStyle = '#181a1f';
  ctx.fillRect(0, 0, cw, ch);

  ctx.fillStyle = '#1f232a';
  ctx.fillRect(ox, oz, renderW, renderH);

  ctx.strokeStyle = '#2d323c';
  ctx.lineWidth = 0.6;
  for (let gx = -worldW * 0.5; gx <= worldW * 0.5; gx += 10) {
    const px = toCanvasX(gx);
    ctx.beginPath();
    ctx.moveTo(px, oz);
    ctx.lineTo(px, oz + renderH);
    ctx.stroke();
  }
  for (let gz = -worldD * 0.5; gz <= worldD * 0.5; gz += 10) {
    const py = toCanvasY(gz);
    ctx.beginPath();
    ctx.moveTo(ox, py);
    ctx.lineTo(ox + renderW, py);
    ctx.stroke();
  }

  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 1;
  ctx.strokeRect(ox, oz, renderW, renderH);

  const { nodes, segments } = getMapGraph(map);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Road Segments
  for (const seg of segments) {
    if (hiddenIds.has(seg.id)) continue;
    const a = nodeMap.get(seg.a);
    const b = nodeMap.get(seg.b);
    if (!a || !b) continue;

    ctx.strokeStyle = selectedIds.has(seg.id)
      ? '#3b82f6'
      : seg.isTunnel || seg.elevationMode === 'tunnel'
        ? '#8b5cf6'
        : seg.isOverpass || seg.elevationMode === 'bridge' || a.y > 0.6 || b.y > 0.6
          ? '#eab308'
          : '#64748b';
    ctx.lineWidth = Math.max(2.5, seg.width * scale * 0.72);
    ctx.lineCap = 'round';
    ctx.beginPath();
    const steps = seg.kind === 'curve' ? 16 : 2;
    for (let k = 0; k <= steps; k++) {
      const pt = evaluateRoadSegmentAt(a, b, seg, k / steps).position;
      const cx = toCanvasX(pt.x);
      const cy = toCanvasY(pt.z);
      if (k === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  // Platforms & Obstacles & Custom Models
  for (const zone of map.elevatedZones) {
    if (zone.visible === false) continue;
    const cx = toCanvasX(zone.position.x);
    const cy = toCanvasY(zone.position.z);
    const zw = Math.max(3, zone.size.x * scale);
    const zd = Math.max(3, zone.size.z * scale);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-(zone.rotationY ?? 0));
    ctx.fillStyle = '#0284c7';
    ctx.fillRect(-zw / 2, -zd / 2, zw, zd);
    if (selectedIds.has(zone.id)) {
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-zw / 2 - 1, -zd / 2 - 1, zw + 2, zd + 2);
    }
    ctx.restore();
  }

  for (const obs of map.obstacles) {
    if (obs.visible === false) continue;
    const cx = toCanvasX(obs.position.x);
    const cy = toCanvasY(obs.position.z);
    const ow = Math.max(3, obs.size.x * scale);
    const od = Math.max(3, obs.size.z * scale);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-(obs.rotationY ?? 0));
    ctx.fillStyle = obs.color ?? '#94a3b8';
    ctx.fillRect(-ow / 2, -od / 2, ow, od);
    if (selectedIds.has(obs.id)) {
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-ow / 2 - 1, -od / 2 - 1, ow + 2, od + 2);
    }
    ctx.restore();
  }

  for (const mdl of map.customModels ?? []) {
    if (mdl.visible === false) continue;
    const cx = toCanvasX(mdl.position.x);
    const cy = toCanvasY(mdl.position.z);
    ctx.fillStyle = '#a855f7';
    ctx.fillRect(cx - 2.5, cy - 2.5, 5, 5);
    if (selectedIds.has(mdl.id)) {
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cx - 4, cy - 4, 8, 8);
    }
  }

  // Road Nodes (Spawn green, Base red, Normal slate/white)
  for (const n of nodes) {
    if (hiddenIds.has(n.id)) continue;
    const cx = toCanvasX(n.x);
    const cy = toCanvasY(n.z);
    ctx.fillStyle =
      n.role === 'spawn' ? '#22c55e' : n.role === 'base' ? '#ef4444' : '#cbd5e1';
    ctx.beginPath();
    ctx.arc(cx, cy, n.role === 'normal' ? 2.5 : 3.8, 0, Math.PI * 2);
    ctx.fill();
    if (selectedIds.has(n.id)) {
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
