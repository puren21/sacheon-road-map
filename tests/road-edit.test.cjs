const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
function source(name) {
  let start = html.indexOf(`      function ${name}(`);
  if (start < 0) start = html.indexOf(`      async function ${name}(`);
  assert.ok(start >= 0, name);
  return html.slice(start, html.indexOf('\n      }', start) + 8);
}
function context(names, extras = {}) {
  const sandbox = Object.assign({ Number, console }, extras);
  vm.createContext(sandbox);
  for (const name of names) vm.runInContext(source(name), sandbox);
  return sandbox;
}

test('vertex plus stays at the middle of the hovered segment while line clicks keep their position', () => {
  class LatLng {
    constructor(lat, lng) { this.lat = lat; this.lng = lng; }
    getLat() { return this.lat; }
    getLng() { return this.lng; }
  }
  const projection = { containerPointFromCoords: p => ({ x: p.getLng(), y: p.getLat() }) };
  const state = { mode: 'vertex', workingPath: [new LatLng(0, 0), new LatLng(0, 100)],
    draft: { checkpoint() {} }, previewLine: { setPath() {} }, previewHitLine: { setPath() {} } };
  const overlays = [];
  const c = context(['getGeometrySegmentMidpointInfo', 'showGeometryHoverPlus', 'roadGeometryAddVertex'], {
    map: { getProjection: () => projection }, kakao: { maps: {
      LatLng, CustomOverlay: class {
        constructor(options) { this.position = options.position; overlays.push(this); }
        setPosition(position) { this.position = position; }
        setMap() {}
      }
    } },
    document: { createElement: () => ({ addEventListener() {} }) },
    clearTimeout() {}, hideGeometryHoverPlus() {}, rebuildRoadGeometryEditMarkers() {}
  });
  c.showGeometryHoverPlus(state, new LatLng(0, 8));
  assert.equal(overlays[0].position.getLng(), 50);
  c.showGeometryHoverPlus(state, new LatLng(0, 92));
  assert.equal(overlays[0].position.getLng(), 50);
  c.roadGeometryAddVertex(state, new LatLng(0, 25));
  assert.equal(state.workingPath[1].getLng(), 25);
  state.workingPath = [new LatLng(0, 0), new LatLng(0, 20)];
  let hidden = false;
  c.hideGeometryHoverPlus = () => { hidden = true; };
  c.showGeometryHoverPlus(state, new LatLng(0, 10));
  assert.equal(hidden, true);
});

test('merge and join display a named action button once two segments are selected', () => {
  const button = { hidden: true, disabled: true, textContent: '' };
  const c = context(['updateRoadGeometryApplyButton'], {
    document: { getElementById: () => button }
  });
  const state = { mode: 'merge', selectedIndices: new Set([0]) };
  c.updateRoadGeometryApplyButton(state);
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, '선택한 라인 병합 (1개)');
  state.selectedIndices.add(1);
  c.updateRoadGeometryApplyButton(state);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, '선택한 라인 병합 (2개)');
  state.mode = 'join';
  c.updateRoadGeometryApplyButton(state);
  assert.equal(button.textContent, '선택한 라인 연결 (2개)');
  state.mode = 'select';
  c.updateRoadGeometryApplyButton(state);
  assert.equal(button.hidden, true);
  assert.match(html, /id="applyRoadGeometryBtn"[^>]*>선택한 라인 병합/);
  assert.match(html, /roadGeometryApplyTool\(state\.mode\)/);
});

test('city and rural road lengths display one decimal in km without changing stored units', () => {
  const c = context(['parseRoadLength', 'roadLengthKm', 'roadLengthInputValue',
    'roadLengthEditedValue', 'formatRoadLength']);
  assert.equal(c.roadLengthInputValue({ 연장: 4154 }, 'city'), '4.2');
  assert.equal(c.roadLengthInputValue({ 연장: '4.154' }, 'rural'), '4.2');
  assert.equal(c.roadLengthInputValue({ 연장: null }, 'city'), '');
  assert.equal(c.formatRoadLength(4154.364), '4,154.4');
  assert.equal(c.formatRoadLength(0), '0.0');
  assert.equal(c.roadLengthEditedValue('4.2', { 연장: 4154 }, 'city', '4.2'), 4154);
  assert.equal(c.roadLengthEditedValue('4.3', { 연장: 4154 }, 'city', '4.2'), 4300);
  assert.equal(c.roadLengthEditedValue('4.2', { 연장: 4.154 }, 'rural', '4.2'), 4.154);
});

test('both road types update shared properties while retaining city-specific fields', () => {
  const c = context(['applyRoadEditValuesToRoad'], {
    setPropertyValue(props, candidates, fallback, value) { props[candidates.find(k => k in props) || fallback] = value; }
  });
  const values = { lane: '2', width: '8', length: 4154, start: '새 기점', end: '새 종점', remark: '비고', extra: '기타', status: '개설', review: '검토', change: '변경' };
  const city = { properties: { 시점: '옛 기점', 개설여부: '미개설' } };
  c.applyRoadEditValuesToRoad({ layerId: 'city' }, city, values);
  assert.equal(city.properties.시점, city.properties.기점);
  assert.equal(city.properties.연장, 4154);
  assert.equal(city.properties.비고, '비고');
  assert.equal(city.properties.변경사항, '변경');
  const rural = { properties: { Opened: '미개설' } };
  c.applyRoadEditValuesToRoad({ layerId: 'rural' }, rural, { ...values, length: 4.154 });
  assert.equal(rural.properties.연장, 4.154);
  assert.equal(rural.properties.Opened, '개설');
  assert.equal(rural.properties.도로폭, '8');
});

for (const layerId of ['city', 'rural']) {
  test(`${layerId}: choosing one divided line highlights the entire route and distinguishes its segment`, () => {
    const makeLine = () => ({ current: null, getMap() { return this.current; },
      setMap(value) { this.current = value; } });
    const makeRoad = () => ({ styleKey: 'CITY', statusKey: 'OPEN', _visible: true,
      visualLines: [makeLine()], hitLine: makeLine() });
    const roads = [makeRoad(), makeRoad(), makeRoad()];
    const group = { key: 'route', layerId, roads };
    roads[0]._visible = layerId !== 'city';
    roads[2]._visible = layerId !== 'city';
    const map = {};
    const c = context(['setRoadGroupHighlight'], {
      groups: new Map([['route', group]]), selectedRoadObject: roads[1],
      hiddenRoadGroups: new Set(), geometryEditingGroupKey: null, map,
      getRoadLayerStack: () => [{ width: 3, opacity: 80 }],
      getRoadVisualLines: road => road.visualLines, isRoadStatusHidden: () => false,
      setMapOptionsIfChanged: (line, options) => Object.assign(line, options),
      mapStrokePx: value => value, getRoadLayerDisplayColor: () => '#009966',
      getRoadLayerStrokeStyle: () => 'dash'
    });
    c.setRoadGroupHighlight('route', true);
    assert.deepEqual(roads.map(road => road.visualLines[0].strokeColor),
      ['#0057FF', '#E60012', '#0057FF']);
    assert.deepEqual(roads.map(road => road.visualLines[0].getMap()),
      [map, map, map]);
    assert.ok(roads.every(road => road.visualLines[0].strokeStyle === 'solid'));
    c.selectedRoadObject = null;
    c.setRoadGroupHighlight('route', true);
    assert.deepEqual(roads.map(road => road.visualLines[0].strokeColor),
      ['#E60012', '#0057FF', '#0057FF']);
    c.setRoadGroupHighlight('route', false);
    assert.deepEqual(roads.map(road => road.visualLines[0].getMap()),
      layerId === 'city' ? [null, map, null] : [map, map, map]);
  });
}

test('city route 1 contains five connected parts that share one highlighted route', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../city_roads.geojson'), 'utf8'));
  const city1 = data.features.filter(feature => feature.properties.number === '1');
  assert.equal(city1.length, 1);
  assert.equal(city1[0].geometry.type, 'MultiLineString');
  assert.equal(city1[0].geometry.coordinates.length, 5);
});

test('city route 1 keeps the clicked location selected when online segments replace original parts', () => {
  class LatLng {
    constructor(lat, lng) { this.lat = lat; this.lng = lng; }
    getLat() { return this.lat; }
    getLng() { return this.lng; }
  }
  const oldRoads = Array.from({ length: 5 }, () => ({ groupKey: 'city::1' }));
  const group = { key: 'city::1', layerId: 'city', number: '1',
    roads: oldRoads, paths: [], propertiesList: [] };
  const anchorPosition = new LatLng(35, 128.095);
  const selectedRoadPopupState = { groupKey: group.key, road: oldRoads[0], anchorPosition };
  const segments = Array.from({ length: 11 }, (_, index) => ({ properties: { number: '1' },
    geometry: [[35, 128 + index * 0.01], [35, 128 + (index + 1) * 0.01]] }));
  const c = context(['replaceRoadGroupSegments', 'pointSegmentDistanceSq'], {
    selectedRoadObject: oldRoads[0], selectedRoadPopupState,
    kakao: { maps: { LatLng } }, removeRoadSegmentVisuals() {},
    drawRoad(path, properties, layerId, groupKey) { return { path, properties, layerId, groupKey }; },
    getColor() { return '#0a0'; }, getRoadStatusKey() { return 'OPEN'; }, recalcGroupBounds() {}
  });
  assert.equal(c.replaceRoadGroupSegments(group, segments), true);
  assert.equal(group.roads.length, 11);
  assert.equal(group.roads.indexOf(c.selectedRoadObject), 9);
  assert.equal(selectedRoadPopupState.road, c.selectedRoadObject);
});

test('unchanged online route geometry does not replace lines again on each click', async () => {
  const group = { key: 'city::1' };
  const payload = { version: 3, segmentModel: roadSegments(true) };
  const signatures = new Map();
  let redraws = 0;
  const c = context(['syncOnlineRoadEdits'], {
    groups: new Map([[group.key, group]]), appliedOnlineRoadEditSignatures: signatures,
    fetchOnlineRoadEdits: async () => structuredClone(payload),
    applyOnlineRoadEdits(_group, data) {
      redraws++;
      signatures.set(group.key, JSON.stringify(data));
      return true;
    }
  });
  assert.equal(await c.syncOnlineRoadEdits(group.key), true);
  assert.equal(await c.syncOnlineRoadEdits(group.key), false);
  assert.equal(redraws, 1);
});

for (const layerId of ['city', 'rural']) {
  test(`${layerId}: online save failure does not show an unsaved attribute edit`, async () => {
    const group = { layerId, number: '3', roads: [{ properties: { 연장: layerId === 'city' ? 4154 : '4.154' } }] };
    const saveButton = { disabled: false, textContent: '저장' };
    let applied = false;
    let notified = false;
    const formData = { status: '개설', lane: '2', width: '8', length: '4.154', start: '새 기점', end: '새 종점', remark: '비고', extra: '기타', gubun: '면도' };
    const c = context(['saveRoadAttributes', 'roadLengthEditedValue'], {
      groups: new Map([['road', group]]), getEditableRoad: () => group.roads[0], roadGeometryEditState: null,
      document: { getElementById: id => id === 'roadEditForm' ? {} : saveButton, body: { contains: () => true } },
      FormData: class { get(key) { return formData[key] || ''; } },
      fetchOnlineRoadEdits: async () => null,
      saveOnlineRoadEdits: async () => { throw new Error('offline'); },
      applyOnlineRoadEdits: () => { applied = true; },
      alert: () => { notified = true; }, console: { error() {} }
    });
    await c.saveRoadAttributes('road');
    assert.equal(applied, false);
    assert.equal(notified, true);
    assert.equal(saveButton.disabled, false);
    assert.equal(group.roads[0].properties.연장, layerId === 'city' ? 4154 : '4.154');
  });
}

test('structural line edits save a complete model only after server acknowledgement', async () => {
  const draft = new RoadLineDraft(roadSegments(true), 'city');
  draft.split([point(5, -5), point(5, 5)]);
  const group = { layerId: 'city', number: '3', key: 'city::3', roads: [{}, {}] };
  const state = { group, draft, mode: 'split', capture: [], baselineModel: JSON.stringify(roadSegments(true)) };
  const button = { disabled: false, textContent: '저장' };
  let persisted = null, changed = false, cleared = false, reentered = false;
  const c = context(['saveRoadGeometryEdit'], {
    roadGeometryEditState: state, selectedRoadPopupState: null, selectedRoadObject: null,
    document: { getElementById: () => button, querySelector: () => null },
    roadGeometrySyncWorkingPath: () => {}, roadGeometryCommitForm: () => {}, fetchOnlineRoadEdits: async () => ({ roads: { 0: { review: '이전 값' } }, geometries: { 0: [[35, 128], [35, 129]] } }),
    saveOnlineRoadEdits: async (_, payload) => { assert.equal(changed, false); persisted = structuredClone(payload); },
    clearRoadGeometryEdit: () => { cleared = true; c.roadGeometryEditState = null; },
    applyOnlineRoadEdits: () => { assert.equal(cleared, true); changed = true; return true; },
    startRoadGeometryEdit: async () => { reentered = true; },
    alert: message => { throw new Error(message); }, console: { error() {} }
  });
  assert.equal(await c.saveRoadGeometryEdit(), true);
  assert.equal(persisted.version, 3);
  assert.equal(persisted.segmentModel.length, 3);
  assert.deepEqual(persisted.roads, {});
  assert.deepEqual(persisted.geometries, {});
  assert.equal(changed, true);
  assert.equal(reentered, true);
});

test('failed line save keeps the editable draft and leaves map segments untouched', async () => {
  const draft = new RoadLineDraft(roadSegments(false), 'rural');
  draft.add([point(20), point(30)]);
  const group = { layerId: 'rural', number: '3', key: 'rural::3', roads: [{}, {}] };
  const state = { group, draft, mode: 'add', capture: [], baselineModel: JSON.stringify(roadSegments(false)) };
  let applied = false, cancelled = false, alerted = false;
  const c = context(['saveRoadGeometryEdit'], {
    roadGeometryEditState: state,
    document: { getElementById: () => ({ disabled: false, textContent: '' }) },
    roadGeometrySyncWorkingPath: () => {}, roadGeometryCommitForm: () => {}, fetchOnlineRoadEdits: async () => null,
    saveOnlineRoadEdits: async () => { throw new Error('offline'); },
    clearRoadGeometryEdit: () => { cancelled = true; },
    applyOnlineRoadEdits: () => { applied = true; },
    alert: () => { alerted = true; }, console: { error() {} }
  });
  assert.equal(await c.saveRoadGeometryEdit(), false);
  assert.equal(group.roads.length, 2);
  assert.equal(draft.serialize().length, 3);
  assert.equal(applied, false);
  assert.equal(cancelled, false);
  assert.equal(alerted, true);
});

test('line editor opens the Gunsan-style tool set on the full-resolution segment', async () => {
  class LatLng {
    constructor(lat, lng) { this.lat = lat; this.lng = lng; }
    getLat() { return this.lat; }
    getLng() { return this.lng; }
  }
  class Polyline {
    constructor(options) { this.path = options.path; this.map = options.map; }
    getMap() { return this.map; }
    setMap(map) { this.map = map; }
    setPath(path) { this.path = path; }
  }
  const path = [new LatLng(...point(0)), new LatLng(...point(5)), new LatLng(...point(10))];
  const road = { pathFine: [path[0], path[2]], properties: { number: '3', 연장: 1000 }, groupKey: 'city::3' };
  const group = { key: 'city::3', number: '3', layerId: 'city', roads: [road], paths: [path] };
  const elements = { applyRoadGeometryBtn: {}, finishRoadGeometryCaptureBtn: {}, roadLineSnapBtn: {
    classList: { toggle() {} }, setAttribute() {}
  } };
  let appliedMode = null;
  let toolbar;
  const c = context(['startRoadGeometryEdit'], {
    roadGeometryEditState: null, geometryEditingGroupKey: null, groups: new Map([[group.key, group]]),
    getEditableRoad: () => road, syncOnlineRoadEdits: async () => false,
    roadGroupSegmentModel: () => [{ properties: { ...road.properties }, geometry: path.map(p => [p.getLat(), p.getLng()]) }],
    focusSelectedRoadForEditing() {}, removeSelectedRouteBalloon() {}, updateLabels() {}, closeRoadEditPanel() {},
    rebuildRoadGeometryEditMarkers() {}, roadGeometryShowDraft() {}, cloneRoadEditPath: points => points.slice(),
    roadGeometryFinishCapture() {}, roadGeometryHistory() {}, roadGeometryApplyTool(mode) { appliedMode = mode; },
    roadGeometrySnapEnabled: () => true,
    setRoadGeometryEditMode() {}, roadGeometryHelp() {},
    getRoadVisualLines: () => [new Polyline({ path, map: {} })],
    map: { setCursor() {} },
    document: {
      createElement: () => ({ querySelectorAll: () => [], id: '', className: '', innerHTML: '' }),
      body: { appendChild: element => { toolbar = element; } },
      getElementById: id => elements[id],
      addEventListener() {}
    },
    kakao: { maps: { LatLng, Polyline, event: { addListener() {} } } },
    window: { SacheonLineGeometry: require('../road-line-geometry.js'), SacheonLineDraft: RoadLineDraft },
    alert: message => { throw Error(message); }
  });
  await c.startRoadGeometryEdit(group.key);
  assert.equal(c.roadGeometryEditState.workingPath.length, 3);
  assert.equal(c.roadGeometryEditState.mode, 'select');
  for (const name of ['select', 'vertex', 'add', 'split', 'multi', 'merge', 'join', 'delete', 'undo', 'redo']) {
    assert.ok(toolbar.innerHTML.includes(`data-line-mode="${name}"`), name);
  }
  assert.equal(typeof elements.finishRoadGeometryCaptureBtn.onclick, 'function');
  assert.equal(typeof elements.applyRoadGeometryBtn.onclick, 'function');
  assert.equal(typeof elements.roadLineSnapBtn.onclick, 'function');
  c.roadGeometryEditState.mode = 'merge';
  elements.applyRoadGeometryBtn.onclick();
  assert.equal(appliedMode, null);
  c.roadGeometryEditState.selectedIndices.add(1);
  elements.applyRoadGeometryBtn.onclick();
  assert.equal(appliedMode, 'merge');
});

test('line selection replaces a single choice and Shift adds or removes choices', () => {
  const selected = [];
  const segments = roadSegments(true);
  const state = { groupKey: 'city::3', group: { number: '3' }, mode: 'select',
    draft: { segments, selected: 0 },
    selectedIndices: new Set([0]) };
  const c = context(['roadGeometrySelectSegment'], {
    roadGeometryEditState: state,
    roadGeometrySetActiveSegment(_state, index) { selected.push(index); state.draft.selected = index; },
    roadGeometryShowDraft() {}, roadGeometryHelp() {}, updateRoadGeometryApplyButton() {}
  });
  c.roadGeometrySelectSegment(1, null, { shiftKey: false });
  assert.deepEqual([...state.selectedIndices], [1]);
  c.roadGeometrySelectSegment(0, null, { shiftKey: true });
  assert.deepEqual([...state.selectedIndices], [1, 0]);
  c.roadGeometrySelectSegment(1, null, { shiftKey: true });
  assert.deepEqual([...state.selectedIndices], [0]);
  state.modifierDown = true;
  c.roadGeometrySelectSegment(1, null, null);
  assert.deepEqual([...state.selectedIndices], [0, 1]);
  assert.deepEqual(selected, [1, 0, 0, 1]);
});

test('newly split segments remain clickable before saving', () => {
  const draft = new RoadLineDraft(roadSegments(false), 'rural');
  draft.split([point(5, -5), point(5, 5)]);
  const callbacks = [];
  class Polyline { constructor(options) { this.options = options; } setMap(map) { this.options.map = map; } }
  const state = { draft, mode: 'select', selectedIndices: new Set([0]), draftOverlays: [], capture: [] };
  const c = context(['roadGeometryShowDraft'], {
    map: {}, kakao: { maps: { LatLng: class {}, Polyline,
      event: { addListener(_line, event, callback) { if (event === 'click') callbacks.push(callback); }, preventMap() {} } } },
    roadGeometrySelectSegment(index) { state.selectedIndices = new Set([index]); }
  });
  c.roadGeometryShowDraft(state);
  assert.equal(callbacks.length, 3);
  callbacks[1]({ latLng: point(7), domEvent: {} });
  assert.deepEqual([...state.selectedIndices], [1]);
});

test('vertex editing can follow a cut without an intermediate save', () => {
  const draft = new RoadLineDraft(roadSegments(false), 'rural');
  draft.split([point(5, -5), point(5, 5)]);
  const state = { draft, mode: 'split', structuralPending: true, selectedIndices: new Set([1]),
    capture: [], markers: [], previewLine: { setMap() {} }, previewHitLine: { setMap() {} } };
  let active = -1;
  const c = context(['setRoadGeometryEditMode'], {
    roadGeometryEditState: state, map: {},
    roadGeometrySyncWorkingPath() {}, hideGeometryHoverPlus() {},
    roadGeometrySetActiveSegment(_state, index) { active = index; },
    roadGeometryShowDraft() {}, roadGeometryHelp() {}, updateRoadGeometryApplyButton() {},
    document: { querySelectorAll: () => [] }
  });
  c.setRoadGeometryEditMode('vertex');
  assert.equal(state.mode, 'vertex');
  assert.equal(active, 1);
});

test('choosing another route switches editors only when the draft is saved', () => {
  const segments = roadSegments(false);
  const state = { groupKey: 'rural::3', mode: 'select', capture: [],
    draft: { segments }, baselineModel: JSON.stringify(segments) };
  const steps = [];
  const target = { road: true };
  const c = context(['roadGeometrySelectTarget'], {
    roadGeometryEditState: state, roadGeometrySyncWorkingPath() {}, roadGeometryCommitForm() {},
    clearRoadGeometryEdit() { steps.push('close'); },
    showInfo(_position, _key, road) { assert.equal(road, target); steps.push('select'); },
    openRoadEditor() { steps.push('start'); }, roadGeometryHelp() { steps.push('blocked'); }
  });
  c.roadGeometrySelectTarget('city::4', target, {});
  assert.deepEqual(steps, ['close', 'select', 'start']);
  steps.length = 0;
  state.draft.segments[0].geometry[0][0] += 0.001;
  c.roadGeometrySelectTarget('city::4', target, {});
  assert.deepEqual(steps, ['blocked']);
});

test('vertex dragging snaps to a nearby route endpoint', () => {
  class LatLng {
    constructor(lat, lng) { this.lat = lat; this.lng = lng; }
    getLat() { return this.lat; }
    getLng() { return this.lng; }
  }
  const model = roadSegments(true);
  const workingPath = model[0].geometry.map(coord => new LatLng(...coord));
  let current = new LatLng(...point(10.06));
  const marker = { getPosition: () => current, setPosition: value => { current = value; } };
  const c = context(['roadGeometrySnapVertex', 'serializeRoadGeometryPath'], {
    kakao: { maps: { LatLng } },
    map: { getProjection: () => ({ containerPointFromCoords: p => ({ x: p.lng * 1000000, y: p.lat * 1000000 }) }) },
    window: { SacheonLineGeometry: require('../road-line-geometry.js') }
  });
  const state = { snapEnabled: true, roadIndex: 0, draft: { segments: model }, workingPath };
  assert.equal(c.roadGeometrySnapVertex(state, 1, marker), true);
  assert.deepEqual([current.getLat(), current.getLng()], point(10));
});

test('one edit action opens both the line tools and the attribute inputs', async () => {
  const calls = [];
  const c = context(['openRoadEditor'], {
    roadGeometryEditState: { groupKey: 'city::3' },
    startRoadGeometryEdit: async key => { calls.push('line:' + key); },
    showRoadAttributePanel: key => { calls.push('attributes:' + key); }
  });
  await c.openRoadEditor('city::3');
  assert.deepEqual(calls, ['line:city::3', 'attributes:city::3']);
});

test('roadview opens a resizable lower-left panel and popout opens only on its button', () => {
  let opened, panoId, focused = false, closedPanel = false, popoutCount = 0;
  const position = { getLat: () => 34.93, getLng: () => 128.07 };
  const panel = { style: { display: 'none' } };
  const viewer = { getPosition: () => position, relayout() {}, setPanoId(id) { panoId = id; } };
  const c = context(['openRoadview', 'openRoadviewPopup'], {
    roadviewMode: true, roadviewClient: { getNearestPanoId(_pos, _radius, callback) { callback(123); } },
    roadviewRequestId: 0, roadviewRequestedPosition: null, roadviewPopupWindow: null,
    roadviewWindowChannel: null, roadviewWindowWatchTimer: null,
    roadviewPanel: panel, roadview: viewer, roadviewMiniMap: null, roadviewDirectionOverlay: null,
    hideRoadviewMapDirection() {}, closeRoadviewPanel() { closedPanel = true; },
    setTimeout(callback) { callback(); }, setInterval: () => 1, clearInterval() {},
    window: { open(url, name) { popoutCount++; opened = { url, name }; return { focus() { focused = true; } }; } }
  });
  c.openRoadview(position);
  assert.equal(panel.style.display, 'block');
  assert.equal(panoId, 123);
  assert.equal(opened, undefined);
  c.openRoadviewPopup();
  assert.equal(opened.name, 'sacheonRoadview');
  assert.match(opened.url, /^roadview\.html\?lat=34\.93&lng=128\.07&channel=/);
  assert.equal(focused, true);
  assert.equal(closedPanel, true);
  c.openRoadview({ getLat: () => 34.94, getLng: () => 128.08 });
  assert.equal(popoutCount, 2);
  assert.match(opened.url, /lat=34\.94&lng=128\.08/);
  assert.equal(panoId, 123);
  assert.match(html, /#roadviewPanel\s*\{[^}]*left:\s*15px;[^}]*bottom:\s*15px;[^}]*resize:\s*both/s);
  assert.match(html, /id="roadviewPopout"[^>]*>팝업/);
  assert.match(html, /showInfo\(event\.latLng, groupKey, road\);\s*if \(roadviewMode\) openRoadview\(event\.latLng\);/);
  assert.match(fs.readFileSync(path.join(__dirname, '../roadview.html'), 'utf8'), /new kakao\.maps\.Roadview\(/);
});

test('separate roadview updates main map position and heading, then clears on close', () => {
  class LatLng {
    constructor(lat, lng) { this.lat = lat; this.lng = lng; }
    getLat() { return this.lat; }
    getLng() { return this.lng; }
  }
  class CustomOverlay {
    constructor(options) { this.position = options.position; }
    setPosition(position) { this.position = position; }
    setMap(map) { this.map = map; }
  }
  const direction = { style: {} };
  const marker = { className: '', innerHTML: '', querySelector: () => direction };
  const popout = {};
  const map = {};
  const c = context(['showRoadviewMapDirection', 'hideRoadviewMapDirection',
    'receiveRoadviewWindowMessage'], {
    roadviewMode: true, roadviewPopupWindow: popout, roadviewWindowChannel: 'current',
    roadviewWindowWatchTimer: null, roadviewMapDirectionOverlay: null,
    roadviewMapDirectionCone: null, map, clearInterval() {},
    document: { createElement: () => marker },
    kakao: { maps: { LatLng, CustomOverlay } },
    window: { location: { origin: 'https://puren21.github.io' } }
  });
  const deliver = (data, origin = 'https://puren21.github.io', source = popout) =>
    c.receiveRoadviewWindowMessage({ data, origin, source });
  const initial = { type: 'sacheon-roadview-state', channel: 'current', lat: 34.93, lng: 128.07, pan: 120 };
  deliver(initial, 'https://untrusted.example');
  deliver({ ...initial, channel: 'old' });
  deliver(initial, undefined, {});
  assert.equal(c.roadviewMapDirectionOverlay, null);
  deliver(initial);
  assert.equal(c.roadviewMapDirectionOverlay.position.getLat(), 34.93);
  assert.equal(direction.style.transform, 'translate(-50%, -100%) rotate(120deg)');
  assert.equal(c.roadviewMapDirectionOverlay.map, map);
  deliver({ ...initial, lat: 34.94, pan: 270 });
  assert.equal(c.roadviewMapDirectionOverlay.position.getLat(), 34.94);
  assert.equal(direction.style.transform, 'translate(-50%, -100%) rotate(270deg)');
  deliver({ ...initial, lat: 999 });
  assert.equal(c.roadviewMapDirectionOverlay.position.getLat(), 34.94);
  deliver({ type: 'sacheon-roadview-closed', channel: 'current' });
  assert.equal(c.roadviewMapDirectionOverlay.map, null);
  assert.equal(c.roadviewWindowChannel, null);
  const popoutHtml = fs.readFileSync(path.join(__dirname, '../roadview.html'), 'utf8');
  assert.match(popoutHtml, /'position_changed', reportRoadviewState/);
  assert.match(popoutHtml, /'viewpoint_changed', reportRoadviewState/);
});

test('unified editor saves input fields into the selected line draft', () => {
  const panel = { dataset: { groupKey: 'city::3', dirty: 'true', initialLengthDisplay: '2.8' } };
  const state = { groupKey: 'city::3', group: { layerId: 'city' },
    draft: { selected: 1, segments: roadSegments(true), checkpoint() {} } };
  state.draft.segments[1].properties.연장 = 2750;
  const c = context(['roadGeometryCommitForm', 'roadLengthEditedValue', 'applyRoadEditValuesToRoad',
    'setPropertyValue', 'getExistingPropertyKey'], {
    document: { getElementById: id => id === 'roadEditPanel' ? panel : {} },
    FormData: class { get(key) { return ({ length: '2.8', lane: '4', start: '새 기점', status: '개설' })[key] || ''; } }
  });
  c.roadGeometryCommitForm(state);
  assert.equal(state.draft.segments[1].properties.연장, 2750);
  assert.equal(state.draft.segments[1].properties.차선, '4');
  assert.equal(state.draft.segments[0].properties.연장, 1000);
  assert.equal(panel.dataset.dirty, 'false');
});

for (const layerId of ['city', 'rural']) {
  test(`${layerId}: saved cut lines reload as separate map segments`, () => {
    const segments = roadSegments(layerId === 'city');
    const draft = new RoadLineDraft(segments, layerId);
    draft.split([point(5, -5), point(5, 5)]);
    let removed = 0;
    const group = { key: `${layerId}::3`, layerId, number: '3',
      roads: [{ properties: segments[0].properties }, { properties: segments[1].properties }],
      paths: [], propertiesList: [] };
    const c = context(['replaceRoadGroupSegments'], {
      selectedRoadObject: null, selectedRoadPopupState: null,
      kakao: { maps: { LatLng: class { constructor(lat, lng) { this.lat = lat; this.lng = lng; } } } },
      removeRoadSegmentVisuals() { removed++; },
      drawRoad(path, properties, id, key) { return { path, properties, layerId: id, groupKey: key }; },
      getColor() { return '#000'; }, getRoadStatusKey() { return 'OPEN'; }, recalcGroupBounds() {}
    });
    assert.equal(c.replaceRoadGroupSegments(group, draft.serialize()), true);
    assert.equal(removed, 2);
    assert.equal(group.roads.length, 3);
    assert.equal(group.paths.length, 3);
    assert.equal(group.propertiesList.length, 3);
    assert.equal(group.roads[0].path.at(-1).lng, 128.0005);
    assert.equal(group.roads[1].path[0].lng, 128.0005);
    assert.ok(group.roads.every(road => road.properties.number === '3'));
  });
}

test('city GeoJSON has the same editable common fields as rural GeoJSON', () => {
  const city = JSON.parse(fs.readFileSync(path.join(__dirname, '../city_roads.geojson'), 'utf8'));
  const rural = JSON.parse(fs.readFileSync(path.join(__dirname, '../roads.geojson'), 'utf8'));
  assert.equal(city.features.length, 73);
  assert.ok(rural.features.length > 0);
  const shared = ['GUBUN', '차선', '도로폭', '기점', '종점', '비고', '기타', '연장'];
  for (const feature of city.features) {
    for (const field of shared) assert.ok(Object.hasOwn(feature.properties, field), field);
    assert.equal(feature.properties.GUBUN, '시도');
    assert.equal(feature.properties.기점, feature.properties.시점);
  }
});

test('saving other city fields preserves original metres beneath rounded display', async () => {
  const group = { layerId: 'city', number: '3', roads: [{ properties: { 연장: 4154 } }] };
  const saveButton = { disabled: false, textContent: '저장' };
  const previous = { roads: { '1': { review: '기존 검토' } }, geometries: { '1': [[34, 128], [35, 129]] } };
  let saved;
  let applied = false;
  const c = context(['saveRoadAttributes', 'roadLengthEditedValue'], {
    groups: new Map([['road', group]]), getEditableRoad: () => group.roads[0], roadGeometryEditState: null,
    document: { getElementById: id => id === 'roadEditForm' ? {} :
      id === 'roadEditPanel' ? { dataset: { initialLengthDisplay: '4.2' } } : saveButton,
      body: { contains: () => true }, querySelector: () => null },
    FormData: class { get(key) { return ({ status: '개설', length: '4.2', start: '기점', end: '종점' })[key] || ''; } },
    fetchOnlineRoadEdits: async () => previous,
    saveOnlineRoadEdits: async (_group, payload) => { assert.equal(applied, false); saved = structuredClone(payload); },
    applyOnlineRoadEdits: () => { applied = true; },
    createFixedRoadPopup: () => {}, groupPopup: () => '', closeRoadEditPanel: () => {}
  });
  await c.saveRoadAttributes('road');
  assert.equal(saved.roads['0'].length, 4154);
  assert.equal(saved.roads['1'].review, '기존 검토');
  assert.deepEqual(saved.geometries['1'], [[34, 128], [35, 129]]);
  assert.equal(applied, true);
});

for (const layerId of ['city', 'rural']) {
  test(`${layerId}: the editing button is inside the visible popup header`, () => {
    const road = { properties: { 연장: layerId === 'city' ? 1000 : '1', 차선: '2', 도로폭: '8' }, statusKey: 'NORMAL' };
    const group = { layerId, number: '3', key: `${layerId}::3`, propertiesList: [road.properties] };
    const c = context(['roadPopupActions', 'groupPopup'], {
      roadPopupVisibilityToggle: () => '', row: label => `<p>${label}</p>`,
      statusLengthSummary: () => '개설 1 km', rangeValues: () => '2',
      uniqueValues: () => [], joinValues: () => '-', getRoadStatusKey: () => 'NORMAL',
      roadStatusLabel: () => '개설', formatRoadLength: value => String(value),
      roadLengthKm: () => 1, roadLengthInputValue: () => '1',
      escapeHTML: value => String(value), safe: value => value == null ? '-' : String(value),
      routeMemoBlock: () => ''
    });
    const markup = c.groupPopup(group, road);
    const buttonIndex = markup.indexOf('class="road-edit-btn"');
    const attributesIndex = markup.indexOf('class="road-attributes"');
    assert.ok(buttonIndex > 0 && buttonIndex < attributesIndex);
    assert.equal(markup.match(/class="road-edit-btn"/g).length, 1);
    assert.ok(markup.includes('✎ 편집'));
    assert.ok(!markup.includes('class="road-line-edit-btn"'));
    assert.ok(markup.includes('GeoJSON 저장'));
  });
}

const RoadLineDraft = require('../road-line-draft.js');
const point = (x, y = 0) => [35 + y / 10000, 128 + x / 10000];
function roadSegments(city) {
  return [
    { properties: { number: '3', 연장: city ? 1000 : 1, 비고: '기존 값' }, geometry: [point(0), point(10)] },
    { properties: { number: '3', 연장: city ? 1000 : 1 }, geometry: [point(10), point(20)] }
  ];
}
for (const layerId of ['city', 'rural']) {
  test(`${layerId}: split, add and delete persist as separate route segments`, () => {
    const draft = new RoadLineDraft(roadSegments(layerId === 'city'), layerId);
    draft.split([point(5, -5), point(5, 5)]);
    assert.equal(draft.serialize().length, 3);
    assert.equal(draft.structureVersion, 1);
    assert.equal(draft.undo(), true);
    assert.equal(draft.structureVersion, 0);
    assert.equal(draft.redo(), true);
    assert.equal(draft.structureVersion, 1);
    assert.equal(draft.serialize()[0].properties.비고, '기존 값');
    assert.equal(draft.serialize()[1].properties.비고, '기존 값');
    assert.ok(Math.abs(draft.serialize()[0].properties.연장 + draft.serialize()[1].properties.연장 - (layerId === 'city' ? 1000 : 1)) <= 0.002);
    draft.add([point(20), point(30)]);
    assert.equal(draft.serialize().length, 4);
    draft.delete([3]);
    assert.equal(draft.serialize().length, 3);
    assert.ok(draft.undo());
    assert.equal(draft.serialize().length, 4);
    assert.ok(draft.redo());
    assert.equal(draft.serialize().length, 3);
  });
  test(`${layerId}: connected merge and bridge connection use the selected route`, () => {
    const draft = new RoadLineDraft(roadSegments(layerId === 'city'), layerId);
    draft.combine([0, 1], false);
    assert.equal(draft.serialize().length, 1);
    assert.equal(draft.serialize()[0].properties.number, '3');
    assert.ok(draft.undo());
    draft.combine([0, 1], true);
    assert.equal(draft.serialize().length, 1);
    assert.deepEqual(draft.serialize()[0].geometry[0], point(0));
    assert.deepEqual(draft.serialize()[0].geometry.at(-1), point(20));
    const reverse = roadSegments(layerId === 'city');
    reverse[1].properties.비고 = '먼저 선택한 라인';
    const reverseDraft = new RoadLineDraft(reverse, layerId);
    reverseDraft.combine([1, 0], false);
    assert.equal(reverseDraft.serialize()[0].properties.비고, '먼저 선택한 라인');
  });
}
