const {test} = require('node:test');
const assert = require('node:assert/strict');
const create = require('../road-area-layer.js');
function setup(fetcher, level=4) {
  const handlers={}, shapes=[], messages=[];
  const map={getLevel:()=>level,getBounds:()=>({getSouthWest:()=>({getLng:()=>128,getLat:()=>35}),getNorthEast:()=>({getLng:()=>128.01,getLat:()=>35.01})})};
  const sdk={event:{addListener:(m,n,f)=>handlers[n]=f},LatLng:class{},Polygon:class{constructor(o){this.options=o;shapes.push(this);}setMap(m){this.map=m;}}};
  return {layer:create(map,sdk,x=>messages.push(x),fetcher),handlers,shapes,messages};
}
const tick=()=>new Promise(r=>setTimeout(r,20));
const manifest={available:true,version:'test',tiles:[{file:'tile-0.json',bbox:[128,35,128.01,35.01]}]};
const data={features:[{geometry:{type:'Polygon',coordinates:[[[128,35],[128.01,35],[128,35.01],[128,35]],[[128.001,35.001],[128.002,35.001],[128.001,35.002],[128.001,35.001]]]}}]};
test('default OFF and wide scale issue no requests',async()=>{let n=0;const x=setup(async()=>{n++;},7);assert.equal(n,0);x.layer.setEnabled(true);await tick();assert.equal(n,0);assert.match(x.messages.at(-1),/확대/);});
test('ON displays polygon with hole; OFF removes; re-enable uses cache',async()=>{let n=0;const x=setup(async url=>{n++;return {ok:true,json:async()=>url.endsWith('manifest.json')?manifest:data};});x.layer.setEnabled(true);await tick();assert.equal(x.shapes.length,1);assert.equal(x.shapes[0].options.path.length,2);x.layer.setEnabled(false);assert.equal(x.shapes[0].map,null);x.layer.setEnabled(true);await tick();assert.equal(n,2);assert.ok(x.shapes[1].map);});
test('OFF during download cannot attach stale geometry',async()=>{let resolve;const x=setup(()=>new Promise(r=>resolve=r));x.layer.setEnabled(true);x.layer.setEnabled(false);resolve({ok:true,json:async()=>manifest});await tick();assert.equal(x.shapes.length,0);assert.equal(x.messages.at(-1),'꺼짐');});
test('unavailable official data is disclosed',async()=>{const x=setup(async()=>({ok:true,json:async()=>({available:false})}));x.layer.setEnabled(true);await tick();assert.match(x.messages.at(-1),/미등록/);assert.equal(x.shapes.length,0);});
test('failed download can retry',async()=>{let n=0;const x=setup(async()=>{if(++n===1)throw Error('network');return {ok:true,json:async()=>({available:false})};});x.layer.setEnabled(true);await tick();assert.match(x.messages.at(-1),/불러오지/);x.layer.setEnabled(false);x.layer.setEnabled(true);await tick();assert.equal(n,2);});
