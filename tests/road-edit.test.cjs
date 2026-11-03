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
