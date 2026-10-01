"""Rebuild shared boundary lines with pinned mapshaper (Node/npm required).
Run from any directory: python3 scripts/build-township-boundaries.py
Original source is never modified. Simplification interval is 60 metres.
"""
import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'Township Boundary.geojson'

def run(*args):
    subprocess.run(['npx', '--yes', 'mapshaper@0.7.72', str(SOURCE), *map(str, args)], check=True)

def write(name, data):
    (ROOT / name).write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')

with tempfile.TemporaryDirectory() as directory:
    tmp = Path(directory)
    detail, polygons, lines = [tmp / name for name in ('detail.geojson', 'selectors.geojson', 'lines.geojson')]
    run('-lines', '-o', detail, 'format=geojson')
    run('-simplify', 'dp', 'interval=60', 'keep-shapes', '-o', polygons, 'format=geojson', '-lines', '-o', lines, 'format=geojson')
    selectors = json.loads(polygons.read_text())
    overview = json.loads(lines.read_text())
    write('township_overview.geojson', {'type': 'FeatureCollection', 'features': selectors['features'] + overview['features']})
    write('township_detail_lines.geojson', json.loads(detail.read_text()))
