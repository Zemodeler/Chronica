// Organic provinces (see scripts/map-gen/README.md): cost-distance growth from seeds on a land raster, then traced into shared, smoothed arcs.
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const DATA = process.env.MAP_GEN_DATA || path.join(ROOT, '.map-gen-data');
process.chdir(DATA);
const dreq = require('module').createRequire(path.join(DATA, 'package.json'));
const fs=require('fs');const shp=dreq('shapefile');
const sharp=require('sharp');
const GJ=path.join(DATA,'coverage.geojson');
const ARG=Object.fromEntries(process.argv.slice(2).map(a=>a.split('=')));
const B={x0:+(ARG.x0??6),x1:+(ARG.x1??19),y0:+(ARG.y0??36.4),y1:+(ARG.y1??47.2)};
const OUT=ARG.out||'grow';
const S=+(ARG.s??0.01);                 // degrees of latitude per pixel
const K=Math.cos((+(ARG.klat??42.5))*Math.PI/180);   // pinned, so widening the box never moves an existing pixel
const W=Math.ceil((B.x1-B.x0)*K/S),H=Math.ceil((B.y1-B.y0)/S);
const PXKM=S*111.2;
const RIVER_RANK=+(ARG.rank??2),WARP=+(ARG.warp??1.6),FILL_R=+(ARG.fill??28),DEDUPE=+(ARG.dedupe??12);
const rowLat=y=>B.y1-(y+.5)*S;
const lonlat2px=(lon,lat)=>[(lon-B.x0)*K/S,(B.y1-lat)/S];
const px2lonlat=(x,y)=>[B.x0+x*S/K,B.y1-y*S];
const t0=Date.now();const lap=m=>console.log(m,'t+'+((Date.now()-t0)/1000).toFixed(1)+'s');
function mulberry(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const rnd=mulberry(12345);
// ---- noise
const hash=(x,y,s)=>{let h=Math.imul(x,374761393)+Math.imul(y,668265263)+Math.imul(s,2147483647);h=Math.imul(h^h>>>13,1274126177);return((h^h>>>16)>>>0)/4294967296};
const vnoise=(x,y,s)=>{const xi=Math.floor(x),yi=Math.floor(y),fx=x-xi,fy=y-yi;const u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
 const a=hash(xi,yi,s),b=hash(xi+1,yi,s),c=hash(xi,yi+1,s),d=hash(xi+1,yi+1,s);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v};
const NF=+(ARG.nf??40);
const fbm=(x,y)=>{let s=0,amp=.5,f=1/NF,n=0;for(let o=0;o<4;o++){s+=amp*vnoise(x*f,y*f,o+7);n+=amp;amp*=.5;f*=2.1}return s/n};
// ---- land raster
const gj=JSON.parse(fs.readFileSync(GJ));const polys=[];
for(const f of gj.features){const g=f.geometry;if(!g)continue;const list=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
 for(const p of list){for(const [x,y] of p[0]){if(x>=B.x0-1&&x<=B.x1+1&&y>=B.y0-1&&y<=B.y1+1){polys.push(p);break}}}}
// Where seeds are thin but the land is not empty (Iran, the Levant, the Caucasus) the far-from-a-settlement rule is not applied,
// except inside the named deserts; the sands of Arabia and the Sahara keep it.
const WET_COUNTRIES=['Iran','Georgia','Armenia','Azerbaijan','Lebanon','Israel','Palestine','Syria','Jordan','Iraq'];
const wetPolys=[];
const ARID=[[[51.3,33.3],[52.5,35.2],[55.0,35.4],[57.5,35.2],[58.3,34.0],[57.0,33.0],[54.5,32.4],[52.0,32.6]],   // Dasht-e Kavir
 [[53.5,31.8],[57.0,32.5],[58.5,30.5],[57.5,28.5],[55.0,28.6],[53.3,30.0]],                                       // Yazd and Kerman
 [[58.0,33.8],[60.6,33.0],[61.0,30.5],[59.5,28.8],[57.6,30.0],[57.4,32.4]],                                       // Dasht-e Lut
 [[59.8,31.5],[63.8,31.0],[63.8,25.0],[57.0,25.0],[57.0,27.5],[59.5,28.5]],                                       // Sistan, Baluchistan, Makran
 [[34.0,29.4],[35.5,29.4],[35.5,31.4],[34.0,31.2]],                                                               // Negev
 [[36.8,29.4],[42.6,29.6],[42.6,34.8],[38.4,35.2],[37.6,33.5],[36.6,32.0]],                                      // Transjordan steppe and the Syrian desert
 [[38.5,28.0],[42.0,28.0],[46.8,29.0],[46.3,30.4],[45.0,30.8],[44.2,31.4],[43.9,32.6],[42.9,33.3],[41.0,34.0],[38.8,32.2]],  // the Iraqi Hamad and Wadi Hauran, west of the Euphrates
 [[46.5,28.5],[48.5,28.5],[48.5,30.2],[46.5,30.2]]];                                                                 // Kuwait                                      // Transjordan steppe and the Syrian desert
// Anatolia, Egypt and Arabia: their outlines from Natural Earth 50m, added to the game's own coverage
{const cj=JSON.parse(fs.readFileSync(path.join(ROOT,'apps/web/public/maps/natural-earth-50m-admin0-countries.geojson')));
 const added=[ARG.anatolia!=='0'?'Turkey':null,...(ARG.arabia!=='0'?['Egypt','Saudi Arabia','Syria','Lebanon','Israel','Palestine','Jordan','Georgia','Armenia','Azerbaijan','Iran','Iraq','Kuwait']:[])];
 for(const f of cj.features){if(!added.includes(f.properties.ADMIN))continue;const g=f.geometry;const list=g.type==='Polygon'?[g.coordinates]:g.coordinates;
  for(const p of list){if(p[0].some(([x,y])=>x>=B.x0-1&&x<=B.x1+1&&y>=B.y0-1&&y<=B.y1+1)){polys.push(p);if(WET_COUNTRIES.includes(f.properties.ADMIN))wetPolys.push(p)}}}}
const ringPath=r=>'M'+r.map(([x,y])=>{const [a,b]=lonlat2px(x,y);return a.toFixed(1)+','+b.toFixed(1)}).join('L')+'Z';
async function rasterSvg(inner){const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#000"/>${inner}</svg>`;
 return sharp(Buffer.from(svg),{density:72}).removeAlpha().greyscale().raw().toBuffer();}
(async()=>{
 const landBuf=await rasterSvg(polys.map(p=>`<path d="${p.map(ringPath).join('')}" fill="#fff" fill-rule="evenodd"/>`).join(''));
 const land=new Uint8Array(W*H);for(let i=0;i<W*H;i++)land[i]=landBuf[i]>127?1:0;
 const boxMean=(src,R)=>{const tmp=new Float32Array(W*H),o=new Float32Array(W*H);const pr=new Float64Array(Math.max(W,H)+1);
  for(let y=0;y<H;y++){pr[0]=0;for(let x=0;x<W;x++)pr[x+1]=pr[x]+src[y*W+x];for(let x=0;x<W;x++){const lo=Math.max(0,x-R),hi=Math.min(W-1,x+R);tmp[y*W+x]=(pr[hi+1]-pr[lo])/(hi-lo+1)}}
  for(let x=0;x<W;x++){pr[0]=0;for(let y=0;y<H;y++)pr[y+1]=pr[y]+tmp[y*W+x];for(let y=0;y<H;y++){const lo=Math.max(0,y-R),hi=Math.min(H-1,y+R);o[y*W+x]=(pr[hi+1]-pr[lo])/(hi-lo+1)}}return o};
// The desert belt of Africa (mode 2: solid belts) and the Sirhan/Najd corner of Arabia (mode 1: strips, tidied) are shaped by their own
 // rules, described in the README; every other pixel behaves as everywhere else.
 const lonAt=x=>B.x0+(x+.5)*S/K;
 const modeAt=(lon,lat)=>{if(lon>=-18&&lon<=37&&lat>=15.5&&lat<=35.5)return 2;if(lon>=34&&lon<=56&&lat>=15.5&&lat<=33.5)return 1;return 0};
 const mode=new Uint8Array(W*H);for(let y=0;y<H;y++){const la=rowLat(y);if(la<15.5||la>35.5)continue;for(let x=0;x<W;x++)mode[y*W+x]=modeAt(lonAt(x),la)}
 const isCanary=(lo,la)=>lo<-12.5&&la>27.3&&la<29.8;
 const canary=new Uint8Array(W*H);for(let y=0;y<H;y++){const la=rowLat(y);if(la<=27.3||la>=29.8)continue;for(let x=0;x<W;x++)if(lonAt(x)<-12.5)canary[y*W+x]=1}   // the islands are not shaped by the belt's filters
 // the towns that must survive as places: the old map's and every polity file's
 const keepPts=[];try{for(const st of JSON.parse(fs.readFileSync(path.join(DATA,ARG.keep||'old-map.json'))).settlements)keepPts.push(lonlat2px(st.coordinate[0],st.coordinate[1]))}catch(e){}
 for(const f of fs.readdirSync(__dirname).filter(f=>/-polities\.json$/.test(f))){try{const file=JSON.parse(fs.readFileSync(path.join(__dirname,f)));for(const st of [...file.polities.flatMap(pol=>[pol.capital,...(pol.otherSettlements||[])]),...(file.seleucidCities||[]).filter(c=>!/apamea-tigris|charax-alexandria/.test(c.settlementId))])if(st&&isFinite(st.lon))keepPts.push(lonlat2px(st.lon,st.lat))}catch(e){}}
 let sandBuf,ctryBuf,wetOuter=null;
 // The Sahara and Arabia are masked by their natural continental outline, not by the game's old polygons or by national borders,
 // so what survives there is decided by settlements, rivers and coast and its edges follow them, not a ruler.
 {const cj=JSON.parse(fs.readFileSync(path.join(ROOT,'apps/web/public/maps/natural-earth-50m-admin0-countries.geojson')));
  const inB=co=>co.some(([x,y])=>x>B.x0-.5&&x<B.x1+.5&&y>B.y0-.5&&y<B.y1+.5);
  const BELT=['Libya','Algeria','Tunisia','Morocco','Western Sahara','Egypt','Sudan','Chad','Niger','Mali','Mauritania','Jordan','Syria','Iraq','Saudi Arabia','Kuwait','Israel','Palestine'];
  let every='',belt='';
  for(const f of cj.features){const gm=f.geometry;if(!gm)continue;const list=gm.type==='Polygon'?[gm.coordinates]:gm.type==='MultiPolygon'?gm.coordinates:[];
   for(const p of list){if(!inB(p[0]))continue;const d=`<path d="${p.map(ringPath).join('')}" fill="#fff" fill-rule="evenodd"/>`;every+=d;if(BELT.includes(f.properties.ADMIN))belt+=d}}
  ctryBuf=await rasterSvg(every);
  if(ARG.belt!=='0'){const beltBuf=await rasterSvg(belt);const seaEarly=new Float32Array(W*H);for(let i=0;i<W*H;i++)seaEarly[i]=ctryBuf[i]>127?0:1;
   const nearSea=boxMean(seaEarly,+(ARG.beltcoast??7));let added=0;
   // the belt's southern edge wanders (about 18 to 22 N), so the empty Sahara beyond it does not end in a ruler-straight line
   for(let y=0;y<H;y++){const la=rowLat(y);if(la<15.4||la>+(ARG.belthi??33))continue;
    for(let x=0;x<W;x++){const i=y*W+x;const lo=lonAt(x);const low=(lo>=28&&lo<=36.5)?15.4:+(ARG.beltlo??20)+1.8*(2*vnoise(x/280,y/280,99)-1);if(la<low)continue;if(!land[i]&&beltBuf[i]>127&&nearSea[i]<0.0005){land[i]=1;added++}}}
   console.log('desert belt: natural land added, px',added)}}
 const land0=Uint8Array.from(land);   // the mask before lakes and gaps are cut: what is not land here is sea or off the map
 // lakes cut from land, rivers as barrier raster
 const inBox=co=>co.some(([x,y])=>x>B.x0-.5&&x<B.x1+.5&&y>B.y0-.5&&y<B.y1+.5);
 let lakeSvg='';{const s=await shp.open('data/awmc/inland water/'+fs.readdirSync('data/awmc/inland water').find(x=>x.endsWith('.shp')));
  for(;;){const r=await s.read();if(r.done)break;const t=(r.value.properties.TYPE||'').toLowerCase();if(t!=='lake'&&t!=='swamp'&&t!=='inundation area')continue;const g=r.value.geometry;
   const list=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
   for(const p of list){if(!inBox(p[0]))continue;if(t==='lake')lakeSvg+=`<path d="${p.map(ringPath).join('')}" fill="#fff" fill-rule="evenodd"/>`}}}
 const lakeBuf=await rasterSvg(lakeSvg);const lakeMask=Uint8Array.from(lakeBuf,v=>v>127?1:0);let lakes=0;for(let i=0;i<W*H;i++)if(lakeBuf[i]>127&&land[i]){land[i]=0;lakes++}
 let riverSvg='',riverMainSvg='';let nr=0;{const s=await shp.open('data/awmc/rivers/'+fs.readdirSync('data/awmc/rivers').find(x=>x.endsWith('.shp')));
  for(;;){const r=await s.read();if(r.done)break;if(!(r.value.properties.rank<=RIVER_RANK))continue;const g=r.value.geometry;
   const lines=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[];
   for(const l of lines){if(!inBox(l))continue;nr++;const d=`<path d="M${l.map(([x,y])=>{const [a,b]=lonlat2px(x,y);return a.toFixed(1)+','+b.toFixed(1)}).join('L')}" fill="none" stroke="#fff" stroke-width="1.4"/>`;riverSvg+=d;if(r.value.properties.rank<=1&&r.value.properties.perennial===1)riverMainSvg+=d}}}
 const rivBuf=await rasterSvg(riverSvg);const river=new Uint8Array(W*H);for(let i=0;i<W*H;i++)river[i]=rivBuf[i]>100?1:0;
 const rivMainBuf=await rasterSvg(riverMainSvg);const riverMain=new Uint8Array(W*H);for(let i=0;i<W*H;i++)riverMain[i]=rivMainBuf[i]>100?1:0;
 lap(`raster ${W}x${H}, land px ${land.reduce((a,b)=>a+b,0)}, lake px ${lakes}, river lines ${nr}`);
 // ---- seeds
 // every town the eastern polity files name gets a seed of its own, first in line, so it is never cut away as empty desert
 const forced=[];if(ARG.arabia!=='0')for(const f of ['egypt-arabia-polities.json','levant-caucasus-iran-polities.json','iraq-polities.json']){try{const file=JSON.parse(fs.readFileSync(path.join(__dirname,f)));for(const st of [...file.polities.flatMap(pol=>[pol.capital,...(pol.otherSettlements||[])]),...(file.seleucidCities||[]).filter(c=>!/apamea-tigris|charax-alexandria/.test(c.settlementId))])if(st&&!st.offMap&&isFinite(st.lon))forced.push([st.lon,st.lat,st.name,'polity-file:'+st.settlementId])}catch(e){}}
 const all=[...forced,...JSON.parse(fs.readFileSync(ARG.seeds||'seeds270.json'))];const seeds=[];const grid=new Map();const GC=Math.max(DEDUPE,FILL_R);
 const near=(x,y,r)=>{const gx=Math.floor(x/GC),gy=Math.floor(y/GC);for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){const g=grid.get((gx+a)+','+(gy+b));if(g)for(const i of g){if(Math.hypot(seeds[i][0]-x,seeds[i][1]-y)<r)return true}}return false};
 const add=(x,y,name,src,lo,la,pid)=>{seeds.push([x,y,name,src,lo,la,pid]);const k=Math.floor(x/GC)+','+Math.floor(y/GC);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(seeds.length-1)};
 const snap=(x,y)=>{x=Math.round(x);y=Math.round(y);for(let r=0;r<=5;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const nx=x+dx,ny=y+dy;if(nx>=0&&ny>=0&&nx<W&&ny<H&&land[ny*W+nx])return[nx,ny]}return null};
 let pl=0;for(const s of all){if(s[0]<B.x0||s[0]>B.x1||s[1]<B.y0||s[1]>B.y1)continue;const [x,y]=lonlat2px(s[0],s[1]);const p=snap(x,y);if(!p)continue;if(near(p[0],p[1],DEDUPE))continue;add(p[0],p[1],s[2],'pleiades',s[0],s[1],s[3]);pl++}
 // ---- cost-distance growth (multi-source Dijkstra)
 // ruggedness from the Natural Earth II relief already in the repo (equirectangular, 4000x2000)
 const NE2=path.join(ROOT,'apps/web/public/maps/natural-earth-ii-blue-oceans.png');
 const nx=lon=>(lon+180)/360*4000,ny=lat=>(90-lat)/180*2000;
 const relBuf=await sharp(NE2).extract({left:Math.floor(nx(B.x0)),top:Math.floor(ny(B.y1)),width:Math.ceil(nx(B.x1)-nx(B.x0)),height:Math.ceil(ny(B.y0)-ny(B.y1))}).resize({width:W,height:H,fit:'fill',kernel:'cubic'}).greyscale().raw().toBuffer();
 const rug=new Float32Array(W*H);{const R=5;for(let y=R;y<H-R;y++)for(let x=R;x<W-R;x++){const i=y*W+x;rug[i]=Math.abs(relBuf[i+R]-relBuf[i-R])+Math.abs(relBuf[i+R*W]-relBuf[i-R*W])}
  // box blur then normalise
  const tmp=new Float32Array(W*H),BR=7;for(let y=0;y<H;y++){let s=0;for(let x=0;x<W;x++){s+=rug[y*W+x];if(x>=2*BR+1)s-=rug[y*W+x-2*BR-1];tmp[y*W+Math.max(0,x-BR)]=s/(2*BR+1)}}
  for(let x=0;x<W;x++){let s=0;for(let y=0;y<H;y++){s+=tmp[y*W+x];if(y>=2*BR+1)s-=tmp[(y-2*BR-1)*W+x];rug[Math.max(0,y-BR)*W+x]=s/(2*BR+1)}}
  const vals=[];for(let i=0;i<W*H;i+=17)if(land[i])vals.push(rug[i]);vals.sort((a,b)=>a-b);const p95=vals[Math.floor(vals.length*.95)]||1;for(let i=0;i<W*H;i++)rug[i]=Math.min(1,rug[i]/p95)}
 // ---- real elevation: AWS Terrarium tiles (z7) -> elev (m) on our grid, slope and crest (topographic position)
 const Z=7,NT=2**Z;const tx=lon=>Math.floor((lon+180)/360*NT),tyf=lat=>{const r=lat*Math.PI/180;return(1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*NT};
 const TX0=tx(B.x0)-1,TX1=tx(B.x1)+1,TY0=Math.floor(tyf(B.y1))-1,TY1=Math.floor(tyf(B.y0))+1;
 const MW=(TX1-TX0+1)*256,MH=(TY1-TY0+1)*256;const mos=new Float32Array(MW*MH).fill(-32768);
 for(let X=TX0;X<=TX1;X++)for(let Y=TY0;Y<=TY1;Y++){const f=`data/terrarium/${Z}/${X}/${Y}.png`;if(!fs.existsSync(f))continue;
  const t=await sharp(f).removeAlpha().raw().toBuffer();for(let j=0;j<256;j++)for(let i=0;i<256;i++){const o=(j*256+i)*3;mos[((Y-TY0)*256+j)*MW+(X-TX0)*256+i]=t[o]*256+t[o+1]+t[o+2]/256-32768}}
 const elev=new Float32Array(W*H);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const [lo,la]=px2lonlat(x+.5,y+.5);const mx=((lo+180)/360*NT-TX0)*256,my=(tyf(la)-TY0)*256;
  const ix=Math.floor(mx),iy=Math.floor(my),fx=mx-ix,fy=my-iy;const g=(a,b)=>mos[Math.min(MH-1,Math.max(0,b))*MW+Math.min(MW-1,Math.max(0,a))];
  elev[y*W+x]=g(ix,iy)*(1-fx)*(1-fy)+g(ix+1,iy)*fx*(1-fy)+g(ix,iy+1)*(1-fx)*fy+g(ix+1,iy+1)*fx*fy}

 // sea is a big negative-free plain; clamp so coasts do not read as cliffs
 for(let i=0;i<W*H;i++)if(!land[i])elev[i]=Math.max(0,elev[i]);
 const CR=+(ARG.crestr??9);const mean=boxMean(elev,CR);
 const crest=new Float32Array(W*H),slp=new Float32Array(W*H);let emax=0;
 for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const i=y*W+x;const gx=(elev[i+1]-elev[i-1])/(2*PXKM),gy=(elev[i+W]-elev[i-W])/(2*PXKM);slp[i]=Math.min(2,Math.hypot(gx,gy)/150);
  crest[i]=Math.max(0,Math.min(2,(elev[i]-mean[i])/200));if(land[i]&&elev[i]>emax)emax=elev[i]}
 lap(`elevation loaded, max ${emax.toFixed(0)} m`);
 // ---- impassable gaps: high massifs, sand deserts, and far-from-settlement southern land
 // (needs elevation, so it is computed here from a fresh light DEM read below via lazy hook)
 {
  const HL=+(ARG.hl??2000);
  // sand polygons
  let sandSvg='';{const dir='data/awmc/inland_sand/';const s=await shp.open(dir+fs.readdirSync(dir).find(x=>x.endsWith('.shp')));
   for(;;){const r=await s.read();if(r.done)break;const g=r.value.geometry;const list=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
    for(const p of list){if(!inBox(p[0]))continue;sandSvg+=`<path d="${p.map(ringPath).join('')}" fill="#fff" fill-rule="evenodd"/>`}}}
  sandBuf=await rasterSvg(sandSvg);
  const wetBuf=await rasterSvg(wetPolys.map(p=>`<path d="${p.map(ringPath).join('')}" fill="#fff" fill-rule="evenodd"/>`).join(''));
  const aridBuf=await rasterSvg(ARID.map(r=>`<path d="${ringPath(r)}" fill="#fff"/>`).join(''));
  const wetMask=new Uint8Array(W*H);for(let i=0;i<W*H;i++)wetMask[i]=wetBuf[i]>127&&aridBuf[i]<=127?1:0;
  wetOuter=wetMask;
  // far grid over real seeds
  const FG=new Map();const FC=200;for(let i=0;i<seeds.length;i++){const k=Math.floor(seeds[i][0]/FC)+','+Math.floor(seeds[i][1]/FC);if(!FG.has(k))FG.set(k,[]);FG.get(k).push(i)}
  // a lone seed keeps only a small disc; one with company keeps up to three quarters of the way to its nearest neighbour, so seeds do not swell into blobs
  const ISO=+(ARG.iso??54),LONE_R=+(ARG.lone??12);
  const seedR=seeds.map((s,i)=>{const gx=Math.floor(s[0]/FC),gy=Math.floor(s[1]/FC);let nn=Infinity;for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){const g=FG.get((gx+a)+','+(gy+b));if(g)for(const j of g)if(j!==i)nn=Math.min(nn,Math.hypot(seeds[j][0]-s[0],seeds[j][1]-s[1]))}return nn>ISO?LONE_R:Math.max(LONE_R,nn*.75)});
  const farFromSeed=(x,y,FAR,t,cap)=>{const gx=Math.floor(x/FC),gy=Math.floor(y/FC);for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){const g=FG.get((gx+a)+','+(gy+b));if(g)for(const i of g)if(Math.hypot(seeds[i][0]-x,seeds[i][1]-y)<Math.min(cap||1e9,t>=1?FAR:Math.min(FAR,seedR[i]+(FAR-seedR[i])*t)))return false}return true};
  let cut={high:0,sand:0,south:0};
  // true sea from full country outlines (not just the game's coverage), so mask edges are not mistaken for coast
  const seaInd=new Float32Array(W*H);for(let i=0;i<W*H;i++)seaInd[i]=ctryBuf[i]>127?0:1;
  const coastNear=boxMean(seaInd,+(ARG.coast??12)),riverNear=boxMean(Float32Array.from(river),+(ARG.rivnear??8));
  const FAR0=+(ARG.far0??30),FSL=+(ARG.fslope??10),FLAT=+(ARG.flat??31);
  const far=y=>{const lat=B.y1-y*S;return Math.max(25,FAR0+(lat-FLAT)*FSL)};
  const SCAP=+(ARG.scap??16);
  const riverMainNear=boxMean(Float32Array.from(riverMain),+(ARG.rivmain??6));
  for(let y=0;y<H;y++){const R=far(y);if(R>200)continue;for(let x=0;x<W;x++){const i=y*W+x;if(!land[i])continue;
   const high=elev[i]>HL,m=mode[i];
   if(wetMask[i]&&!high)continue;
   if(coastNear[i]>0.0005||(m?riverMainNear[i]:riverNear[i])>0.0005){if(!high)continue}
   if(m===2&&!high)continue;   // solid belts are decided after this loop, by distance from coast, river and town
   const sand=sandBuf[i]>127;
   const limit=high?Math.min(R,40):sand?Math.min(R,45):R;
   if(!farFromSeed(x,y,limit,Math.max(0,Math.min(1,(rowLat(y)-(+(ARG.dry??33)))/4)),m?SCAP:0))continue;
   land[i]=0;if(high)cut.high++;else if(sand)cut.sand++;else cut.south++}}
  {
   // ends: the Atlantic coast stops at Tarfaya and Cape Juby, the Nile at Syene and Philae
   const CAP=+(ARG.cap??34);
   for(let y=0;y<H;y++){const la=rowLat(y);if(la<15.5||la>35.5)continue;for(let x=0;x<W;x++){const i=y*W+x;if(!mode[i])continue;const lo=lonAt(x);
    // both ends round off in a cap round the last attested place: Tarfaya (Cape Juby) on the Atlantic, Meroe on the Nile
    const cap=(cx,cy)=>{const [tx,ty]=lonlat2px(cx,cy);return Math.hypot(x-tx,y-ty)<=CAP};
    if(lo<-6&&la<27.95&&!cap(-12.93,27.95))land[i]=0;
    else if(lo>=28&&lo<=36.5&&la<16.93&&!cap(33.72,16.93))land[i]=0}}
   // the band: land within RB px of a coast or a main river, or RT px of a town, by true distance (chamfer), tapering to a rounded end at the Atlantic and Nubian ends (the Canaries are islands and keep the full band)
   const yb=Math.max(0,Math.floor((B.y1-35.7)/S)),Hs=H-yb;
   const chamfer=(pred)=>{const d=new Float32Array(W*Hs).fill(1e9);for(let i=0;i<W*Hs;i++)if(pred(i+yb*W))d[i]=0;return relax(d)};
   const relax=d=>{
    for(let y=0;y<Hs;y++)for(let x=0;x<W;x++){const i=y*W+x;let v=d[i];if(x>0&&d[i-1]+1<v)v=d[i-1]+1;if(y>0){if(d[i-W]+1<v)v=d[i-W]+1;if(x>0&&d[i-W-1]+1.414<v)v=d[i-W-1]+1.414;if(x<W-1&&d[i-W+1]+1.414<v)v=d[i-W+1]+1.414}d[i]=v}
    for(let y=Hs-1;y>=0;y--)for(let x=W-1;x>=0;x--){const i=y*W+x;let v=d[i];if(x<W-1&&d[i+1]+1<v)v=d[i+1]+1;if(y<Hs-1){if(d[i+W]+1<v)v=d[i+W]+1;if(x<W-1&&d[i+W+1]+1.414<v)v=d[i+W+1]+1.414;if(x>0&&d[i+W-1]+1.414<v)v=d[i+W-1]+1.414}d[i]=v}return d};
   const RB=+(ARG.bband??108),RT=+(ARG.btown??24);
   const dSea=chamfer(p=>seaInd[p]>0),dRiver=chamfer(p=>riverMain[p]>0),dTown=new Float32Array(W*Hs).fill(1e9);
   for(const [px,py] of keepPts){const x=Math.round(px),y=Math.round(py)-yb;if(x>=0&&y>=0&&x<W&&y<Hs)dTown[y*W+x]=0}
   relax(dTown);
   let outside=0;
   for(let y=yb;y<H;y++){const la=rowLat(y);for(let x=0;x<W;x++){const p=y*W+x;if(mode[p]!==2||!land[p]||wetMask[p])continue;const lo=lonAt(x),i=p-yb*W;
    let Rc=RB,Rr=RB;
    if(lo<-6&&la<31&&!isCanary(lo,la))Rc=Rr=RB*Math.max(0.35,(la-27.5)/3.5);
    else if(lo>25&&lo<37&&la<26.5){const t=Math.max(0,Math.min(1,(la-24)/2.5));Rr=+(ARG.nubia??30)+(RB-+(ARG.nubia??30))*t;Rc=lo>=33.3?RB*Math.max(0,Math.min(1,(la-23.6)/2.9)):0}   // south of Egypt the Nile keeps a narrow band and the Red Sea shore tapers to a point
    if(!(dSea[i]<=Rc||dRiver[i]<=Rr||dTown[i]<=RT)){land[p]=0;outside++}}}
   console.log('solid belts: land beyond the band dropped, px',outside);
   // combs, stubs and pinches: close the small gaps, open away what is too thin to be a country, then round the edge with a mean filter
   {const dil=(m,R)=>{const d=boxMean(m,R);const o=new Float32Array(W*H);for(let i=0;i<W*H;i++)o[i]=d[i]>0.0005?1:0;return o};
    const ero=(m,R)=>{const d=boxMean(m,R);const o=new Float32Array(W*H);for(let i=0;i<W*H;i++)o[i]=d[i]>0.9995?1:0;return o};
    const rc=+(ARG.bclose??6),ro=+(ARG.bopen??9);
    const closed=ero(dil(Float32Array.from(land),rc),rc),opened=dil(ero(closed,ro),ro);let n=0;
    for(let i=0;i<W*H;i++){if(!mode[i]||wetMask[i]||canary[i])continue;const v=opened[i]>0&&land0[i]?1:0;if(v!==land[i]){land[i]=v;n++}}
    const sm=boxMean(Float32Array.from(land),+(ARG.bsmooth??10));let m2=0;
    for(let i=0;i<W*H;i++){if(!mode[i]||wetMask[i]||canary[i]||!land0[i]||lakeMask[i])continue;const v=sm[i]>0.5?1:0;if(v!==land[i]){land[i]=v;m2++}}
    console.log('morphology changed px',n,'| edge rounding changed px',m2)}
   // an enclosed stretch of low ground the band left out is part of the country round it (an enclosed massif stays impassable)
   {const seen=new Uint8Array(W*H),HFILL=+(ARG.hfill??30000);let filled=0,holes=0;
    for(let i0=yb*W;i0<W*H;i0++){if(land[i0]||seen[i0]||!land0[i0]||lakeMask[i0]||!mode[i0])continue;
     const st=[i0],comp=[];seen[i0]=1;let open=false;
     while(st.length){const p=st.pop();comp.push(p);const x=p%W,y=(p/W)|0;if(x===0||x===W-1||y===H-1||!land0[p]||!mode[p]||wetMask[p])open=true;
      for(const q of [p-1,p+1,p-W,p+W]){if(q<yb*W||q>=W*H||seen[q]||land[q]||lakeMask[q])continue;if((q===p-1&&x===0)||(q===p+1&&x===W-1))continue;if(!land0[q]||!mode[q]||wetMask[q]){open=true;continue}seen[q]=1;st.push(q)}}
     if(open||comp.length>HFILL)continue;holes++;for(const p of comp)if(elev[p]<=HL){land[p]=1;filled++}}
    console.log('enclosed low ground filled: holes',holes,'px',filled)}
   // a town is never cut away: it keeps a compact province (a disc of about 10 px, 11 km) round it
   for(const [px,py] of keepPts){const cx=Math.round(px),cy=Math.round(py);if(cx<0||cy<0||cx>=W||cy>=H||!mode[cy*W+cx])continue;
    // a town off the mask's shore (Failaka, Tarut, Tylos) is an island of its own if land lies within 60 px
    const offshore=!land0[cy*W+cx];let R=10;
    if(offshore){let near=false;for(let dy=-60;dy<=60&&!near;dy+=2)for(let dx=-60;dx<=60;dx+=2){const x=cx+dx,y=cy+dy;if(x>=0&&y>=0&&x<W&&y<H&&land0[y*W+x]){near=true;break}}if(!near)continue;R=8}
    for(let dy=-R;dy<=R;dy++)for(let dx=-R;dx<=R;dx++){const x=cx+dx,y=cy+dy;if(x<0||y<0||x>=W||y>=H||dx*dx+dy*dy>R*R)continue;const i=y*W+x;if(mode[i]&&!wetMask[i]&&(offshore||land0[i]))land[i]=1}}
  }
  console.log('gap px',cut);}
 // poisson fill in random pixel order
 // fillers a previous run placed stay where they were (so widening the map moves nothing already made); new ground is filled in an order set by pixel position alone
 let fill=0;
 if(ARG.pin){for(const [x,y] of JSON.parse(fs.readFileSync(ARG.pin)))if(x<W&&y<H&&land[y*W+x]){add(x,y,null,"fill");fill++}}
 const scatter=(x,y)=>{let h=Math.imul(x,374761393)^Math.imul(y,668265263);h=Math.imul(h^h>>>13,1274126177);return(h^h>>>16)>>>0};
 const order=[];for(let y=0;y<H;y++)for(let x=0;x<W;x+=3)if(land[y*W+x])order.push([x,y,scatter(x,y)]);order.sort((a,b)=>a[2]-b[2]||a[1]-b[1]||a[0]-b[0]);
 for(const [x,y] of order){if(!near(x,y,FILL_R)){add(x,y,null,'fill');fill++}}
 fs.writeFileSync(OUT+'.fill.json',JSON.stringify(seeds.filter(sd=>sd[3]==='fill').map(sd=>[sd[0],sd[1]])));
 // every land island gets a seed
 const comp=new Int32Array(W*H).fill(-1);let nc=0;const hasSeed=[];const seedAt=new Set(seeds.map(s=>s[1]*W+s[0]));
 for(let i0=0;i0<W*H;i0++){if(!land[i0]||comp[i0]>=0)continue;const st=[i0];comp[i0]=nc;let n=0,has=false;while(st.length){const p=st.pop();n++;if(seedAt.has(p))has=true;const x=p%W,y=(p/W)|0;
  for(const q of [x>0?p-1:-1,x<W-1?p+1:-1,y>0?p-W:-1,y<H-1?p+W:-1]){if(q>=0&&land[q]&&comp[q]<0){comp[q]=nc;st.push(q)}}}
  if(!has&&n>=25){add(i0%W,(i0/W)|0,null,'islet')}nc++}
 lap(`seeds pleiades ${pl} fill ${fill} total ${seeds.length}`);
 {const sh=Buffer.alloc(W*H);for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const i=y*W+x;const dzdx=(elev[i+1]-elev[i-1])/(2*PXKM*1000),dzdy=(elev[i+W]-elev[i-W])/(2*PXKM*1000);
  const v=Math.max(0,Math.min(1,(.5+(-dzdx*.7-dzdy*.7)*1.8)));sh[i]=land[i]?Math.round(60+v*190):40}
  await sharp(sh,{raw:{width:W,height:H,channels:1}}).png().toFile(OUT+'_shade.png')}
 const RUG=+(ARG.rug??0),RIDGE=+(ARG.ridge??2.5),CREST=+(ARG.crest??3),SLOPEW=+(ARG.slope??1.5);
 const ridged=(x,y)=>{let s=0,amp=.6,f=1/(NF*1.4),n=0;for(let o=0;o<3;o++){const v=1-Math.abs(2*vnoise(x*f,y*f,o+31)-1);s+=amp*v*v*v;n+=amp;amp*=.5;f*=2.2}return s/n};
 const wgt=new Float32Array(W*H);for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;wgt[i]=1+WARP*fbm(x,y)+RIDGE*ridged(x,y)+RUG*rug[i]+CREST*crest[i]+SLOPEW*slp[i]+(river[i]?7:0)}
 const dist=new Float32Array(W*H).fill(Infinity),lab=new Int32Array(W*H).fill(-1);
 let hp=new Int32Array(1<<20),hk=new Float32Array(1<<20),hn=0;
 const push=(id,k)=>{if(hn>=hp.length){const np=new Int32Array(hp.length*2),nk=new Float32Array(hk.length*2);np.set(hp);nk.set(hk);hp=np;hk=nk}let i=hn++;while(i>0){const p=(i-1)>>1;if(hk[p]<=k)break;hp[i]=hp[p];hk[i]=hk[p];i=p}hp[i]=id;hk[i]=k};
 const pop=()=>{const id=hp[0],k=hk[0];const lid=hp[--hn],lk=hk[hn];let i=0;for(;;){let c=2*i+1;if(c>=hn)break;if(c+1<hn&&hk[c+1]<hk[c])c++;if(hk[c]>=lk)break;hp[i]=hp[c];hk[i]=hk[c];i=c}hp[i]=lid;hk[i]=lk;return[id,k]};
 seeds.forEach((s,i)=>{const id=s[1]*W+s[0];dist[id]=0;lab[id]=i;push(id,0)});
 const DX=[1,-1,0,0,1,1,-1,-1],DY=[0,0,1,-1,1,-1,1,-1],DL=[1,1,1,1,1.414,1.414,1.414,1.414];
 while(hn>0){const [id,k]=pop();if(k>dist[id])continue;const x=id%W,y=(id/W)|0;
  for(let d=0;d<8;d++){const nx=x+DX[d],ny=y+DY[d];if(nx<0||ny<0||nx>=W||ny>=H)continue;const q=ny*W+nx;if(!land[q])continue;
   const nk=k+DL[d]*(wgt[id]+wgt[q])*.5;if(nk<dist[q]){dist[q]=nk;lab[q]=lab[id];push(q,nk)}}}
 lap('growth done');
 // drop tiny cells: merge into neighbour sharing the longest border
 const MIN=+(ARG.min??70);
 for(let pass=0;pass<3;pass++){const cnt=new Int32Array(seeds.length);for(let i=0;i<W*H;i++)if(lab[i]>=0)cnt[lab[i]]++;
  const border=new Map();for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x,l=lab[i];if(l<0||cnt[l]>=MIN)continue;
   for(const q of [x<W-1?i+1:-1,y<H-1?i+W:-1,x>0?i-1:-1,y>0?i-W:-1]){if(q<0)continue;const m=lab[q];if(m>=0&&m!==l){const k=l+','+m;border.set(k,(border.get(k)||0)+1)}}}
  const best=new Map();for(const [k,v] of border){const [l,m]=k.split(',').map(Number);if(!best.has(l)||best.get(l)[1]<v)best.set(l,[m,v])}
  if(!best.size)break;for(let i=0;i<W*H;i++){const l=lab[i];if(l>=0&&best.has(l))lab[i]=best.get(l)[0]}}
 // tiny cells by real area (the raster is stretched by latitude): merge into the neighbour with the longest border, or drop if it touches nobody
 const rowKm2=y=>PXKM*PXKM*Math.cos(rowLat(y)*Math.PI/180)/K;
 const rowDxKm=y=>PXKM*Math.cos(rowLat(y)*Math.PI/180)/K;
 {const area=new Float64Array(seeds.length);for(let y=0;y<H;y++){const a=rowKm2(y);for(let x=0;x<W;x++){const l=lab[y*W+x];if(l>=0)area[l]+=a}}
  const touch=new Map();for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x,l=lab[i];if(l<0||area[l]>=5)continue;
   for(const q of [x<W-1?i+1:-1,y<H-1?i+W:-1,x>0?i-1:-1,y>0?i-W:-1]){if(q<0)continue;const m=lab[q];if(m>=0&&m!==l){const k=l+','+m;touch.set(k,(touch.get(k)||0)+1)}}}
  const best=new Map();for(const [k,v] of touch){const [l,m]=k.split(',').map(Number);if(!best.has(l)||best.get(l)[1]<v)best.set(l,[m,v])}
  let merged=0,dropped=0;for(let i=0;i<W*H;i++){const l=lab[i];if(l<0||area[l]>=5)continue;if(best.has(l)){lab[i]=best.get(l)[0];merged++}else if(area[l]<30){lab[i]=-1;dropped++}}
  console.log('cells under 5 km2: merged px',merged,'| isolated islets under 30 km2 dropped px',dropped)}

 // ---- cell-level tidying of the desert belt: rings, stubs, orphans
 {
  const nC=seeds.length,y0=Math.max(0,Math.floor((B.y1-35.7)/S));
  const cnt=new Int32Array(nC),sx=new Float64Array(nC),sy=new Float64Array(nC),coastal=new Uint8Array(nC),wetPx=new Int32Array(nC);
  const nbr=new Array(nC).fill(null);const link=(a,b)=>{if(a===b)return;(nbr[a]||(nbr[a]=new Set())).add(b);(nbr[b]||(nbr[b]=new Set())).add(a)};
  for(let y=y0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x,l=lab[i];if(l<0)continue;cnt[l]++;sx[l]+=x;sy[l]+=y;if(wetOuter&&wetOuter[i])wetPx[l]++;
   if(x<W-1){const m=lab[i+1];if(m>=0)link(l,m);else if(!land0[i+1])coastal[l]=1}
   if(y<H-1){const m=lab[i+W];if(m>=0)link(l,m);else if(!land0[i+W])coastal[l]=1}
   if(x>0&&lab[i-1]<0&&!land0[i-1])coastal[l]=1;if(y>0&&lab[i-W]<0&&!land0[i-W])coastal[l]=1}
  const candidate=new Uint8Array(nC);
  for(let l=0;l<nC;l++){if(!cnt[l])continue;const cx=Math.round(sx[l]/cnt[l]),cy=Math.round(sy[l]/cnt[l]);
   if(mode[cy*W+cx]&&rowLat(cy)<34.6&&wetPx[l]<0.5*cnt[l]&&!isCanary(lonAt(cx),rowLat(cy)))candidate[l]=1}
  const prot=new Set();
  for(const [px,py] of keepPts){const cx=Math.round(px),cy=Math.round(py);let found=-1;
   for(let r=0;r<=4&&found<0;r++)for(let dy=-r;dy<=r&&found<0;dy++)for(let dx=-r;dx<=r;dx++){const x=cx+dx,y=cy+dy;if(x<0||y<0||x>=W||y>=H)continue;if(lab[y*W+x]>=0){found=lab[y*W+x];break}}
   if(found>=0)prot.add(found)}
  const dead=new Uint8Array(nC);
  const degree=l=>{let d=0;if(nbr[l])for(const m of nbr[l])if(!dead[m])d++;return d};
  const kill=list=>{for(const l of list)dead[l]=1;const set=new Set(list);for(let i=0;i<W*H;i++)if(lab[i]>=0&&set.has(lab[i]))lab[i]=-1};
  // rings: an enclosed stretch of ground the rules cut away, with strips all round it, is opened at the point farthest from a town
  let rings=0;
  {
   // A ring is ground the rules cut away that strips of country almost close round: strips whose gaps are under GAP px either side count as closed.
   const Hs=H-y0,GAP=+(ARG.ringgap??26),HOLE_MIN=+(ARG.holemin??400);const protXY=[...prot].filter(l=>cnt[l]>0).map(l=>[sx[l]/cnt[l],sy[l]/cnt[l]]);
   const dil=(m,R)=>{const tmp=new Int32Array(W*Hs),out=new Uint8Array(W*Hs),pr=new Int32Array(Math.max(W,Hs)+1);
    for(let y=0;y<Hs;y++){pr[0]=0;for(let x=0;x<W;x++)pr[x+1]=pr[x]+m[y*W+x];for(let x=0;x<W;x++)tmp[y*W+x]=pr[Math.min(W,x+R+1)]-pr[Math.max(0,x-R)]}
    for(let x=0;x<W;x++){pr[0]=0;for(let y=0;y<Hs;y++)pr[y+1]=pr[y]+tmp[y*W+x];for(let y=0;y<Hs;y++)out[y*W+x]=pr[Math.min(Hs,y+R+1)]-pr[Math.max(0,y-R)]>0?1:0}return out};
   for(let round=0;round<40;round++){
    const filled=new Uint8Array(W*Hs);for(let i=0;i<W*Hs;i++)filled[i]=lab[y0*W+i]>=0?1:0;
    const blocked=dil(filled,GAP);const seen=new Uint8Array(W*Hs);let opened=false;
    for(let i0=0;i0<W*Hs&&!opened;i0++){if(blocked[i0]||seen[i0])continue;
     const st=[i0],hole=[];seen[i0]=1;let open=false;
     while(st.length){const p=st.pop();hole.push(p);const x=p%W,y=(p/W)|0,ab=p+y0*W;if(x===0||x===W-1||y===0||y===Hs-1||!land0[ab]||!mode[ab]||(wetOuter&&wetOuter[ab]))open=true;
      for(const q of [p-1,p+1,p-W,p+W]){if(q<0||q>=W*Hs||seen[q]||blocked[q])continue;if(q===p-1&&x===0||q===p+1&&x===W-1)continue;seen[q]=1;st.push(q)}}
     if(open||hole.length<HOLE_MIN)continue;
     const hm=new Uint8Array(W*Hs);for(const p of hole)hm[p]=1;const near=dil(hm,GAP+2);
     const around=new Set();for(let i=0;i<W*Hs;i++){if(!near[i])continue;const l=lab[y0*W+i];if(l>=0&&candidate[l]&&!prot.has(l)&&!dead[l])around.add(l)}
     let best=-1,bestD=-1;for(const l of around){const cx=sx[l]/cnt[l],cy=sy[l]/cnt[l];let d=1e9;for(const [px,py] of protXY)d=Math.min(d,Math.hypot(px-cx,py-cy));if(d>bestD){bestD=d;best=l}}
     if(best>=0){kill([best]);rings++;opened=true}}
    if(!opened)break}
  }
  // stubs: a dead end without a town is trimmed, N cells deep, so every strip ends at a settlement or an oasis
  const N=+(ARG.stub??2);let pruned=0;
  for(let it=0;it<N;it++){const out=[];for(let l=0;l<nC;l++){if(!candidate[l]||dead[l]||!cnt[l]||prot.has(l))continue;const d=degree(l);if(d===1||(d===0&&!coastal[l]))out.push(l)}
   if(!out.length)break;kill(out);pruned+=out.length}
  // orphans: a few cells cut off from everything, with no town, are not a country
  let orphans=0;const M=4;const seenC=new Uint8Array(nC);
  for(let l0=0;l0<nC;l0++){if(!candidate[l0]||dead[l0]||!cnt[l0]||seenC[l0])continue;const comp=[l0];seenC[l0]=1;let big=false,keep=false;
   for(let k=0;k<comp.length;k++){const l=comp[k];if(prot.has(l))keep=true;if(nbr[l])for(const m of nbr[l]){if(dead[m]||seenC[m])continue;if(!candidate[m]){big=true;continue}seenC[m]=1;comp.push(m)}}
   const island=comp.every(l=>coastal[l])&&comp.some(l=>sx[l]/cnt[l]<(-12+18)/S*K);
   if(!big&&!keep&&!island&&comp.length<M){kill(comp);orphans+=comp.length}}
  console.log('desert belt tidy: rings opened',rings,'| stub cells trimmed',pruned,'| orphan cells removed',orphans)}
 // southern discs: a lone seed's circle of kept land, or a knot of them, with no place of note in it, is not a country
 {
  const seen=new Uint8Array(W*H);let dropped=0,blobs=0;
  for(let i0=0;i0<W*H;i0++){if(lab[i0]<0||seen[i0])continue;const st=[i0],comp=[];seen[i0]=1;let per=0,shore=0,sx=0,sy=0;
   while(st.length){const p=st.pop();comp.push(p);const x=p%W,y=(p/W)|0;sx+=x;sy+=y;
    for(const [q,ok] of [[p-1,x>0],[p+1,x<W-1],[p-W,y>0],[p+W,y<H-1]]){if(!ok||lab[q]<0){per++;if(!ok||!land0[q])shore++}else if(!seen[q]){seen[q]=1;st.push(q)}}}
   const n=comp.length,cy=sy/n,cx=sx/n;if(n>12000||rowLat(cy)>=+(ARG.dry??35)||shore>0.5*per)continue;   // an island is not a disc
   const circ=4*Math.PI*n/(per*per);if(circ<+(ARG.round??.5))continue;
   if(keepPts.some(([kx,ky])=>Math.hypot(kx-cx,ky-cy)<22+Math.sqrt(n/Math.PI)))continue;
   blobs++;for(const p of comp){lab[p]=-1;dropped++}}
  console.log('round southern blobs removed:',blobs,'px',dropped)}
 // compact labels
 const remap=new Map();const seedOf=[];let n=0;for(let i=0;i<W*H;i++){const l=lab[i];if(l<0)continue;if(!remap.has(l)){remap.set(l,n++);seedOf.push(l)}lab[i]=remap.get(l)}
 const cnt=new Int32Array(n);for(let i=0;i<W*H;i++)if(lab[i]>=0)cnt[lab[i]]++;
 const km=[...cnt].map(c=>c*PXKM*PXKM).sort((a,b)=>a-b);const q=p=>km[Math.floor(km.length*p)];
 console.log('cells',n,'km2 (nominal) min',km[0].toFixed(0),'p10',q(.1).toFixed(0),'median',q(.5).toFixed(0),'p90',q(.9).toFixed(0),'max',km.at(-1).toFixed(0));
 // ---- per-cell facts: true area, centroid, elevation, slope, coast, and one sample point every 4 px for the builder
 // "sea" is empty in the game's land mask and within 3 px of empty ground in the country outlines, so cuts made for lakes, massifs and desert, and the edge of the mask inland, do not read as coast
 const ctryIn=new Float32Array(W*H);for(let i=0;i<W*H;i++)ctryIn[i]=ctryBuf[i]>127?1:0;
 const seaNear=boxMean(Float32Array.from(ctryIn,v=>1-v),3);const sea=new Uint8Array(W*H);for(let i=0;i<W*H;i++)sea[i]=(!land0[i]&&!lakeMask[i]&&seaNear[i]>0.0005)?1:0;
 const st=Array.from({length:n},()=>({px:0,area:0,lo:0,la:0,eSum:0,eMax:-1e9,sSum:0,riv:0,sand:0,wet:0,coastKm:0,samples:[]}));
 for(let y=0;y<H;y++){const a=rowKm2(y),dx=rowDxKm(y),la=rowLat(y);for(let x=0;x<W;x++){const i=y*W+x,l=lab[i];if(l<0)continue;const c=st[l];
  c.px++;c.area+=a;const [lo]=px2lonlat(x+.5,y+.5);c.lo+=lo*a;c.la+=la*a;const e=elev[i];c.eSum+=e*a;if(e>c.eMax)c.eMax=e;
  if(x>0&&y>0&&x<W-1&&y<H-1){c.sSum+=Math.hypot((elev[i+1]-elev[i-1])/(2*dx),(elev[i+W]-elev[i-W])/(2*PXKM))*a}
  if(river[i])c.riv++;if(sandBuf[i]>127)c.sand++;if(wetOuter&&wetOuter[i])c.wet++;
  if(x%4===2&&y%4===2)c.samples.push(+lo.toFixed(4),+la.toFixed(4));
  if(x>0&&sea[i-1])c.coastKm+=PXKM;if(x<W-1&&sea[i+1])c.coastKm+=PXKM;if(y>0&&sea[i-W])c.coastKm+=dx;if(y<H-1&&sea[i+W])c.coastKm+=dx}}
 for(let l=0;l<n;l++){const c=st[l];if(!c.samples.length){const [lo,la]=[c.lo/c.area,c.la/c.area];c.samples.push(+lo.toFixed(4),+la.toFixed(4))}}
 lap('cell facts')
 // Land of the mask that no province covers (massifs, sand, far desert) is left out of the map. It is labelled as one more cell of the arc
 // network, so a province's border with it is walked and smoothed like a border between two provinces; nothing is written for it.
 const IMP=n;let impPx=0;for(let i=0;i<W*H;i++)if(lab[i]<0&&land0[i]&&!lakeMask[i]){lab[i]=IMP;impPx++}
 console.log('land left out of the map, px in the window',impPx);
 // ---- trace: global arc network. Every border is walked once between junctions and shared by both cells.
 const VW=W+1;
 const labAt=(x,y)=>(x<0||y<0||x>=W||y>=H)?-1:lab[y*W+x];
 const Vk=(x,y)=>y*VW+x;
 const vx=v=>v%VW,vy=v=>(v/VW)|0;
 function incident(x,y){const r=[];
  if(y>0&&labAt(x-1,y-1)!==labAt(x,y-1))r.push([2*((y-1)*VW+x)+1,x,y-1]);
  if(y<H&&labAt(x-1,y)!==labAt(x,y))r.push([2*(y*VW+x)+1,x,y+1]);
  if(x>0&&labAt(x-1,y-1)!==labAt(x-1,y))r.push([2*(y*VW+x-1),x-1,y]);
  if(x<W&&labAt(x,y-1)!==labAt(x,y))r.push([2*(y*VW+x),x+1,y]);
  return r}
 function edgeSides(fx,fy,tx_,ty_){ // [left,right] of the direction of travel
  if(ty_===fy){ if(tx_>fx){return[labAt(fx,fy-1),labAt(fx,fy)]} return[labAt(tx_,fy),labAt(tx_,fy-1)] }
  if(ty_>fy){return[labAt(fx,fy),labAt(fx-1,fy)]} return[labAt(fx-1,ty_),labAt(fx,ty_)] }
 const visited=new Uint8Array(2*VW*(H+1));
 const arcs=[];
 function walk(x0,y0,e0){const verts=[Vk(x0,y0)];let e=e0;const sides=edgeSides(x0,y0,e0[1],e0[2]);
  for(;;){visited[e[0]]=1;const nx=e[1],ny=e[2];verts.push(Vk(nx,ny));const inc=incident(nx,ny);if(inc.length!==2)break;
   const nxt=inc[0][0]===e[0]?inc[1]:inc[0];if(visited[nxt[0]])break;e=nxt}
  arcs.push({verts,left:sides[0],right:sides[1]})}
 // pass 1: from junction vertices; pass 2: leftover closed loops
 for(let y=0;y<=H;y++)for(let x=0;x<=W;x++){
  const a=labAt(x-1,y-1),b=labAt(x,y-1),c=labAt(x-1,y),d=labAt(x,y);if(a===b&&b===c&&c===d)continue;
  const inc=incident(x,y);if(inc.length===2)continue;
  for(const e of inc){if(!visited[e[0]])walk(x,y,e)}}
 for(let y=0;y<=H;y++)for(let x=0;x<=W;x++){
  const a=labAt(x-1,y-1),b=labAt(x,y-1),c=labAt(x-1,y),d=labAt(x,y);if(a===b&&b===c&&c===d)continue;
  for(const e of incident(x,y)){if(!visited[e[0]])walk(x,y,e)}}
 lap(`traced ${arcs.length} shared arcs`);
  function dp(pts,eps){if(pts.length<3)return pts;const keep=new Uint8Array(pts.length);keep[0]=keep[pts.length-1]=1;const st=[[0,pts.length-1]];
  while(st.length){const [a,b]=st.pop();let dm=0,im=-1;const [ax,ay]=pts[a],[bx,by]=pts[b];const dx=bx-ax,dy=by-ay,L=Math.hypot(dx,dy)||1;
   for(let i=a+1;i<b;i++){const d=Math.abs((pts[i][0]-ax)*dy-(pts[i][1]-ay)*dx)/L;if(d>dm){dm=d;im=i}}
   if(dm>eps){keep[im]=1;st.push([a,im],[im,b])}}return pts.filter((_,i)=>keep[i])}
 function chaikin(pts,it){for(let k=0;k<it;k++){if(pts.length<3)break;const o=[pts[0]];for(let i=0;i<pts.length-1;i++){const [ax,ay]=pts[i],[bx,by]=pts[i+1];
   o.push([.75*ax+.25*bx,.75*ay+.25*by],[.25*ax+.75*bx,.25*ay+.75*by]);}o.push(pts[pts.length-1]);pts=o}return pts}

 // smooth every arc exactly once
 for(const A of arcs){const coast=A.left<0||A.right<0;const seq=A.verts.map(v=>[vx(v),vy(v)]);
  const eps=coast?.6:+(ARG.eps??1.0),it=coast?1:+(ARG.chaikin??2);const smooth=q=>chaikin(dp(q,eps),it);
  // an arc that closes on itself (an island, a hole) has no junction to anchor it: split it at its farthest vertex, or Douglas-Peucker collapses it to a point
  if(A.verts[0]===A.verts[A.verts.length-1]&&seq.length>4){let m=1,dm=-1;for(let k=1;k<seq.length-1;k++){const d=Math.hypot(seq[k][0]-seq[0][0],seq[k][1]-seq[0][1]);if(d>dm){dm=d;m=k}}
   A.pts=[...smooth(seq.slice(0,m+1)),...smooth(seq.slice(m)).slice(1)]}
  else A.pts=smooth(seq)}
 {let cs=0,is=0;for(const A of arcs){const n=A.pts.length-1;if(A.left<0||A.right<0)cs+=n;else is+=n}console.log('smoothed segments: coast',cs,'| interior (each shared by two cells)',is)}
 // adjacency: every interior arc is a border between two cells; its length is the smoothed polyline, its height the mean of the ground on both sides
 const adjMap=new Map();
 for(const A of arcs){if(A.left<0||A.right<0||A.left===A.right||A.left===IMP||A.right===IMP)continue;
  let len=0;for(let k=1;k<A.pts.length;k++){const [ax,ay]=A.pts[k-1],[bx,by]=A.pts[k];len+=Math.hypot((bx-ax)*rowDxKm(Math.min(H-1,Math.max(0,Math.floor((ay+by)/2)))),(by-ay)*PXKM)}
  let es=0,en=0;for(let k=1;k<A.verts.length;k++){const fx=vx(A.verts[k-1]),fy=vy(A.verts[k-1]),tx2=vx(A.verts[k]),ty2=vy(A.verts[k]);let p1,p2;
   if(ty2===fy){const xx=Math.min(fx,tx2);p1=[xx,fy-1];p2=[xx,fy]}else{const yy=Math.min(fy,ty2);p1=[fx-1,yy];p2=[fx,yy]}
   for(const [px_,py_] of [p1,p2]){if(px_>=0&&py_>=0&&px_<W&&py_<H&&lab[py_*W+px_]>=0){es+=elev[py_*W+px_];en++}}}
  const a_=Math.min(A.left,A.right),b_=Math.max(A.left,A.right),key=a_+','+b_;const r=adjMap.get(key)||{km:0,es:0,en:0};r.km+=len;r.es+=es;r.en+=en;adjMap.set(key,r)}
 const adjOf=Array.from({length:n},()=>[]);
 for(const [k,r] of adjMap){const [a_,b_]=k.split(',').map(Number);const rec=(o)=>({n:o,km:+r.km.toFixed(2),elev:r.en?Math.round(r.es/r.en):0});adjOf[a_].push(rec(b_));adjOf[b_].push(rec(a_))}
 lap(`adjacency pairs ${adjMap.size}`);
 // assemble every cell's rings from its arcs (interior on the right)
 const byStart=Array.from({length:n+1},()=>new Map());
 const put=(c,oa)=>{const m=byStart[c];const k=oa.verts[0];if(!m.has(k))m.set(k,[]);m.get(k).push(oa)};
 for(const A of arcs){
  if(A.right>=0)put(A.right,{A,rev:false,verts:A.verts,pts:A.pts,used:false});
  if(A.left>=0){const rv=[...A.verts].reverse();put(A.left,{A,rev:true,verts:rv,pts:[...A.pts].reverse(),used:false})}}
 const cellRings=Array.from({length:n+1},()=>[]);let openRings=0;
 for(let c=0;c<=n;c++){for(const [,list] of byStart[c]){for(const first of list){if(first.used)continue;
   first.used=true;const ring=[...first.pts];let cur=first;let guard=0;
   for(;;){const endV=cur.verts[cur.verts.length-1];if(endV===first.verts[0])break;
    const cand=byStart[c].get(endV);const nx=cand&&cand.find(z=>!z.used);if(!nx){openRings++;break}
    nx.used=true;ring.push(...nx.pts.slice(1));cur=nx;if(++guard>100000)break}
   cellRings[c].push(ring)}}}
 console.log('open rings (should be 0):',openRings);
 {const seg=new Map();const kk=p=>p[0].toFixed(3)+','+p[1].toFixed(3);let total=0;
  for(const rs of cellRings)for(const r of rs)for(let k=1;k<r.length;k++){const a_=kk(r[k-1]),b_=kk(r[k]);const key=a_<b_?a_+'|'+b_:b_+'|'+a_;seg.set(key,(seg.get(key)||0)+1);total++}
  let matched=0,single=0,over=0;for(const v of seg.values()){if(v===2)matched++;else if(v===1)single++;else over++}
  let coastSeg=0;for(const A of arcs)if(A.left<0||A.right<0)coastSeg+=A.pts.length-1;
  console.log('topology: matched segments',matched,'| single (coast expected',coastSeg+')',single,'| over-used',over,'| ring segments',total)}

 // ---- output geojson + preview
 const feats=[];const idxOf0=l=>cellRings[l].some(r=>r.length>3);for(let l=0;l<n;l++){const rs=cellRings[l].map(r=>{const c=r.map(([x,y])=>px2lonlat(x,y));return c}).filter(r=>r.length>3);if(rs.length)feats.push({l,rs})}
 // outer rings = larger area; holes ambiguous -> draw evenodd
 {const lost=[];for(let l=0;l<n;l++)if(!idxOf0(l))lost.push(l);console.log('cells without a ring:',lost.length,lost.slice(0,8).map(l=>l+':'+st[l].px+'px/'+cellRings[l].length+'r/'+cellRings[l].map(r=>r.length)))}
 const idxOf=new Map(feats.map((f,i)=>[f.l,i]));
 const provinces=feats.map(f=>{const c=st[f.l],sd=seeds[seedOf[f.l]];const [slo,sla]=sd[4]!==undefined?[sd[4],sd[5]]:px2lonlat(sd[0],sd[1]);
  const pop=v=>+v.toFixed(2);
  return{seed:{lon:+slo.toFixed(5),lat:+sla.toFixed(5),name:sd[2]||null,pleiades:sd[6]||null,src:sd[3]},areaKm2:Math.round(c.area),centroid:[+(c.lo/c.area).toFixed(5),+(c.la/c.area).toFixed(5)],
   elevMean:Math.round(c.eSum/c.area),elevMax:Math.round(c.eMax),slopeMKm:pop(c.sSum/c.area),coast:c.coastKm>=2,coastKm:Math.round(c.coastKm/1.2),riverFrac:pop(c.riv/c.px),sandFrac:pop(c.sand/c.px),wetFrac:pop(c.wet/c.px),
   adj:adjOf[f.l].filter(o=>idxOf.has(o.n)).map(o=>({n:idxOf.get(o.n),km:o.km,elev:o.elev})).sort((a_,b_)=>a_.n-b_.n)}});
 // a 4 px sea bitmap so the builder can tell water gaps from desert gaps
 const W4=Math.ceil(W/4),H4=Math.ceil(H/4);const seaBits=Buffer.alloc(Math.ceil(W4*H4/8));
 for(let y=0;y<H4;y++)for(let x=0;x<W4;x++){const i=Math.min(H-1,y*4+2)*W+Math.min(W-1,x*4+2);if(sea[i]){const b=y*W4+x;seaBits[b>>3]|=1<<(b&7)}}
 fs.writeFileSync(OUT+'.json',JSON.stringify({bbox:B,cells:n,px:[W,H],rings:feats.map(f=>f.rs),provinces,sea4:{w:W4,h:H4,step:4,bits:seaBits.toString('base64')}}));
 fs.writeFileSync(OUT+'.samples.json',JSON.stringify(feats.map(f=>st[f.l].samples)));
 const SC=1.0;let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#1a75a8"/>`;
 for(const f of feats){const h=(f.l*2654435761>>>0);const col=`hsl(${h%360},${35+(h>>9)%25}%,${58+(h>>17)%18}%)`;
  svg+=`<path d="${f.rs.map(r=>'M'+r.map(([lo,la])=>{const [x,y]=lonlat2px(lo,la);return x.toFixed(1)+','+y.toFixed(1)}).join('L')+'Z').join('')}" fill="${col}" stroke="#222" stroke-width="0.7" fill-rule="evenodd" stroke-linejoin="round"/>`}
 svg+='</svg>';fs.writeFileSync(OUT+'.svg',svg);fs.writeFileSync(OUT+'_lines.svg',svg.replace(/fill="hsl[^"]*"/g,'fill="none"').replace(/stroke="#222" stroke-width="0.7"/g,'stroke="#e0103a" stroke-width="1.1"').replace(/<rect[^>]*>/,''));await sharp(Buffer.from(svg)).png().toFile(OUT+'.png');lap('wrote '+OUT+'.png');
})();
