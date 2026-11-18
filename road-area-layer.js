/* Official road-area overlay. No fetch or polygon allocation while disabled. */
(function(root) {
  'use strict';
  function createRoadAreaLayer(map, sdk, status, fetcher) {
    let enabled = false, generation = 0, timer, manifest;
    const cache = new Map(), polygons = [];
    let controller;
    function clear() { polygons.splice(0).forEach(p => p.setMap(null)); }
    function cancel() {
      generation++;
      clearTimeout(timer);
      if (controller) controller.abort();
      clear();
    }
    async function json(url, signal) {
      const response = await fetcher(url, {signal, cache: 'default'});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    }
    async function update() {
      cancel();
      if (!enabled) return;
      const token = generation;
      if (map.getLevel() > 4) { status('확대하면 표시됩니다. · 지도 단계 4 이하'); return; }
      controller = new AbortController();
      const signal = controller.signal;
      status('실폭도로 자료 확인 중…');
      try {
        if (!manifest) manifest = await json('data/road-area/manifest.json', signal);
        if (token !== generation) return;
        if (!manifest.available) { status('공식 원본 자료 미등록 · 브이월드 로그인 후 다운로드가 필요합니다.'); return; }
        const sw = map.getBounds().getSouthWest(), ne = map.getBounds().getNorthEast();
        const tiles = manifest.tiles.filter(t => t.bbox[0] <= ne.getLng() && t.bbox[2] >= sw.getLng() && t.bbox[1] <= ne.getLat() && t.bbox[3] >= sw.getLat());
        if (tiles.length > 16) { status('표시 범위가 넓습니다. 지도를 더 확대해 주세요.'); return; }
        let count = 0, vertices = 0;
        // Sequential requests bound concurrent decoding and allocation on slower PCs.
        for (const tile of tiles) {
          if (!/^tile-\d+\.json$/.test(tile.file)) throw new Error('Invalid tile path');
          let data = cache.get(tile.file);
          if (!data) {
            data = await json('data/road-area/' + tile.file + '?v=' + encodeURIComponent(manifest.version), signal);
            if (token !== generation) return;
            cache.set(tile.file, data);
            if (cache.size > 24) cache.delete(cache.keys().next().value);
          } else { cache.delete(tile.file); cache.set(tile.file, data); }
          for (const f of data.features) {
            const areas = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
            for (const area of areas) {
              vertices += area.reduce((n,r) => n + r.length, 0);
              if (++count > 400 || vertices > 40000) { clear(); status('도로가 밀집한 범위입니다. 지도를 더 확대해 주세요.'); return; }
              const polygon = new sdk.Polygon({path: area.map(r => r.map(p => new sdk.LatLng(p[1],p[0]))), strokeWeight:1, strokeColor:'#d97706', strokeOpacity:0.7, fillColor:'#fbbf24', fillOpacity:0.35, zIndex:1});
              polygon.setMap(map); polygons.push(polygon);
            }
          }
          // Let map gestures and route editing proceed between tiles.
          await new Promise(resolve => setTimeout(resolve, 0));
          if (token !== generation) { return; }
        }
        status(count ? '실폭도로 표시 중 · 국토지리정보원 / 브이월드' : '현재 화면에 등록된 실폭도로가 없습니다.');
      } catch(error) {
        if (token !== generation || error.name === 'AbortError') return;
        clear(); manifest = null;
        status('자료를 불러오지 못했습니다. OFF 후 다시 켜 주세요.');
      }
    }
    sdk.event.addListener(map, 'zoom_start', cancel);
    sdk.event.addListener(map, 'dragstart', cancel);
    sdk.event.addListener(map, 'idle', () => { if (enabled) { cancel(); timer = setTimeout(update, 180); } });
    return {setEnabled(value) { enabled = !!value; if (enabled) update(); else {cancel(); status('꺼짐');} }};
  }
  if (typeof module !== 'undefined') module.exports = createRoadAreaLayer;
  if (!root.document) return;
  function init() {
    const input = document.getElementById('roadAreaToggle'), output = document.getElementById('roadAreaStatus');
    if (!input || input.dataset.ready) return;
    if (!root.sacheonMap) {
      input.disabled = true; output.textContent = '카카오 지도를 불러온 뒤 사용할 수 있습니다.'; return;
    }
    input.dataset.ready = '1'; input.disabled = false; input.checked = false;
    output.textContent = '꺼짐 · 확대 시 도로경계 면을 표시합니다.';
    const layer = createRoadAreaLayer(root.sacheonMap, root.kakao.maps, text => {output.textContent = text;}, root.fetch.bind(root));
    input.addEventListener('change', () => layer.setEnabled(input.checked));
  }
  init(); root.addEventListener('sacheon-map-ready', init);
})(typeof window === 'undefined' ? globalThis : window);
