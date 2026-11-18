#!/usr/bin/env python3
"""Build a lightweight Sacheon display mask. Requires shapely==2.1.2."""
import json
from pathlib import Path
from shapely.geometry import shape, mapping
root=Path(__file__).resolve().parents[1]
source=json.loads((root/'City Boundary.geojson').read_text())
features=[f for f in source['features'] if f['properties'].get('ADM_SECT_C')=='48240']
assert len(features)==1, 'Expected exactly one Sacheon boundary'
original=shape(features[0]['geometry'])
# ~1m in latitude; preserves all 79 parts and their topology.
simple=original.simplify(0.00001,preserve_topology=True)
assert simple.is_valid and len(simple.geoms)==len(original.geoms)
payload={'type':'Feature','properties':{'name':'사천시','code':'48240','source':'City Boundary.geojson','displayToleranceDegrees':0.00001},'geometry':mapping(simple),'bbox':list(simple.bounds)}
path=root/'data/zoning/sacheon-boundary.json'
path.write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':')))
print(f'{len(original.geoms)} parts preserved; {path.stat().st_size:,} bytes')
