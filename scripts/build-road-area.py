#!/usr/bin/env python3
"""Clip official road-area SHP to Sacheon, simplify 0.3m, emit bounded tiles.
Requires geopandas >= 1.0, shapely >= 2.0. Never substitutes road centerlines.
Usage: python3 scripts/build-road-area.py /path/to/A0010000.shp --version 2026-10-01
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import geopandas as gpd
from shapely.geometry import box, mapping
from shapely import make_valid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', nargs='+', help='Official polygon SHP files (all relevant parts)')
parser.add_argument('--version', required=True, help='Official source update date')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
out = root / 'data/road-area'
boundaries = gpd.read_file(root / 'City Boundary.geojson').to_crs(5179)
# Restrict exactly to Sacheon; refuse ambiguous boundary inputs.
mask = boundaries.astype(str).apply(lambda col: col.str.contains('사천|48240', regex=True)).any(axis=1)
if not mask.any():
    raise ValueError('Cannot identify Sacheon boundary; inspect City Boundary.geojson properties')
boundary = boundaries.loc[mask].geometry.union_all()
features = []
for source in args.source:
    info = gpd.read_file(source, rows=1)
    if info.crs is None:
        raise ValueError('Source CRS is required; preserve .prj')
    extent = gpd.GeoSeries([boundary], crs=5179).to_crs(info.crs).total_bounds
    frame = gpd.read_file(source, bbox=tuple(extent)).to_crs(5179)
    for geom in frame.geometry:
        if geom is None or geom.is_empty:
            continue
        geom = make_valid(geom).intersection(boundary)
        if geom.geom_type not in ('Polygon', 'MultiPolygon') or geom.is_empty:
            continue
        # Intersect again to prevent simplification moving geometry outside the city.
        geom = geom.simplify(0.3, preserve_topology=True).intersection(boundary)
        if not geom.is_empty and geom.geom_type in ('Polygon', 'MultiPolygon'):
            features.append(geom)
if not features:
    raise ValueError('No road polygons intersect Sacheon; no output written')
frame = gpd.GeoDataFrame(geometry=features, crs=5179).to_crs(4326)
minx,miny,maxx,maxy = frame.total_bounds
staged = []
for x in range(math.floor(minx*100), math.ceil(maxx*100)):
    for y in range(math.floor(miny*100), math.ceil(maxy*100)):
        bounds = [x/100,y/100,(x+1)/100,(y+1)/100]
        cell = box(*bounds)
        selected = frame.sindex.query(cell, predicate='intersects')
        items = []
        for i in selected:
            geom = frame.geometry.iloc[i].intersection(cell)
            if not geom.is_empty and geom.geom_type in ('Polygon','MultiPolygon'):
                items.append({'type':'Feature','properties':{},'geometry':mapping(geom)})
        if items:
            data = json.dumps({'type':'FeatureCollection','features':items}, separators=(',',':'))
            if len(data.encode()) > 2_000_000:
                raise ValueError('Tile exceeds 2MB; use smaller grid before publication')
            staged.append((bounds, data))
# Versioned metadata prevents stale tile caches after source updates.
version = hashlib.sha256(''.join(d for _,d in staged).encode()).hexdigest()[:16]
for i, (_, data) in enumerate(staged):
    (out / f'tile-{i}.json').write_text(data)
manifest = {'available':True,'version':version,'sourceUpdated':args.version,'source':'https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=MK&dsId=30179','attribution':'국토지리정보원 / 브이월드 · CC BY','simplificationMeters':0.3,'tiles':[{'file':f'tile-{i}.json','bbox':b} for i,(b,_) in enumerate(staged)]}
(out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')))
print(f'{len(features)} road features, {len(staged)} tiles, {sum(len(d.encode()) for _,d in staged)} bytes')
