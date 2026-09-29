const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const DATA = process.env.MAP_GEN_DATA || path.join(ROOT, '.map-gen-data');
process.chdir(DATA);
const dreq = require('module').createRequire(path.join(DATA, 'package.json'));
const {parse}=dreq('csv-parse/sync');const fs=require('fs');
const rows=parse(fs.readFileSync('data/pleiades-places-latest.csv'),{columns:true,relax_quotes:true,relax_column_count:true});
console.log('rows',rows.length);
const W={x0:-18,x1:46,y0:26,y1:59};
const inWin=r=>{const lon=+r.reprLong,lat=+r.reprLat;return r.reprLong!==''&&r.reprLat!==''&&isFinite(lon)&&isFinite(lat)&&lon>=W.x0&&lon<=W.x1&&lat>=W.y0&&lat<=W.y1};
const win=rows.filter(inWin);console.log('in window',win.length);
const alive=(r,y)=>{const a=r.minDate===''?null:+r.minDate,b=r.maxDate===''?null:+r.maxDate;return a!==null&&b!==null&&a<=y&&b>=y};
const ft=r=>r.featureTypes.split(',').map(s=>s.trim());
const count={};for(const r of win)for(const f of ft(r))count[f]=(count[f]||0)+1;
console.log('top feature types',Object.entries(count).sort((a,b)=>b[1]-a[1]).slice(0,20));
const y=-270;
const live=win.filter(r=>alive(r,y));console.log('alive in 270BCE (dated)',live.length);
const setOnly=live.filter(r=>ft(r).some(f=>f==='settlement'||f==='urban'));console.log('settlement|urban only',setOnly.length);
const grid=new Map();const kept=[];const CELL=0.08;
for(const r of setOnly){const lon=+r.reprLong,lat=+r.reprLat;let ok=true;
 for(let dx=-1;dx<=1&&ok;dx++)for(let dy=-1;dy<=1&&ok;dy++){const g=grid.get((Math.floor(lon/CELL)+dx)+','+(Math.floor(lat/CELL)+dy));if(g)for(const p of g)if(Math.hypot(p[0]-lon,(p[1]-lat)*1.3)<CELL*1.3){ok=false;break}}
 if(ok){kept.push([lon,lat,r.title,r.id]);const k=Math.floor(lon/CELL)+','+Math.floor(lat/CELL);if(!grid.has(k))grid.set(k,[]);grid.get(k).push([lon,lat])}}
console.log('after ~7km dedupe',kept.length);
const rowsG={};for(const [lon,lat] of kept){const gx=Math.floor((lon-W.x0)/4),gy=Math.floor((W.y1-lat)/4);if(!rowsG[gy])rowsG[gy]={};rowsG[gy][gx]=(rowsG[gy][gx]||0)+1}
console.log('seeds per 4x4 degree cell (rows = lat from 59 down, cols = lon from -18 east)');
for(let gy=0;gy<9;gy++){let s=String(W.y1-gy*4).padStart(3)+' ';for(let gx=0;gx<12;gx++)s+=String((rowsG[gy]&&rowsG[gy][gx])||0).padStart(5);console.log(s)}
const box={Italy:[6,19,36.5,47],Britain:[-6,2,50,59],Iberia:[-10,4,36,44],Gaul:[-5,8,42,51],Greece:[19,27,35,42],NAfrica:[-10,20,29,37.5],Germania:[5,25,47,55]};
for(const [n,[a,b,c,d]] of Object.entries(box))console.log(n,kept.filter(k=>k[0]>=a&&k[0]<=b&&k[1]>=c&&k[1]<=d).length);
fs.writeFileSync('seeds270.json',JSON.stringify(kept));
