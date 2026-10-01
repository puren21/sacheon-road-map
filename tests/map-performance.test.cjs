const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
function source(name) {
  let start = html.indexOf(`      function ${name}(`);
  if (start < 0) start = html.indexOf(`      async function ${name}(`);
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
  const c = { mapStrokePx: x=>x, INITIAL_MAP_LEVEL: 7, mapInteracting: false, mapIdleTimer: null, mapRefreshFrame: null,
    deferredRoadRestoreToken: 0, windowsDragFastMode: false, windowsZoomFastMode: false,
    zoomLightMode: false, zoomRestoreTimer: null, windowsPanPrepared: false, IS_WINDOWS: windows,
    townshipStartMode: true, townshipStartCompleted: false, isSkyViewMode: false,
    currentScaleDenominator: 60000, townshipSelectGroups: [group], activeTownshipHoverGroup: null,
    selectedTownshipName: null, selectedRoadGroupKey: null, allRoads: [], removeSelectedRouteBalloon() {},
    LAYERS: { city: { visible: true, labels: [{ overlay: overlay(), _visible: true }] } },
    BOUNDARY_LAYERS: { townshipBoundary: { visible: false, detailLoaded: true, overviewShapes: group.polygons, maxScale: Infinity, shapes: [overlay()] }, riBoundary: { visible: true, maxScale: 75000, shapes: [overlay()] } },
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
      for (const item of c.BOUNDARY_LAYERS.townshipBoundary.shapes) assert.equal(item.getMap(),c.map);
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
test('unchanged road paths are sent once; forced in-place edits and tier changes still update',()=>{
  const c={};vm.createContext(c);vm.runInContext(source('setRoadLinePathIfChanged'),c);
  let writes=0;const line={setPath(){writes++}},fine=[1,2],coarse=[1];
  for(let i=0;i<100;i++)c.setRoadLinePathIfChanged(line,fine);
  assert.equal(writes,1);fine.push(3);c.setRoadLinePathIfChanged(line,fine,true);assert.equal(writes,2);
  c.setRoadLinePathIfChanged(line,coarse);c.setRoadLinePathIfChanged(line,fine);assert.equal(writes,4);
});
test('visible label position survives panning, but zoom and geometry replacement invalidate it',()=>{
  let scans=0;const point={id:'candidate'},base={id:'base'},path=[{},{}],group={paths:[path]};
  const c={groups:new Map([['g',group]]),map:{level:6,getLevel(){return this.level},getCenter(){return {}}},nearestPointOnSegmentForLabel(){scans++;return point},distanceMeters(){return 1}};
  vm.createContext(c);vm.runInContext(source('getVisibleLabelPosition'),c);
  const item={groupKey:'g',basePosition:base};const bounds={contain:p=>p===point};
  assert.equal(c.getVisibleLabelPosition(item,bounds),point);assert.equal(scans,1);
  for(let i=0;i<100;i++)c.getVisibleLabelPosition(item,bounds);assert.equal(scans,1);
  c.map.level=5;c.getVisibleLabelPosition(item,bounds);assert.equal(scans,2);
  group.paths[0]=[{},{}];c.getVisibleLabelPosition(item,bounds);assert.equal(scans,3);
  c.getVisibleLabelPosition(item,{contain:()=>false});assert.equal(scans,4);
});
test('label measurements cache actual size and invalidate on style/text changes',()=>{
  let reads=0;const el={textContent:'101',getBoundingClientRect(){reads++;return {width:32,height:20}}};
  const c={map:{getProjection:()=>({containerPointFromCoords:()=>({x:100,y:100})})},groups:new Map([['g',{number:101,layerId:'city'}]])};vm.createContext(c);vm.runInContext(source('getRoadLabelCollisionBox'),c);
  const item={groupKey:'g',element:el};const box=c.getRoadLabelCollisionBox(item,{},'style1');assert.equal(box.left,79);
  for(let i=0;i<100;i++)c.getRoadLabelCollisionBox(item,{},'style1');assert.equal(reads,1);
  c.getRoadLabelCollisionBox(item,{},'style2');assert.equal(reads,2);
  el.textContent='102';c.getRoadLabelCollisionBox(item,{},'style2');assert.equal(reads,3);
});
test('zero-size label measurements are not cached',()=>{
  let reads=0;const el={textContent:'1',getBoundingClientRect(){reads++;return {width:0,height:0}}};
  const c={map:{getProjection:()=>({containerPointFromCoords:()=>({x:0,y:0})})},groups:new Map()};vm.createContext(c);vm.runInContext(source('getRoadLabelCollisionBox'),c);
  const item={element:el};c.getRoadLabelCollisionBox(item,{},'a');c.getRoadLabelCollisionBox(item,{},'a');assert.equal(reads,2);assert.equal(item._measuredSize,undefined);
});
test('cached overlapping labels are rejected without reattachment or layout reads',()=>{
  const {c}=setup();let reads=0;const position={equals:()=>true};
  const labels=['a','b'].map(key=>({groupKey:key,statusKeys:['open'],overlay:{...overlay(),getPosition:()=>position,setPosition(){}},element:{textContent:key,getBoundingClientRect(){reads++;return {width:30,height:20}}}}));
  Object.assign(c,{roadGeometryEditState:null,LABEL_STYLES:{VISIBLE:true},hiddenRoadGroups:new Set(),roadStatusFilters:{open:true},groups:new Map(labels.map(item=>[item.groupKey,{number:item.groupKey,layerId:'city',roads:[{_visible:true}]}])),isRoadLayerVisibleAtScale:()=>true,isRoadGroupKindVisible:()=>true,getVisibleLabelPosition:()=>position,getMapResolutionScale:()=>1,applyLabelScale(){},applyLabelAppearance(){}});
  c.LAYERS.city.labels=labels;c.map.getBounds=()=>({});c.map.getProjection=()=>({containerPointFromCoords:()=>({x:50,y:50})});
  for(const name of ['getRoadLabelCollisionBox','roadLabelBoxesOverlap','updateLabels'])vm.runInContext(source(name),c);
  c.updateLabels();assert.equal(reads,2);assert.equal(labels[0].overlay.getMap(),c.map);assert.equal(labels[1].overlay.getMap(),null);
  const rejectedWrites=labels[1].overlay.writes;c.updateLabels();assert.equal(reads,2);assert.equal(labels[1].overlay.writes,rejectedWrites);
  c.LABEL_STYLES.SCALE=150;c.updateLabels();assert.equal(reads,4);
});
test('automatic overview and manual original lines never render together',()=>{
  const {c}=setup();const layer=c.BOUNDARY_LAYERS.townshipBoundary;
  for(const level of [6,7,9]){
    c.map.level=level;layer.visible=false;c.updateBoundaryVisibility();
    assert.equal(layer.overviewShapes[0].getMap(),level>=7?c.map:null);assert.equal(layer.shapes[0].getMap(),null);
    layer.visible=true;c.updateBoundaryVisibility();assert.equal(layer.overviewShapes[0].getMap(),null);assert.equal(layer.shapes[0].getMap(),c.map);
  }
});
test('detail fetch is lazy, deduplicated, and respects OFF before load completes',async()=>{
  const {c}=setup();const layer=c.BOUNDARY_LAYERS.townshipBoundary;layer.detailLoaded=false;layer.shapes=[];
  let resolve,fetches=0;Object.assign(c,{fetchFirstAvailableGeoJSON(){fetches++;return new Promise(r=>resolve=r)},addTownshipBoundaryLines(f,target){target.push(overlay())}});
  vm.runInContext(source('loadDetailedTownshipBoundary'),c);
  assert.equal(fetches,0);layer.visible=true;const first=c.loadDetailedTownshipBoundary(),second=c.loadDetailedTownshipBoundary();assert.equal(fetches,1);
  layer.visible=false;resolve({data:{features:[{}]}});await Promise.all([first,second]);assert.equal(layer.shapes[0].getMap(),null);assert.equal(layer.detailLoaded,true);
  await c.loadDetailedTownshipBoundary();assert.equal(fetches,1);
});
test('detail load failures allow retry',async()=>{
  const {c}=setup();const layer=c.BOUNDARY_LAYERS.townshipBoundary;layer.detailLoaded=false;let attempts=0;
  Object.assign(c,{fetchFirstAvailableGeoJSON:async()=>{if(++attempts===1)throw Error('network');return {data:{features:[]}}},addTownshipBoundaryLines(){}});
  vm.runInContext(source('loadDetailedTownshipBoundary'),c);
  await assert.rejects(c.loadDetailedTownshipBoundary());assert.equal(layer.detailLoadingPromise,null);await c.loadDetailedTownshipBoundary();assert.equal(attempts,2);
});
test('township display creates only lines and area selection respects holes',()=>{
  for(const name of ['addTownshipSelectorFeature','addTownshipBoundaryLines','setTownshipGroupStyle'])assert.doesNotMatch(source(name),/new kakao\.maps\.Polygon|fillColor|fillOpacity/);
  const outer=[[0,0],[10,0],[10,10],[0,10],[0,0]],hole=[[4,4],[6,4],[6,6],[4,6],[4,4]];
  const c={townshipSelectGroups:new Map([['A',{name:'A',bounds:{contain:()=>true},selectionParts:[[outer,hole]]}]])};vm.createContext(c);
  for(const name of ['pointInRing','findTownshipAtPosition'])vm.runInContext(source(name),c);
  const pos=(x,y)=>({getLng:()=>x,getLat:()=>y});assert.equal(c.findTownshipAtPosition(pos(1,1)),'A');assert.equal(c.findTownshipAtPosition(pos(5,5)),null);assert.equal(c.findTownshipAtPosition(pos(11,11)),null);
});
test('generated lines have no duplicate segments and manual detail preserves every original segment',()=>{
  const root=require('node:path').join(__dirname,'..');
  const read=name=>JSON.parse(fs.readFileSync(require('node:path').join(root,name),'utf8'));
  function edges(data,linesOnly){const counts=new Map();for(const f of data.features){const g=f.geometry;if(linesOnly&&!g.type.includes('LineString'))continue;const paths=g.type==='LineString'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates.flat():g.coordinates;for(const path of paths)for(let i=1;i<path.length;i++){const a=JSON.stringify(path[i-1]),b=JSON.stringify(path[i]);if(a===b)continue;const k=[a,b].sort().join('|');counts.set(k,(counts.get(k)||0)+1)}}return counts}
  const original=read('Township Boundary.geojson'),detail=read('township_detail_lines.geojson'),overview=read('township_overview.geojson');
  const sourceEdges=edges(original,false),detailEdges=edges(detail,true),overviewEdges=edges(overview,true);
  assert.deepEqual(new Set(detailEdges.keys()),new Set(sourceEdges.keys()));
  for(const count of [...detailEdges.values(),...overviewEdges.values()])assert.equal(count,1);
  assert.ok(overviewEdges.size<sourceEdges.size*0.05);
  assert.ok(detail.features.every(f=>f.geometry.type.includes('LineString')));
  const names=data=>new Set(data.features.filter(f=>f.geometry.type.includes('Polygon')).map(f=>JSON.stringify(f.properties)));
  assert.deepEqual(names(overview),names(original));
});
test('legend follows edited colors, line visibility and skyview without rebuilding unchanged samples',()=>{
  const elements=Object.fromEntries(['legendCity','legendMyeon','legendRi','legendFarm'].map(id=>[id,{style:{},children:[],writes:0,replaceChildren(){this.children=[];this.writes++},appendChild(node){this.children.push(node)}}]));
  const stack=[{color:'#123456',skyColor:'#ffffff',width:4,opacity:80,visible:true,lineStyle:'dash'}];
  const c={isSkyViewMode:false,getRoadLayerStack:()=>stack,document:{getElementById:id=>elements[id],createElementNS:()=>({attrs:{},setAttribute(k,v){this.attrs[k]=v}})}};
  vm.createContext(c);for(const name of ['getRoadLayerDisplayColor','updateLegendStyles'])vm.runInContext(source(name),c);
  c.updateLegendStyles();assert.equal(elements.legendCity.children[0].attrs.stroke,'#123456');assert.equal(elements.legendCity.children[0].attrs['stroke-dasharray'],'8 5');
  c.updateLegendStyles();assert.equal(elements.legendCity.writes,1);
  c.isSkyViewMode=true;c.updateLegendStyles();assert.equal(elements.legendCity.children[0].attrs.stroke,'#ffffff');
  stack[0].visible=false;c.updateLegendStyles();assert.equal(elements.legendCity.style.opacity,'0.35');
});
