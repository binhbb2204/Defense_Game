import type { MapDefinition } from '@tactical-td/shared';
import {
  BottomDockTray,
  EditorModals,
  FloatingMinimap,
  GuideReferenceModal,
  LeftToolDrawer,
  MenuBar,
  RightInspectorDock,
  RoadCursorHud,
  ShapeConfirmPill,
  StatusBar,
  ToolOptionsBar,
  ToolRail,
  TutorialWidget,
  ViewportOverlays,
  WelcomeOverlay,
} from './components';
import { useMapEditorController } from './hooks';
import { handleRoadBackspace } from './tools';

interface MapEditorProps {
  map: MapDefinition;
  onChangeMap: (next: MapDefinition) => void;
  onNotify: (type: 'ok' | 'err', text: string) => void;
}

/**
 * Pure presentation workspace for Map Studio: single merged TopBar (via portal into ToolShell),
 * flush ToolOptionsBar, monochrome left ToolRail, uncluttered obsidian 3D canvas,
 * compact 26px StatusBar, and flat RightInspectorDock.
 */
export function MapEditor({ map, onChangeMap, onNotify }: MapEditorProps) {
  const c = useMapEditorController({ map, onChangeMap, onNotify });
  const { catalog, road, history, sel, ui, shape, io, vp, tutorial } = c;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden" style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-primary)' }}>
      <input ref={c.fileInput3dRef} type="file" multiple accept=".glb,.gltf,.fbx,.obj" onChange={(e) => { void io.handleImport3D(e.target.files); e.target.value = ''; }} className="hidden" />
      <input ref={c.fileInputJsonRef} type="file" accept=".json" onChange={(e) => { void io.handleOpenMapJson(e.target.files?.[0] ?? null); e.target.value = ''; }} className="hidden" />

      <MenuBar
        mapId={map.id}
        saving={io.saving}
        validationCount={c.validationIssues.length}
        showFloatingMinimap={c.showFloatingMinimap}
        showRoadDebug={road.showRoadDebug}
        rightDockOpen={c.rightDockOpen}
        tutorialOpen={tutorial.open}
        onChangeMapId={(id) => history.commitMap({ ...map, id }, false)}
        onNewMap={io.handleNewEmptyMap}
        onOpenTemplateModal={() => { void io.refreshTemplates(); ui.setModals((m) => ({ ...m, template: true })); }}
        onOpenJsonPicker={() => c.fileInputJsonRef.current?.click()}
        onOpen3dPicker={() => c.fileInput3dRef.current?.click()}
        onSave={() => c.handleSave(false)}
        onOpenSaveAsModal={() => ui.setModals((m) => ({ ...m, saveAs: true }))}
        onExportGlb={() => c.handleSave(true)}
        onOpenJsonModal={() => ui.setModals((m) => ({ ...m, json: true }))}
        onUndo={history.handleUndo}
        onRedo={history.handleRedo}
        onOpenGenModal={() => ui.setModals((m) => ({ ...m, gen: true }))}
        onOpenPrefsModal={() => ui.setModals((m) => ({ ...m, prefs: true }))}
        onToggleMinimap={() => c.setShowFloatingMinimap((v) => !v)}
        onToggleRoadDebug={() => road.setShowRoadDebug((v) => !v)}
        onOpenValidation={() => { c.setBottomCollapsed(false); c.setBottomTab('validation'); }}
        onToggleRightDock={() => c.setRightDockOpen((v) => !v)}
        onStartTutorial={() => (tutorial.open ? tutorial.closeTutorial() : tutorial.startTutorial())}
        onOpenGuideModal={() => c.setShowGuideModal(true)}
      />

      <ToolOptionsBar
        activeTool={c.activeTool}
        road={road}
        shape={shape}
        selectedAssetLabel={catalog.selectedAsset?.label}
        placeOnce={catalog.placeOnce}
        selectionCount={sel.selection.length}
        showFloatingMinimap={c.showFloatingMinimap}
        rightDockOpen={c.rightDockOpen}
        leftDrawerOpen={c.leftDrawerOpen}
        onChangePlaceOnce={catalog.setPlaceOnce}
        onRotateProp={() => sel.rotateSelectedOrGhost(15)}
        onOpen3dPicker={() => c.fileInput3dRef.current?.click()}
        onFinishRoadChain={() => {
          if (road.roadState.status === 'drawing' || road.roadUpgradeMode) {
            road.setRoadState({ status: 'idle' });
            road.setRoadBlockedReason(null);
            road.setRoadPreviewHud(null);
            if (road.roadUpgradeMode) road.toggleRoadUpgradeMode();
          } else {
            c.selectEditorTool('t-select');
          }
        }}
        onBackspaceRoad={() => {
          const res = handleRoadBackspace(history.mapRef.current, road.roadState);
          road.setRoadState(res.nextState);
          if (res.reverted) onChangeMap(res.nextMap);
        }}
        onToggleLeftDrawer={() => c.setLeftDrawerOpen((v) => !v)}
        onToggleMinimap={() => c.setShowFloatingMinimap((v) => !v)}
        onToggleInspector={() => c.setRightDockOpen((v) => !v)}
        onToggleLockLos={() => ui.togglePrimaryLosLock(sel.selection)}
        onFocusSelection={() => vp.engineRef.current?.focusSelection(sel.selection[0])}
        onDeleteSelection={() => sel.deleteSelectedItems()}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ToolRail
          activeTool={c.activeTool}
          losMode={c.losMode}
          showFloatingMinimap={c.showFloatingMinimap}
          leftDrawerOpen={c.leftDrawerOpen}
          onSelectTool={c.selectEditorTool}
          onToggleLos={() => c.setLosMode((v) => !v)}
          onToggleMinimap={() => c.setShowFloatingMinimap((v) => !v)}
          onToggleDrawer={() => c.setLeftDrawerOpen((v) => !v)}
          onOpenGuide={() => c.setShowGuideModal(true)}
        />

        {c.leftDrawerOpen && (
          <>
            <LeftToolDrawer
              open={c.leftDrawerOpen}
              width={vp.leftWidth}
              drawerTab={c.drawerTab}
              activeTool={c.activeTool}
              road={road}
              shape={shape}
              importedAssetNames={catalog.importedAssets.map((a) => a.assetName)}
              mapRef={history.mapRef}
              onChangeMapDirect={onChangeMap}
              onSelectTool={c.selectEditorTool}
              onClose={() => c.setLeftDrawerOpen(false)}
              toolboxLayer={catalog.toolboxLayer}
              importedCount={catalog.importedAssets.length}
              assetSearch={catalog.assetSearch}
              categoryFilter={catalog.categoryFilter}
              categories={catalog.categories}
              filteredCatalog={catalog.filteredCatalog}
              selectedAsset={catalog.selectedAsset}
              thumbs={catalog.thumbs}
              placeOnce={catalog.placeOnce}
              onChangePlaceOnce={catalog.setPlaceOnce}
              onChangeLayer={catalog.setToolboxLayer}
              onChangeSearch={catalog.setAssetSearch}
              onChangeCategory={catalog.setCategoryFilter}
              onPickAsset={(item) => { catalog.setSelectedAsset(item); c.selectEditorTool('place'); }}
            />
            <div onMouseDown={(e) => vp.startColumnResize('left', e)} className="panel-resizer" />
          </>
        )}

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div ref={vp.viewportRef} className="h-full w-full outline-none" tabIndex={0} />
            <WelcomeOverlay
              open={c.showWelcome}
              templates={io.templates}
              onNewEmpty={io.handleNewEmptyMap}
              onStartTutorial={() => { io.handleNewEmptyMap(); tutorial.resetTutorial(); }}
              onLoadTemplate={(id) => void io.handleLoadTemplate(id)}
              onOpenJson={() => c.fileInputJsonRef.current?.click()}
              onDismiss={() => c.setShowWelcome(false)}
            />
            <ViewportOverlays
              activeTool={c.activeTool}
              losMode={c.losMode}
              losProbe={c.losProbe}
              onSnapView={(mode) => { vp.engineRef.current?.snapView(mode); tutorial.markCameraUsed(); }}
            />
            {c.activeTool === 'road' && <RoadCursorHud hud={road.roadPreviewHud} />}
            {c.activeTool === 'shape' && <ShapeConfirmPill shape={shape} anarchyEnabled={road.anarchyEnabled} />}
            <TutorialWidget
              tutorial={tutorial}
              onSelectTool={c.selectEditorTool}
              onOpenReference={() => c.setShowGuideModal(true)}
              onSave={() => c.handleSave(false)}
            />
          </div>

          <BottomDockTray
            collapsed={c.bottomCollapsed}
            activeTab={c.bottomTab}
            validationIssues={c.validationIssues}
            logs={ui.logs}
            logFilter={ui.logFilter}
            logContainerRef={ui.logContainerRef}
            onToggleCollapse={() => c.setBottomCollapsed(true)}
            onSelectTab={(tab) => { c.setBottomTab(tab); c.setBottomCollapsed(false); }}
            onChangeLogFilter={ui.setLogFilter}
            onClearLogs={() => ui.setLogs([])}
            onFocusIssue={c.handleFocusValidationIssue}
          />
          <StatusBar
            activeTool={c.activeTool}
            roadBuildMode={road.roadBuildMode}
            roadUpgradeMode={road.roadUpgradeMode}
            roadState={road.roadState}
            shapeMode={shape.mode}
            shapeStep={shape.step}
            activeSnapKind={road.activeSnapKind}
            gridEnabled={road.gridEnabled}
            gridStep={road.gridStep}
            anarchyEnabled={road.anarchyEnabled}
            nodeCount={c.graph.nodes.length}
            segmentCount={c.graph.segments.length}
            drawElevation={road.drawElevation}
            cursorCoords={c.cursorCoords}
            validationCount={c.validationIssues.length}
            logCount={ui.logs.length}
            bottomCollapsed={c.bottomCollapsed}
            bottomTab={c.bottomTab}
            legendOpen={c.showLegendPopover}
            onToggleDiagnostics={c.toggleDiagnostics}
            onToggleLegend={() => c.setShowLegendPopover((v) => !v)}
            onCloseLegend={() => c.setShowLegendPopover(false)}
          />
        </div>

        {c.rightDockOpen && (
          <>
            <div onMouseDown={(e) => vp.startColumnResize('right', e)} className="panel-resizer" />
            <RightInspectorDock
              width={vp.rightWidth}
              map={map}
              graph={c.graph}
              selection={sel.selection}
              drawingAnchorId={road.roadState.status === 'drawing' ? road.roadState.anchorNodeId : null}
              hiddenIds={sel.hiddenIds}
              lockedIds={sel.lockedIds}
              explorerSearch={c.explorerSearch}
              importedAssetNames={catalog.importedAssets.map((a) => a.assetName)}
              activeTool={c.activeTool}
              roadPreviewHud={road.roadPreviewHud}
              roadBuildMode={road.roadBuildMode}
              roadWidth={road.roadWidth}
              onSearchChange={c.setExplorerSearch}
              onSelectItem={sel.selectItem}
              onFocusPos={(pos) => vp.engineRef.current?.focusOn(pos)}
              onToggleHidden={sel.toggleHiddenIds}
              onToggleLocked={sel.toggleLockedIds}
              onDeleteItems={sel.deleteSelectedItems}
              onCommitMap={(next) => history.commitMap(next)}
            />
          </>
        )}
      </div>

      <FloatingMinimap open={c.showFloatingMinimap} pos={c.floatPos} canvasRef={c.minimapCanvasRef} onMove={c.setFloatPos} onClose={() => c.setShowFloatingMinimap(false)} />
      <GuideReferenceModal open={c.showGuideModal} onClose={() => c.setShowGuideModal(false)} onRestartTutorial={tutorial.resetTutorial} />
      <EditorModals
        map={map}
        templates={io.templates}
        openTemplateModal={ui.modals.template}
        openSaveAsModal={ui.modals.saveAs}
        openGenModal={ui.modals.gen}
        openPrefsModal={ui.modals.prefs}
        openJsonModal={ui.modals.json}
        dsaAlgo={ui.dsaAlgo}
        dsaSeed={ui.dsaSeed}
        dsaDensity={ui.dsaDensity}
        dsaW={ui.dsaW}
        dsaD={ui.dsaD}
        snapRadius={road.snapRadius}
        onSelectTemplate={(id) => void io.handleLoadTemplate(id)}
        onCloseTemplateModal={() => ui.setModals((m) => ({ ...m, template: false }))}
        onSaveAs={(id, name) => { ui.setModals((m) => ({ ...m, saveAs: false })); void io.handleSaveAndPack(false, id, name).then(() => tutorial.markSaved()); }}
        onCloseSaveAsModal={() => ui.setModals((m) => ({ ...m, saveAs: false }))}
        onChangeDsaAlgo={ui.setDsaAlgo}
        onChangeDsaSeed={ui.setDsaSeed}
        onChangeDsaDensity={ui.setDsaDensity}
        onChangeDsaW={ui.setDsaW}
        onChangeDsaD={ui.setDsaD}
        onRandomizeDsa={ui.randomizeDsa}
        onGenerateDsa={ui.runProceduralGeneration}
        onCloseGenModal={() => ui.setModals((m) => ({ ...m, gen: false }))}
        onChangeSnapRadius={road.setSnapRadius}
        onApplyBounds={(w, d) => { history.commitMap({ ...map, bounds: { width: w, depth: d } }); ui.pushLog('Prefs', 'action', `Arena bounds set to ${w}x${d}m.`); onNotify('ok', `Bounds ${w}x${d}m`); }}
        onClosePrefsModal={() => ui.setModals((m) => ({ ...m, prefs: false }))}
        onCopyJson={() => { void navigator.clipboard?.writeText(JSON.stringify(map, null, 2)); onNotify('ok', 'Copied JSON'); }}
        onDownloadGlb={() => c.handleSave(true)}
        onCloseJsonModal={() => ui.setModals((m) => ({ ...m, json: false }))}
      />
    </div>
  );
}
