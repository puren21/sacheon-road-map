/* Route segment edits for Sacheon. Geometry calculations come from gunsan_bike. */
(function(root) {
  'use strict';
  const G = root.SacheonLineGeometry || (typeof require === 'function' ? require('./road-line-geometry.js') : null);
  const copy = value => JSON.parse(JSON.stringify(value));
  const toLngLat = path => path.map(point => [point[1], point[0]]);
  const toLatLng = path => path.map(point => [point[1], point[0]]);
  function meters(path) {
    const points = toLngLat(path);
    let sum = 0;
    for (let i = 1; i < points.length; i++) sum += G.distance(points[i - 1], points[i]);
    return sum;
  }
  function lengthValue(path, layerId) {
    const value = meters(path) / (layerId === 'city' ? 1 : 1000);
    return Math.round(value * 1000) / 1000;
  }
  function modelValid(segments) {
    return Array.isArray(segments) && segments.length > 0 && segments.every(item =>
      item && item.properties && G.valid(toLngLat(item.geometry)));
  }
  class RoadLineDraft {
    constructor(segments, layerId, selected = 0) {
      if (!modelValid(segments)) throw new Error('편집할 수 있는 라인이 없습니다.');
      this.segments = copy(segments);
      this.layerId = layerId;
      this.selected = selected;
      this.undoStack = [];
      this.redoStack = [];
    }
    checkpoint() {
      this.undoStack.push({ segments: copy(this.segments), selected: this.selected });
      if (this.undoStack.length > 60) this.undoStack.shift();
      this.redoStack = [];
    }
    restore(other) { this.segments = other.segments; this.selected = other.selected; }
    undo() {
      if (!this.undoStack.length) return false;
      this.redoStack.push({ segments: copy(this.segments), selected: this.selected });
      this.restore(this.undoStack.pop());
      return true;
    }
    redo() {
      if (!this.redoStack.length) return false;
      this.undoStack.push({ segments: copy(this.segments), selected: this.selected });
      this.restore(this.redoStack.pop());
      return true;
    }
    setPath(path) {
      if (!G.valid(toLngLat(path))) throw new Error('라인에는 서로 다른 점이 두 개 이상 필요합니다.');
      this.checkpoint();
      this.segments[this.selected].geometry = copy(path);
    }
    split(cutter) {
      const item = this.segments[this.selected];
      const parts = G.split(toLngLat(item.geometry), toLngLat(cutter)).map(toLatLng);
      if (parts.length < 2) throw new Error('선택한 라인을 가로지르는 절단선을 그려 주세요.');
      const original = Number(item.properties['연장']);
      const total = parts.reduce((sum, path) => sum + meters(path), 0);
      this.checkpoint();
      const pieces = parts.map(path => {
        const properties = copy(item.properties);
        properties['연장'] = Number.isFinite(original) && original > 0
          ? Math.round(original * meters(path) / total * 1000) / 1000
          : lengthValue(path, this.layerId);
        return { properties, geometry: path };
      });
      this.segments.splice(this.selected, 1, ...pieces);
      return pieces.length;
    }
    add(path) {
      if (!G.valid(toLngLat(path))) throw new Error('새 라인은 서로 다른 점이 두 개 이상 필요합니다.');
      this.checkpoint();
      const properties = copy(this.segments[this.selected].properties);
      properties['연장'] = lengthValue(path, this.layerId);
      this.segments.push({ properties, geometry: copy(path) });
      this.selected = this.segments.length - 1;
    }
    combine(indices, join) {
      const ids = [...new Set(indices)].sort((a, b) => a - b);
      if (ids.length < 2 || ids.some(index => !this.segments[index])) throw new Error('두 개 이상의 라인을 선택해 주세요.');
      const selected = ids.map(index => this.segments[index]);
      const paths = selected.map(item => toLngLat(item.geometry));
      const result = join ? G.connectMany(paths).coordinates : G.merge(paths);
      if (!join && result.length !== 1) throw new Error('끝점이 이어진 라인만 병합할 수 있습니다. 떨어진 라인은 연결을 사용해 주세요.');
      const mergedPath = toLatLng(join ? result : result[0]);
      if (!G.valid(toLngLat(mergedPath))) throw new Error('병합 후 라인이 유효하지 않습니다.');
      this.checkpoint();
      const properties = copy(selected[0].properties);
      properties['연장'] = lengthValue(mergedPath, this.layerId);
      const entry = { properties, geometry: mergedPath };
      this.segments = this.segments.filter((_, index) => !ids.includes(index));
      this.selected = this.segments.length;
      this.segments.push(entry);
    }
    delete(indices) {
      const ids = [...new Set(indices)];
      if (!ids.length || ids.some(index => !this.segments[index])) throw new Error('삭제할 라인을 선택해 주세요.');
      if (this.segments.length <= ids.length) throw new Error('노선의 마지막 라인은 삭제할 수 없습니다.');
      this.checkpoint();
      this.segments = this.segments.filter((_, index) => !ids.includes(index));
      this.selected = Math.min(this.selected, this.segments.length - 1);
    }
    serialize() {
      if (!modelValid(this.segments)) throw new Error('유효하지 않은 라인이 포함되어 있습니다.');
      return copy(this.segments);
    }
  }
  root.SacheonLineDraft = RoadLineDraft;
  if (typeof module !== 'undefined') module.exports = RoadLineDraft;
})(typeof window === 'undefined' ? globalThis : window);
