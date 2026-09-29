const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const DATA = process.env.MAP_GEN_DATA || path.join(ROOT, '.map-gen-data');
process.chdir(DATA);
const dreq = require('module').createRequire(path.join(DATA, 'package.json'));
const fs=require('fs');
const ARG=Object.fromEntries(process.argv.slice(2).map(a=>a.split('=')));
const Z=7,N=2**Z;const B={x0:+(ARG.x0??-19),x1:+(ARG.x1??47),y0:+(ARG.y0??25),y1:+(ARG.y1??60)};
const tx=lon=>Math.floor((lon+180)/360*N);
const ty=lat=>{const r=lat*Math.PI/180;return Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*N)};
const X0=tx(B.x0),X1=tx(B.x1),Y0=ty(B.y1),Y1=ty(B.y0);
const jobs=[];for(let x=X0;x<=X1;x++)for(let y=Y0;y<=Y1;y++)jobs.push([x,y]);
console.log('tiles',jobs.length,'x',X0,X1,'y',Y0,Y1);
const dir='data/terrarium/'+Z;let done=0,bytes=0,fail=0;
async function get([x,y]){const f=`${dir}/${x}/${y}.png`;if(fs.existsSync(f)){bytes+=fs.statSync(f).size;done++;return}
 fs.mkdirSync(path.dirname(f),{recursive:true});
 for(let t=0;t<3;t++){try{const r=await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`);if(!r.ok)throw new Error(r.status);
  const b=Buffer.from(await r.arrayBuffer());fs.writeFileSync(f,b);bytes+=b.length;done++;return}catch(e){if(t===2){fail++;console.log('fail',x,y,String(e))}}}}
(async()=>{let i=0;const worker=async()=>{while(i<jobs.length){await get(jobs[i++])}};await Promise.all(Array.from({length:8},worker));
 console.log('done',done,'fail',fail,'MB',(bytes/1e6).toFixed(1))})();
