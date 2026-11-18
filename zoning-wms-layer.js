/* VWorld WMS zoning. Server-held credential; visitors receive only zoning images. */
(function(root) {
  'use strict';
  const LAYERS = ['lt_c_uq111','lt_c_uq112','lt_c_uq113','lt_c_uq114'];
  const ENDPOINT = 'https://api.vworld.kr/req/wms';
  // Public image endpoint; the VWorld credential stays in server-side secrets.
  const SITE_CONFIG = Object.freeze({proxyUrl:'https://sacheon-zoning-wms-proxy.zamburota.chatgpt.site/zoning'});
  const R = 6378137;
  const toMercator = (lng,lat) => [R*lng*Math.PI/180,R*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))];
  const fromMercator = (x,y) => [x/R*180/Math.PI,(2*Math.atan(Math.exp(y/R))-Math.PI/2)*180/Math.PI];
  function intersect(a,b) {
    const c=[Math.max(a[0],b[0]),Math.max(a[1],b[1]),Math.min(a[2],b[2]),Math.min(a[3],b[3])];
    return c[0]<c[2] && c[1]<c[3] ? c : null;
  }
  function buildRequest(config,bbox,width,height) {
    if(config.proxyUrl){
      const url=new URL(config.proxyUrl);
      Object.entries({BBOX:bbox.map(n=>n.toFixed(3)).join(','),WIDTH:width,HEIGHT:height}).forEach(([k,v])=>url.searchParams.set(k,String(v)));
      return url.href;
    }
    const url = new URL(ENDPOINT);
    const params={SERVICE:'WMS',REQUEST:'GetMap',VERSION:'1.3.0',LAYERS:LAYERS.join(','),STYLES:LAYERS.join(','),CRS:'EPSG:3857',BBOX:bbox.map(n=>n.toFixed(3)).join(','),WIDTH:width,HEIGHT:height,FORMAT:'image/png',TRANSPARENT:'TRUE',EXCEPTIONS:'text/xml',KEY:config.key,DOMAIN:config.domain};
    Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,String(v)));
    return url.href;
  }
  function imageLoader(url,signal) {
    return new Promise((resolve,reject)=>{
      const image=new Image(); image.decoding='async';
      function clean(){image.onload=image.onerror=null;signal.removeEventListener('abort',abort);}
      function abort(){clean();image.src='';reject(new DOMException('Aborted','AbortError'));}
      image.onload=()=>{clean();resolve(image);};
      image.onerror=()=>{clean();reject(new Error('WMS image unavailable'));};
      if(signal.aborted){abort();return;}
      signal.addEventListener('abort',abort,{once:true});
      // No crossOrigin flag: WMS image display does not require CORS or canvas readback.
      image.src=url;
    });
  }
  function drawTriangle(ctx,image,src,dst) {
    const [s0,s1,s2]=src,[d0,d1,d2]=dst;
    const a=s1[0]-s0[0], b=s1[1]-s0[1], c=s2[0]-s0[0], d=s2[1]-s0[1], det=a*d-b*c;
    if(Math.abs(det)<1e-9)return;
    const x1=d1.x-d0.x,x2=d2.x-d0.x,y1=d1.y-d0.y,y2=d2.y-d0.y;
    const A=(x1*d-x2*b)/det,C=(x2*a-x1*c)/det,B=(y1*d-y2*b)/det,D=(y2*a-y1*c)/det;
    ctx.save();ctx.beginPath();ctx.moveTo(d0.x,d0.y);ctx.lineTo(d1.x,d1.y);ctx.lineTo(d2.x,d2.y);ctx.closePath();ctx.clip();
    ctx.transform(A,B,C,D,d0.x-A*s0[0]-C*s0[1],d0.y-B*s0[0]-D*s0[1]);ctx.drawImage(image,0,0);ctx.restore();
  }
  function createOverlay(map,sdk) {
    const node=document.createElement('canvas');
    node.setAttribute('aria-hidden','true');
    node.className='zoning-wms-canvas';
    node.style.cssText='position:absolute;pointer-events:none;z-index:0;opacity:.58;';
    const overlay=new sdk.AbstractOverlay();
    let frame=null,layout=null,paintLevel=null;
    overlay.onAdd=function(){this.getPanels().overlayLayer.appendChild(node);};
    overlay.onRemove=function(){node.remove();};
    overlay.draw=function(){
      if(!frame)return;
      const projection=this.getProjection();
      if(!layout || paintLevel!==map.getLevel()){
        const N=16,grid=[];
        for(let j=0;j<=N;j++)for(let i=0;i<=N;i++){
          const ll=fromMercator(frame.bbox[0]+(frame.bbox[2]-frame.bbox[0])*i/N,frame.bbox[3]-(frame.bbox[3]-frame.bbox[1])*j/N);
          grid.push({ll,point:projection.pointFromCoords(new sdk.LatLng(ll[1],ll[0]))});
        }
        const xs=grid.map(p=>p.point.x),ys=grid.map(p=>p.point.y);
        const left=Math.floor(Math.min(...xs)),top=Math.floor(Math.min(...ys)),w=Math.ceil(Math.max(...xs))-left,h=Math.ceil(Math.max(...ys))-top;
        if(w<=0||h<=0)return;
        const scale=Math.min(1,1440/w,1440/h);
        node.width=Math.ceil(w*scale);node.height=Math.ceil(h*scale);node.style.width=w+'px';node.style.height=h+'px';
        const ctx=node.getContext('2d');ctx.scale(scale,scale);ctx.translate(-left,-top);
        ctx.save();ctx.beginPath();
        const parts=frame.boundary.geometry.type==='Polygon'?[frame.boundary.geometry.coordinates]:frame.boundary.geometry.coordinates;
        for(const part of parts)for(const ring of part){
          ring.forEach((ll,i)=>{const p=projection.pointFromCoords(new sdk.LatLng(ll[1],ll[0]));if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);});ctx.closePath();
        }
        ctx.clip('evenodd');
        const iw=frame.image.naturalWidth,ih=frame.image.naturalHeight;
        for(let j=0;j<N;j++)for(let i=0;i<N;i++){
          const p00=grid[j*(N+1)+i].point,p10=grid[j*(N+1)+i+1].point,p01=grid[(j+1)*(N+1)+i].point,p11=grid[(j+1)*(N+1)+i+1].point;
          const x0=i*iw/N,x1=(i+1)*iw/N,y0=j*ih/N,y1=(j+1)*ih/N;
          drawTriangle(ctx,frame.image,[[x0,y0],[x1,y0],[x1,y1]],[p00,p10,p11]);
          drawTriangle(ctx,frame.image,[[x0,y0],[x1,y1],[x0,y1]],[p00,p11,p01]);
        }
        ctx.restore();layout={ll:grid[0].ll,dx:left-grid[0].point.x,dy:top-grid[0].point.y};paintLevel=map.getLevel();
      }
      const anchor=projection.pointFromCoords(new sdk.LatLng(layout.ll[1],layout.ll[0]));
      node.style.left=(anchor.x+layout.dx)+'px';node.style.top=(anchor.y+layout.dy)+'px';
    };
    return {show(next){frame=next;layout=null;paintLevel=null;overlay.setMap(map);overlay.draw();},clear(){overlay.setMap(null);frame=null;layout=null;}};
  }
  function createLayer(map,sdk,status,options={}) {
    const fetcher=options.fetch || root.fetch.bind(root),loadImage=options.loadImage || imageLoader;
    const overlay=options.overlay || createOverlay(map,sdk),cache=new Map();
    let enabled=false,config=options.config||SITE_CONFIG,boundary=null,generation=0,timer=null,controller=null,deadline=null;
    function cancel(){generation++;clearTimeout(timer);clearTimeout(deadline);if(controller)controller.abort();overlay.clear();}
    async function update(){
      cancel();if(!enabled)return;
      const token=generation;
      if(!config.key&&!config.proxyUrl){status('용도지역 연결 설정이 필요합니다.');return;}
      if(map.getLevel()>11){status('용도지역을 보려면 지도를 더 확대해 주세요.');return;}
      controller=new AbortController();const signal=controller.signal;
      deadline=setTimeout(()=>controller.abort(),20000);
      status('사천시 용도지역 불러오는 중…');
      try{
        if(!boundary){const response=await fetcher('data/zoning/sacheon-boundary.json',{signal,cache:'default'});if(!response.ok)throw new Error('boundary');const next=await response.json();if(token!==generation)return;boundary=next;}
        const sw=map.getBounds().getSouthWest(),ne=map.getBounds().getNorthEast();
        const bounds=intersect([sw.getLng(),sw.getLat(),ne.getLng(),ne.getLat()],boundary.bbox);
        if(!bounds){status('사천시 범위 밖입니다.');return;}
        const a=toMercator(bounds[0],bounds[1]),b=toMercator(bounds[2],bounds[3]),bbox=[a[0],a[1],b[0],b[1]];
        // Bound image decoding/memory; preserve source aspect ratio.
        const ratio=(b[0]-a[0])/(b[1]-a[1]);
        const width=Math.max(64,Math.round(1024*Math.min(1,ratio))),height=Math.max(64,Math.round(1024*Math.min(1,1/ratio)));
        const url=buildRequest(config,bbox,width,height);
        let item=cache.get(url);
        if(item && Date.now()-item.time>600000){cache.delete(url);item=null;}
        if(!item){const image=await loadImage(url,signal);if(token!==generation)return;item={image,time:Date.now()};cache.set(url,item);if(cache.size>3)cache.delete(cache.keys().next().value);}
        else{cache.delete(url);cache.set(url,item);}
        if(token!==generation)return;
        overlay.show({image:item.image,bbox,boundary});
        status('용도지역 표시 중 · 국토교통부 / 브이월드');
      }catch(error){
        if(token!==generation)return;
        overlay.clear();
        status(error.name==='AbortError'?'응답 시간이 초과되었습니다. 껐다 다시 켜 주세요.':'용도지역을 불러오지 못했습니다. 잠시 후 다시 켜 주세요.');
      }finally{if(token===generation)clearTimeout(deadline);}
    }
    const refresh=()=>{if(!enabled)return;cancel();timer=setTimeout(update,220);};
    sdk.event.addListener(map,'dragstart',()=>{if(enabled)cancel();});
    sdk.event.addListener(map,'zoom_start',()=>{if(enabled)cancel();});
    sdk.event.addListener(map,'idle',refresh);
    sdk.event.addListener(map,'maptypeid_changed',refresh);
    return {setEnabled(value){enabled=!!value;if(enabled)update();else{cancel();status('꺼짐');}},setConfig(value){cancel();config={key:String(value.key||'').trim(),domain:String(value.domain||'').trim(),proxyUrl:String(value.proxyUrl||'').trim()};cache.clear();if(enabled)update();},refresh};
  }
  if(typeof module!=='undefined')module.exports={createLayer,buildRequest,intersect,toMercator,fromMercator,drawTriangle,SITE_CONFIG};
  if(!root.document)return;
  let layer=null;
  function init(){
    const input=document.getElementById('zoningWmsToggle'),output=document.getElementById('zoningWmsStatus');
    if(!input||layer)return;
    if(!root.sacheonMap){input.disabled=true;output.textContent='카카오 지도를 불러온 뒤 사용할 수 있습니다.';return;}
    input.disabled=false;input.checked=false;output.textContent='꺼짐 · 사천시 용도지역';
    layer=createLayer(root.sacheonMap,root.kakao.maps,text=>{output.textContent=text;});
    input.addEventListener('change',()=>layer.setEnabled(input.checked));
  }
  init();root.addEventListener('sacheon-map-ready',init);
  root.addEventListener('resize',()=>{if(layer)layer.refresh();});
})(typeof window==='undefined'?globalThis:window);
