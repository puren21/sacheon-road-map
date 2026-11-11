/* Shared geometry operations adapted from puren21/gunsan_bike bike-geometry.js. */
(function(root) {
  'use strict';
  const copy = x => JSON.parse(JSON.stringify(x));
  const paths = feature => feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates : [feature.geometry.coordinates];
  function distance(a,b) {
    const rad=Math.PI/180, x=(b[0]-a[0])*rad*Math.cos((a[1]+b[1])*rad/2), y=(b[1]-a[1])*rad;
    return 6371008.8*Math.hypot(x,y);
  }
  function clean(path) {return path.filter((p,i)=>!i||distance(p,path[i-1])>0.0001).map(p=>p.slice(0,2));}
  function valid(path) {return path.length>=2&&path.every(p=>p.length>=2&&p.every(Number.isFinite)&&p[0]>=-180&&p[0]<=180&&p[1]>=-90&&p[1]<=90)&&path.some(p=>distance(p,path[0])>0.001);}
  function nearest(path, coordinate, project = p => p) {
    const p=project(coordinate);let best=null;
    for(let i=1;i<path.length;i++) {
      const a=project(path[i-1]),b=project(path[i]),dx=b[0]-a[0],dy=b[1]-a[1];
      const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
      const d=Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
      if(!best||d<best.distance)best={index:i,t,distance:d,coordinate:[path[i-1][0]+t*(path[i][0]-path[i-1][0]),path[i-1][1]+t*(path[i][1]-path[i-1][1])]};
    }
    return best;
  }
  function intersection(a,b,c,d) {
    const rx=b[0]-a[0],ry=b[1]-a[1],sx=d[0]-c[0],sy=d[1]-c[1];
    const den=rx*sy-ry*sx;if(Math.abs(den)<1e-18)return null;
    const t=((c[0]-a[0])*sy-(c[1]-a[1])*sx)/den,u=((c[0]-a[0])*ry-(c[1]-a[1])*rx)/den;
    return t>=-1e-9&&t<=1+1e-9&&u>=-1e-9&&u<=1+1e-9?Math.max(0,Math.min(1,t)):null;
  }
  function split(path,cutter) {
    const cuts=[];
    for(let i=0;i<path.length-1;i++)for(let j=0;j<cutter.length-1;j++) {
      const t=intersection(path[i],path[i+1],cutter[j],cutter[j+1]);
      if(t!==null) {const pos=i+t;if(pos>1e-8&&pos<path.length-1-1e-8)cuts.push(pos);}
    }
    cuts.sort((a,b)=>a-b);const stops=[0,...cuts.filter((x,i)=>!i||Math.abs(x-cuts[i-1])>1e-8),path.length-1];
    const at = pos => {const i=Math.min(Math.floor(pos),path.length-2),t=pos-i;return [path[i][0]+t*(path[i+1][0]-path[i][0]),path[i][1]+t*(path[i+1][1]-path[i][1])];};
    const result=[];
    for(let k=1;k<stops.length;k++) {const a=stops[k-1],b=stops[k],part=[at(a)];for(let i=Math.floor(a)+1;i<b-1e-8;i++)part.push(path[i]);part.push(at(b));const p=clean(part);if(valid(p))result.push(p);}
    return result.length?result:[copy(path)];
  }
  function merge(input,tolerance=0.5) {
    const result=input.map(p=>clean(copy(p)));let changed=true;
    while(changed) {
      changed=false;
      outer:for(let i=0;i<result.length;i++)for(let j=i+1;j<result.length;j++) {
        for(const reverseA of [false,true])for(const reverseB of [false,true]) {
          const a=reverseA?[...result[i]].reverse():result[i],b=reverseB?[...result[j]].reverse():result[j];
          if(distance(a[a.length-1],b[0])<=tolerance) {
            // Do not join through a branching junction.
            const degree=result.reduce((n,p)=>n+(distance(p[0],b[0])<=tolerance?1:0)+(distance(p[p.length-1],b[0])<=tolerance?1:0),0);
            if(degree!==2)continue;
            result[i]=a.concat(b.slice(1));result.splice(j,1);changed=true;break outer;
          }
        }
      }
    }
    return result;
  }
  function connect(a,b) {
    if(!valid(a)||!valid(b))throw Error('유효한 두 라인을 선택하세요.');
    if(distance(a[0],a[a.length-1])<0.0001||distance(b[0],b[b.length-1])<0.0001)throw Error('닫힌 라인은 연결할 수 없습니다.');
    let best=null;
    for(const reverseA of [false,true])for(const reverseB of [false,true]){
      const first=reverseA?a.slice().reverse():a.slice(),second=reverseB?b.slice().reverse():b.slice();
      const gap=distance(first[first.length-1],second[0]);
      if(!best||gap<best.distance)best={coordinates:clean(first.concat(second)),bridge:[first[first.length-1].slice(),second[0].slice()],distance:gap};
    }
    return best;
  }
  function connectMany(input) {
    if(!Array.isArray(input)||input.length<2)throw Error('두 개 이상의 라인을 선택하세요.');
    if(input.some(path=>!valid(path)||distance(path[0],path[path.length-1])<0.0001))throw Error('각각 유효한 열린 라인을 선택하세요.');
    let coordinates=copy(input[0]),remaining=input.slice(1).map(copy),bridges=[],total=0;
    while(remaining.length){
      let best=null;
      remaining.forEach((path,index)=>{const a=coordinates[0],b=coordinates[coordinates.length-1],c=path[0],d=path[path.length-1],gap=Math.min(distance(a,c),distance(a,d),distance(b,c),distance(b,d));if(!best||gap<best.distance)best={index,distance:gap};});
      const result=connect(coordinates,remaining[best.index]);coordinates=result.coordinates;bridges.push(result.bridge);total+=result.distance;remaining.splice(best.index,1);
    }
    return {coordinates,bridges,distance:total};
  }
  function intersectsBox(path,box) {
    for(let i=1;i<path.length;i++) {
      const a=path[i-1],b=path[i],dx=b[0]-a[0],dy=b[1]-a[1];
      const p=[-dx,dx,-dy,dy],q=[a[0]-box.left,box.right-a[0],a[1]-box.top,box.bottom-a[1]];
      let low=0,high=1,hit=true;
      for(let j=0;j<4;j++) {
        if(Math.abs(p[j])<1e-12){if(q[j]<0){hit=false;break;}continue;}
        const t=q[j]/p[j];if(p[j]<0)low=Math.max(low,t);else high=Math.min(high,t);
        if(low>high){hit=false;break;}
      }
      if(hit)return true;
    }
    return false;
  }
  function snapToPaths(entries,coordinate,project=p=>p,tolerance=12,skip={}) {
    const cursor=project(coordinate);let vertex=null,segment=null;
    for(const entry of entries) {
      const own=entry.id===skip.id&&entry.part===skip.part;
      if(own&&skip.index===-1)continue;
      entry.path.forEach((p,index)=>{
        if(own&&index===skip.index)return;
        const screen=project(p),d=Math.hypot(screen[0]-cursor[0],screen[1]-cursor[1]);
        if(d<=tolerance&&(!vertex||d<vertex.distance))vertex={coordinate:[...p],distance:d,kind:'vertex'};
      });
      for(let i=1;i<entry.path.length;i++) {
        if(own&&(i===skip.index||i-1===skip.index))continue;
        const n=nearest([entry.path[i-1],entry.path[i]],coordinate,project);
        if(n&&n.distance<=tolerance&&(!segment||n.distance<segment.distance))segment={coordinate:n.coordinate,distance:n.distance,kind:'segment'};
      }
    }
    return vertex||segment;
  }
  const api={copy,paths,distance,clean,valid,nearest,split,merge,connect,connectMany,intersectsBox,snapToPaths};
  root.SacheonLineGeometry=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
