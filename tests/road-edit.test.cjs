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

test('city and rural road lengths share a km UI without changing stored units', () => {
  const c = context(['parseRoadLength', 'roadLengthKm', 'roadLengthInputValue']);
  assert.equal(c.roadLengthInputValue({ 연장: 4154 }, 'city'), '4.154');
  assert.equal(c.roadLengthInputValue({ 연장: '4.154' }, 'rural'), '4.154');
  assert.equal(c.roadLengthInputValue({ 연장: null }, 'city'), '');
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
  test(`${layerId}: online save failure does not show an unsaved attribute edit`, async () => {
    const group = { layerId, number: '3', roads: [{ properties: { 연장: layerId === 'city' ? 4154 : '4.154' } }] };
    const saveButton = { disabled: false, textContent: '저장' };
    let applied = false;
    let notified = false;
    const formData = { status: '개설', lane: '2', width: '8', length: '4.154', start: '새 기점', end: '새 종점', remark: '비고', extra: '기타', gubun: '면도' };
    const c = context(['saveRoadAttributes'], {
      groups: new Map([['road', group]]), getEditableRoad: () => group.roads[0],
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
  let persisted = null, changed = false, cleared = false;
  const c = context(['saveRoadGeometryEdit'], {
    roadGeometryEditState: state, selectedRoadPopupState: null, selectedRoadObject: null,
    document: { getElementById: () => button, querySelector: () => null },
    roadGeometrySyncWorkingPath: () => {}, fetchOnlineRoadEdits: async () => ({ roads: { 0: { review: '이전 값' } }, geometries: { 0: [[35, 128], [35, 129]] } }),
    saveOnlineRoadEdits: async (_, payload) => { assert.equal(changed, false); persisted = structuredClone(payload); },
    clearRoadGeometryEdit: () => { cleared = true; },
    applyOnlineRoadEdits: () => { assert.equal(cleared, true); changed = true; return true; },
    alert: message => { throw new Error(message); }, console: { error() {} }
  });
  assert.equal(await c.saveRoadGeometryEdit(), true);
  assert.equal(persisted.version, 3);
  assert.equal(persisted.segmentModel.length, 3);
  assert.deepEqual(persisted.roads, {});
  assert.deepEqual(persisted.geometries, {});
  assert.equal(changed, true);
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
    roadGeometrySyncWorkingPath: () => {}, fetchOnlineRoadEdits: async () => null,
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
  const elements = { finishRoadGeometryCaptureBtn: {}, roadLineSnapBtn: {} };
  let toolbar;
  const c = context(['startRoadGeometryEdit'], {
    roadGeometryEditState: null, geometryEditingGroupKey: null, groups: new Map([[group.key, group]]),
    getEditableRoad: () => road, syncOnlineRoadEdits: async () => false,
    roadGroupSegmentModel: () => [{ properties: { ...road.properties }, geometry: path.map(p => [p.getLat(), p.getLng()]) }],
    focusSelectedRoadForEditing() {}, removeSelectedRouteBalloon() {}, updateLabels() {}, closeRoadEditPanel() {},
    rebuildRoadGeometryEditMarkers() {}, cloneRoadEditPath: points => points.slice(),
    roadGeometryFinishCapture() {}, roadGeometryHistory() {}, roadGeometryApplyTool() {},
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
  for (const name of ['vertex', 'add', 'split', 'multi', 'merge', 'join', 'delete', 'undo', 'redo']) {
    assert.ok(toolbar.innerHTML.includes(`data-line-mode="${name}"`), name);
  }
  assert.equal(typeof elements.finishRoadGeometryCaptureBtn.onclick, 'function');
  assert.equal(typeof elements.roadLineSnapBtn.onclick, 'function');
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

test('saving city km input persists metres and keeps previous online edits', async () => {
  const group = { layerId: 'city', number: '3', roads: [{ properties: { 연장: 4154 } }] };
  const saveButton = { disabled: false, textContent: '저장' };
  const previous = { roads: { '1': { review: '기존 검토' } }, geometries: { '1': [[34, 128], [35, 129]] } };
  let saved;
  let applied = false;
  const c = context(['saveRoadAttributes'], {
    groups: new Map([['road', group]]), getEditableRoad: () => group.roads[0],
    document: { getElementById: id => id === 'roadEditForm' ? {} : saveButton, body: { contains: () => true }, querySelector: () => null },
    FormData: class { get(key) { return ({ status: '개설', length: '4.154', start: '기점', end: '종점' })[key] || ''; } },
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
    assert.ok(markup.includes('class="road-line-edit-btn"'));
    assert.ok(markup.indexOf('class="road-line-edit-btn"') < attributesIndex);
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
  });
}
