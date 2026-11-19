import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,copyFile} from 'node:fs/promises';
import {inflateSync} from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {checkCoverage,inspectRecognition,learningFreshness} from '../lib/ppt-quality.mjs';
import {pageCacheService} from '../lib/page-cache.mjs';
import {browserExecutable} from '../lib/browser-render.mjs';
import {zipEntries} from '../lib/zip.mjs';
import {zipFixture} from './helpers/zip-fixture.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),sleep=ms=>new Promise(r=>setTimeout(r,ms));

test('native coverage flags suspect missing content without inventing text, preserves uncertainty and records actual image key',()=>{
 const native='Every member must upload a copy.\nOffice Hours: Wed 10-11am\nG110, 21 Woodland Road';
 assert.equal(checkCoverage(native,native.replace(/\s+/g,' ')).missingCount,0);
 assert.equal(checkCoverage(native,'Every member must upload a copy.').missingCount,2);
 const page={originalText:[{text:'Every member must upload a copy.'}],uncertainties:[],inspection:{status:'complete'}};
 inspectRecognition(page,{nativeText:native,integrity:{geometry:{complete:true},textIssues:[],failedImages:[]}},'current');assert.equal(page.inspection.status,'partial');assert.equal(page.originalText.length,1,'missing native candidates are never silently fabricated as visible text');assert.equal(page.quality.renderKey,'current');
 assert.equal(learningFreshness({parser:{renderKey:'current'}},'current').stale,false);assert.equal(learningFreshness({parser:{renderKey:'old'}},'current').stale,true);assert.equal(learningFreshness({},'current').stale,true);
});

test('HTML/CSS changes invalidate shared previews within the same process and clipped pages never become cached success',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-quality-')),f={id:'ppt',name:'Slides.pdf',stored:'Slides.pdf',role:'ppt'};let clipped=false,draws=0;
 try{
  for(const name of ['public/parse-render.js','public/parse-render.html','public/pptx-frame.js','public/pptx-frame.html','public/render-audit.js','public/vendor/pptx-renderer/renderer.mjs','public/vendor/pptx-renderer/table-layout.mjs','lib/browser-render.mjs']){await mkdir(path.dirname(path.join(dir,name)),{recursive:true});await copyFile(path.join(root,name),path.join(dir,name));}
  await mkdir(path.join(dir,'Source'));await writeFile(path.join(dir,'Source',f.stored),'PDF');
  const cache=pageCacheService({root:dir,previews:{status:async()=>({direct:true,status:'ready'})},render:async()=>({open:async()=>({pages:1}),page:async()=>{draws++;return {image:'data:image/png;base64,YQ==',nativeText:'bottom content',integrity:{geometry:{complete:!clipped},renderedText:'bottom content',textIssues:[],failedImages:[]},warnings:[]};},close:async()=>{}})});
  const a=await cache.page(dir,f,{}, {origin:'http://local',index:0});await cache.page(dir,f,{}, {origin:'http://local',index:0});assert.equal(draws,1);
  const html=path.join(dir,'public/pptx-frame.html');await writeFile(html,(await readFile(html,'utf8')).replace('height:100%','height:99%'));
  const b=await cache.page(dir,f,{}, {origin:'http://local',index:0});assert.notEqual(a.renderKey,b.renderKey);assert.equal(draws,2);
  const seed=await readFile(path.join(b.cache,'page-1.json'),'utf8');clipped=true;await writeFile(html,(await readFile(html,'utf8'))+'<!-- new code -->');
  await assert.rejects(()=>cache.page(dir,f,{}, {origin:'http://local',index:0}),/不完整/);assert.equal(await readFile(path.join(b.cache,'page-1.json'),'utf8'),seed,'a failed capture must not overwrite valid cache metadata');
 }finally{await rm(dir,{recursive:true,force:true});}
});

// Read actual screenshot pixels, not just the IHDR dimensions. Chromium emits
// 8-bit RGB/RGBA PNGs; implement the standard row filters without dependencies.
function pngReader(bytes){
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20),type=bytes[25],bpp=type===6?4:3;assert.equal(bytes[24],8);assert([2,6].includes(type));const chunks=[];
 for(let at=8;at<bytes.length;){const n=bytes.readUInt32BE(at),name=bytes.toString('ascii',at+4,at+8);if(name==='IDAT')chunks.push(bytes.subarray(at+8,at+8+n));at+=n+12;}
 const packed=inflateSync(Buffer.concat(chunks)),stride=width*bpp,pixels=Buffer.alloc(height*stride);let at=0;
 const paeth=(a,b,c)=>{const p=a+b-c,aa=Math.abs(p-a),bb=Math.abs(p-b),cc=Math.abs(p-c);return aa<=bb&&aa<=cc?a:bb<=cc?b:c;};
 for(let y=0;y<height;y++){const filter=packed[at++];for(let x=0;x<stride;x++){const p=y*stride+x,a=x>=bpp?pixels[p-bpp]:0,b=y?pixels[p-stride]:0,c=y&&x>=bpp?pixels[p-stride-bpp]:0;const predictor=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c);pixels[p]=(packed[at++]+predictor)&255;}}
 return {width,height,pixel(x,y){const at=(y*width+x)*bpp;return [...pixels.subarray(at,at+3)];}};
}
function edgeDeck(original,cx,cy){
 const entries=zipEntries(original,()=>true).map(e=>[e.name,e.bytes]);
 const shape=(id,x,y,w,h,color)=>`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="edge-${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
 for(const entry of entries){if(entry[0]==='ppt/presentation.xml')entry[1]=Buffer.from(entry[1].toString().replace(/<p:sldSz\b[^>]*\/>/,`<p:sldSz cx="${cx}" cy="${cy}"/>`));
  if(entry[0]==='ppt/slides/slide1.xml')entry[1]=Buffer.from(entry[1].toString().replace('</p:spTree>',shape(900,0,0,cx,120000,'FF0000')+shape(901,0,cy-120000,cx,120000,'0000FF')+shape(902,0,0,120000,cy,'00FF00')+shape(903,cx-120000,0,120000,cy,'FF00FF')+'</p:spTree>'));}
 return zipFixture(entries);
}

test('real exported screenshots preserve all four edges at native layout and high DPI for wide, standard and portrait decks',async t=>{
 try{await browserExecutable();}catch{return t.skip('Requires Edge / Chrome');}
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-edge-')),child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,CLASSROOM_DATA:dir,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 try{
  for(let i=0;i<100&&!log.includes('http://');i++)await sleep(40);const base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(base,log);
  const project=await (await fetch(base+'/api/projects',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Edges'})})).json(),route=base+'/api/projects/'+project.id,original=await readFile(new URL('fixtures/text-layout.pptx',import.meta.url));
  for(const [name,cx,cy] of [['wide',12192000,6858000],['standard',9144000,6858000],['portrait',6858000,9144000]]){
   const uploaded=await fetch(route+'/upload',{method:'POST',headers:{'x-file-name':name+'.pptx','x-file-role':'ppt'},body:edgeDeck(original,cx,cy)});assert.equal(uploaded.status,201);const p=await uploaded.json(),f=p.files.find(f=>f.name===name+'.pptx');
   const image=await fetch(route+'/page-image?source='+f.id+'&page=1');assert(image.ok,await image.clone().text());const bytes=Buffer.from(await image.arrayBuffer()),png=pngReader(bytes);
   assert.equal(png.width,Math.round(cx/9525)*2);assert.equal(png.height,Math.round(cy/9525)*2);assert.deepEqual(png.pixel(Math.floor(png.width/2),3),[255,0,0],name+' top');assert.deepEqual(png.pixel(Math.floor(png.width/2),png.height-4),[0,0,255],name+' bottom');assert.deepEqual(png.pixel(3,Math.floor(png.height/2)),[0,255,0],name+' left');assert.deepEqual(png.pixel(png.width-4,Math.floor(png.height/2)),[255,0,255],name+' right');
   const seed=JSON.parse(await readFile(path.join(dir,'classes',project.id,'.Cache','Pages',f.id,'page-1.json')));assert.equal(seed.integrity.geometry.complete,true);assert.equal(seed.capture.pixelRatio,2);assert.equal(seed.integrity.geometry.ancestors.find(a=>a.tag==='BODY').height,seed.capture.cssHeight);
   if(process.env.CLASSROOM_UI_EVIDENCE){await mkdir(process.env.CLASSROOM_UI_EVIDENCE,{recursive:true});await writeFile(path.join(process.env.CLASSROOM_UI_EVIDENCE,'edges-'+name+'.png'),bytes);}
  }
 }finally{child.kill();await new Promise(r=>child.once('exit',r));await rm(dir,{recursive:true,force:true});}
});
