const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
function source(name) {
  const start = html.indexOf(`      function ${name}(`);
  assert.ok(start >= 0, name);
  return html.slice(start, html.indexOf('\n      }', start) + 8);
}
function overlay() {
  return { current: null, writes: 0, optionsWrites: 0,
    getMap() { return this.current; }, setMap(target) { this.current = target; this.writes++; },
    setOptions(options) { Object.assign(this, options); this.optionsWrites++; } };
}
function setup(windows = false) {
  const jobs = new Map(), frames = new Map(); let id = 0;
  const group = { polygons: [overlay()], skyBackPolygons: [overlay()], hitPolygons: [overlay()], label: overlay(), hoverDismissed: false };
  const c = { INITIAL_MAP_LEVEL: 7, mapInteracting: false, mapIdleTimer: null, mapRefreshFrame: null,
    deferredRoadRestoreToken: 0, windowsDragFastMode: false, windowsZoomFastMode: false,
    zoomLightMode: false, zoomRestoreTimer: null, windowsPanPrepared: false, IS_WINDOWS: windows,
    townshipStartMode: true, townshipStartCompleted: false, isSkyViewMode: false,
    currentScaleDenominator: 60000, townshipSelectGroups: [group], activeTownshipHoverGroup: null,
    selectedTownshipName: null, selectedRoadGroupKey: null, allRoads: [], removeSelectedRouteBalloon() {},
    LAYERS: { city: { visible: true, labels: [{ overlay: overlay(), _visible: true }] } },
    BOUNDARY_LAYERS: { townshipBoundary: { visible: false, maxScale: Infinity, shapes: [overlay()] }, riBoundary: { visible: true, maxScale: 75000, shapes: [overlay()] } },
    map: { level: 7, getLevel() { return this.level; }, setCursor() {} },
    resetTownshipStyles() {}, setTownshipGroupStyle() {},
    document: { body: { classList: { add() {}, remove() {} } } },
    setTimeout(fn) { jobs.set(++id, fn); return id; }, clearTimeout(key) { jobs.delete(key); },
    requestAnimationFrame(fn) { frames.set(++id, fn); return id; }, cancelAnimationFrame(key) { frames.delete(key); },
    refreshes: 0, refreshMapAfterInteraction() { c.refreshes++; c.updateBoundaryVisibility(); },
    isSkyExtraZoomActive() { return false; },
    setWindowsZoomFastMode(on) { c.windowsZoomFastMode = on; },
    setRoadZoomLightMode(on) { c.zoomLightMode = on; }, hideAllRoadsForWindowsPan() {},
    kakao: { maps: { event: { addListener(target, event, fn) { c.events[event] = fn; } } } }, events: {},
    window: { addEventListener() {} }
  };
  vm.createContext(c);
  for (const name of ['shouldAutoShowTownshipBoundary','setMapOptionsIfChanged','setOverlayMapIfChanged','syncTownshipBoundaryDisplay','updateBoundaryVisibility','hideLayerLabelsForInteraction','hideBoundaryLayersForInteraction','cancelMapRefresh','beginMapInteraction','scheduleMapRefresh']) vm.runInContext(source(name), c);
  const a = html.indexOf('      kakao.maps.event.addListener(map, "zoom_start"');
  const b = html.indexOf('      let resizeRefreshTimer', a);
  vm.runInContext(html.slice(a,b), c);
  const flush = queue => { const pending = [...queue.values()]; queue.clear(); pending.forEach(fn => fn()); };
  return { c, group, jobs, frames, timers: () => flush(jobs), paint: () => flush(frames) };
}
test('all inline scripts parse', () => {
  for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(m[1]);
});
for (const windows of [false, true]) {
  const platform = windows ? 'Windows Chromium branch' : 'mobile/non-Windows branch';
  test(`${platform}: zoom detaches automatic boundary immediately and restores level 7 and more zoomed-out views`, () => {
    const {c,group,timers,paint} = setup(windows);
    c.updateBoundaryVisibility(); assert.equal(group.polygons[0].getMap(),c.map);
    for (const level of [6, 8, 10, 7]) {
      c.events.zoom_start(); c.map.level=level; c.events.zoom_changed();
      assert.equal(group.polygons[0].getMap(),null);
      assert.equal(group.hitPolygons[0].getMap(),null);
      c.events.idle(); timers(); paint();
      assert.equal(group.polygons[0].getMap(),level>=7?c.map:null);
    }
  });
  test(`${platform}: manual ON remains attached during zoom and drag, OFF resumes automatic rule`, () => {
    const {c,group,timers,paint} = setup(windows);
    c.BOUNDARY_LAYERS.townshipBoundary.visible=true; c.isSkyViewMode=true; c.updateBoundaryVisibility();
    for (const level of [4, 7, 11]) {
      c.events.zoom_start(); c.map.level=level; c.events.zoom_changed(); c.events.dragstart();
      for (const item of [...group.polygons,...group.skyBackPolygons,...c.BOUNDARY_LAYERS.townshipBoundary.shapes]) assert.equal(item.getMap(),c.map);
      assert.equal(group.hitPolygons[0].getMap(),null);
      c.events.idle();timers();paint();
    }
    c.BOUNDARY_LAYERS.townshipBoundary.visible=false;c.updateBoundaryVisibility();assert.equal(group.polygons[0].getMap(),c.map);
    c.map.level=6;c.updateBoundaryVisibility();assert.equal(group.polygons[0].getMap(),null);
  });
}
test('completed township selection does not regain hit polygons at level 7', () => {
  const {c,group}=setup();c.townshipStartCompleted=true;c.updateBoundaryVisibility();
  assert.equal(group.polygons[0].getMap(),c.map);assert.equal(group.hitPolygons[0].getMap(),null);
});
test('repeated idle coalesces to one timer and one animation frame', () => {
  const {c,jobs,frames,timers,paint}=setup();
  for(let i=0;i<100;i++)c.events.idle();assert.equal(jobs.size,1);timers();assert.equal(frames.size,1);paint();assert.equal(c.refreshes,1);
});
test('new gesture cancels both pending timer and frame', () => {
  const {c,jobs,frames,timers,paint}=setup();c.events.idle();c.events.dragstart();assert.equal(jobs.size,0);
  c.events.idle();timers();c.events.zoom_start();assert.equal(frames.size,0);paint();assert.equal(c.refreshes,0);
  c.events.idle();timers();paint();assert.equal(c.refreshes,1);
});
test('continuous bounds events never scan layers and cancel a stale frame', () => {
  const {c,frames,timers}=setup();c.events.idle();timers();
  c.hideBoundaryLayersForInteraction=()=>assert.fail('heavy boundary work');
  for(let i=0;i<100;i++)c.events.bounds_changed();assert.equal(frames.size,0);assert.equal(c.refreshes,0);
});
test('unchanged layer assignments and options do not touch renderer', () => {
  const {c,group}=setup();c.updateBoundaryVisibility();const writes=group.polygons[0].writes;c.updateBoundaryVisibility();assert.equal(group.polygons[0].writes,writes);
  const shape=overlay();c.setMapOptionsIfChanged(shape,{strokeWeight:3,strokeColor:'red'});c.setMapOptionsIfChanged(shape,{strokeWeight:3});assert.equal(shape.optionsWrites,1);
  c.setMapOptionsIfChanged(shape,{strokeWeight:2});c.setMapOptionsIfChanged(shape,{strokeWeight:3});assert.equal(shape.optionsWrites,3);assert.equal(shape.strokeColor,'red');
});
test('staged restore honors kind, status and viewport filters', () => {
  const {c}=setup();Object.assign(c,{roadStatusFilters:{open:true,closed:false},isRoadLayerVisibleAtScale:()=>true,isRoadObjectKindVisible:r=>r.kind,isRoadStatusHidden:r=>r==='hidden',extentIntersectsViewport:e=>e});
  vm.runInContext(source('roadShouldBeVisibleNow'),c);
  const road={layerId:'city',statusKey:'open',kind:true,extent:true};assert.equal(c.roadShouldBeVisibleNow(road,{}),true);
  for(const patch of [{kind:false},{extent:false},{statusKey:'closed'}]) assert.equal(c.roadShouldBeVisibleNow({...road,...patch},{}),false);
});
test('heavy road and label functions return while a gesture is active',()=>{
  const {c}=setup();c.mapInteracting=true;c.roadGeometryEditState=null;
  for(const name of ['applyRoadVisibility','updateLabels']) {vm.runInContext(source(name),c);c[name]();}
});
test('interaction refresh does not rebuild route list or parse GeoJSON',()=>{
  for(const name of ['refreshMapAfterInteraction','restoreRoadsInStages','applyRoadVisibility','updateLabels']) assert.doesNotMatch(source(name),/makeLists\(|makeLayerList\(|JSON\.parse\(|fetch\(/);
});
for(const windows of [false,true]) test(`full refresh restores boundary/labels after drag (${windows?'Windows':'mobile'})`,()=>{
  const {c,group,timers,paint}=setup(windows);let labels=0,roads=0;
  Object.assign(c,{updateScale(){},applyRoadVisibility(){roads++},updateLabels(){labels++},restoreRoadsInStages(){roads++;labels++},updateTownshipLabelVisibility(){group.label.setMap(c.map)},updateSelectedRouteBalloon(){},restoreSelectedRoadPopup(){},basePlaceOverlay:null});
  vm.runInContext(source('restoreInteractionLayers')+'\n'+source('refreshMapAfterInteraction'),c);
  c.updateBoundaryVisibility();c.events.dragstart();assert.equal(group.label.getMap(),null);c.events.idle();timers();paint();
  assert.equal(roads,1);assert.equal(labels,1);assert.equal(group.polygons[0].getMap(),c.map);assert.equal(group.label.getMap(),c.map);assert.equal(c.windowsDragFastMode,false);
});
test('staged restore retains dimmed OFF routes and cannot restore stale hits during a new gesture',()=>{
  const {c,paint}=setup(true);const lines=[overlay(),overlay()],hit=overlay();
  const road={groupKey:'off',styleKey:'city',layerId:'city',statusKey:'open',kind:true,extent:true,visualLines:lines,hitLine:hit};
  Object.assign(c,{allRoads:[road],hiddenRoadGroups:new Set(['off']),roadStatusFilters:{open:true},getBufferedViewportBox:()=>({}),getRoadScaleTier:()=>1,getRoadPathTier:()=>1,getRoadVisualLines:r=>r.visualLines,getRoadLayerStack:()=>[{},{}],mapStrokePx:x=>x,isRoadLayerVisibleAtScale:()=>true,isRoadObjectKindVisible:r=>r.kind,isRoadStatusHidden:()=>false,extentIntersectsViewport:e=>e,applyRoadPathTier(){},applyRoadNormalVisualStyle(){},updateLabels(){}});
  for(const name of ['roadShouldBeVisibleNow','applyRoadLineVisibility','restoreRoadsInStages'])vm.runInContext(source(name),c);
  c.restoreRoadsInStages();assert.equal(lines[0].strokeColor,'#6f7f95');assert.equal(lines[1].getMap(),null);assert.equal(hit.getMap(),null);
  c.beginMapInteraction();paint();assert.equal(hit.getMap(),null);
});
test('overview excludes both road layers at startup and at every level >= 7',()=>{
  const {c}=setup();vm.runInContext(source('isRoadLayerVisibleAtScale'),c);
  for(const scale of [null,20000,60000,100000])for(const level of [7,8,10,14]){
    c.currentScaleDenominator=scale;c.map.level=level;
    for(const layer of ['city','rural'])assert.equal(c.isRoadLayerVisibleAtScale(layer),false);
  }
  c.map.level=6;c.currentScaleDenominator=30000;
  for(const layer of ['city','rural'])assert.equal(c.isRoadLayerVisibleAtScale(layer),true);
});
test('overview shows township and dong names regardless of denominator',()=>{
  const {c}=setup();vm.runInContext(source('shouldShowTownshipLabel'),c);
  for(const level of [7,8,12]) {c.map.level=level;c.currentScaleDenominator=200000;for(const name of ['사천읍','정동면','동서동'])assert.equal(c.shouldShowTownshipLabel(name),true);}
});
test('zooming out immediately removes roads and labels before idle',()=>{
  const {c}=setup();const line=overlay();line.setMap(c.map);const road={_visible:true};c.allRoads=[road];
  c.setRoadObjectMap=(r,visible)=>{r._visible=visible;line.setMap(visible?c.map:null)};
  c.LAYERS.city.labels[0].overlay.setMap(c.map);c.map.level=7;c.events.zoom_changed();
  assert.equal(line.getMap(),null);assert.equal(road._visible,false);assert.equal(c.LAYERS.city.labels[0].overlay.getMap(),null);
});
test('route styling cannot reattach an OFF route in overview',()=>{
  const {c}=setup();const line=overlay(),hit=overlay();line.setMap(c.map);hit.setMap(c.map);
  const road={_visible:true,layerId:'city',groupKey:'off',statusKey:'open',hitLine:hit};
  Object.assign(c,{hiddenRoadGroups:new Set(['off']),getRoadLayerStack:()=>[{}],getRoadVisualLines:()=>[line],isRoadStatusHidden:()=>false});
  for(const name of ['isRoadLayerVisibleAtScale','applyRoadLineVisibility'])vm.runInContext(source(name),c);
  c.applyRoadLineVisibility(road);assert.equal(line.getMap(),null);assert.equal(hit.getMap(),null);
});
