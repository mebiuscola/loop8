import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {readTextLayer,textLayerSufficient,textLayerDocument} from '../lib/pdf-text.mjs';
import {parseReadingPdf,parseSourceOf} from '../lib/reading-parse.mjs';

const {PDFDocument,StandardFonts,rgb}=createRequire(import.meta.url)('../vendor/pdf-lib.cjs');
const body=n=>[
 `Page ${n} opens with comparative reading. Distance is an analytical scale, not an excuse to ignore`,
 'form; the critic still reads the sentence closely and compares it with others.',
 '',
 'A second paragraph returns to the argument about world literature and its compar-',
 'ison across languages, keeping the original wording intact for citation.',
];
/** pages: 'text' (paragraphs and a printed page number), 'image' (a drawn shape, no text). */
async function makePdf(pages){
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);
 pages.forEach((kind,i)=>{
  const page=doc.addPage([595,842]);
  if(kind==='image'){page.drawRectangle({x:60,y:200,width:470,height:500,color:rgb(0.5,0.6,0.55)});return;}
  let y=760;
  for(const line of body(i+1)){if(!line){y-=24;continue;}page.drawText(line,{x:60,y,size:11,font});y-=15;}
  page.drawText(String(i+17),{x:290,y:40,size:10,font});
 });
 return Buffer.from(await doc.save());
}

test('a born-digital PDF is read from its text layer: paragraphs, joined line breaks and printed page numbers',async()=>{
 const pages=await readTextLayer(await makePdf(['text','text','text']));
 assert.equal(pages.length,3);
 const text=pages[0].blocks.filter(b=>b.type==='text').map(b=>b.text);
 assert.equal(text.length,2,JSON.stringify(text));
 assert.match(text[0],/^Page 1 opens .* not an excuse to ignore form; the critic/);
 assert.match(text[1],/its comparison across languages/,'a word broken across lines is joined');
 assert.equal(pages[1].pageNumber,'18');
 assert(textLayerSufficient(pages));
 const doc=textLayerDocument(pages,{id:'r1',name:'Reading.pdf',role:'reading'});
 assert.equal(doc.provenance,'pdf-text-layer');
 assert.equal(parseSourceOf(doc),'text-layer');
 assert.deepEqual(doc.blocks.filter(b=>b.type==='page_number').map(b=>[b.pageIndex,b.text]),[[0,'17'],[1,'18'],[2,'19']]);
 assert(doc.blocks.filter(b=>b.type==='text').every(b=>!/^\d+$/.test(b.text)),'page numbers are not body text');
 assert.equal(doc.blocks[0].id,'r1:b1');
});

test('scans go to MinerU; a few picture-only pages in a text PDF do not',async()=>{
 assert.equal(textLayerSufficient(await readTextLayer(await makePdf(['image','image','image']))),false,'no text layer at all');
 const mixedScan=await readTextLayer(await makePdf(['text','image','image','image','text']));
 assert.equal(textLayerSufficient(mixedScan),false,'many textless pages mean scanned pages');
 const figure=await readTextLayer(await makePdf([...Array(9).fill('text'),'image']));
 assert(textLayerSufficient(figure),'one full-page figure in ten pages is fine');
 assert.deepEqual(textLayerDocument(figure,{id:'f',name:'F.pdf',role:'reading'}).textLayer.withoutText,[10]);
 assert.equal(textLayerSufficient([{pageIndex:0,blocks:[],letters:300,garbled:true}]),false,'garbled text is not trusted');
});

test('parsing tries the text layer first, falls back to MinerU for scans, and MinerU can be forced',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-pdf-text-'));
 try{
  const text=path.join(dir,'Text.pdf'),scan=path.join(dir,'Scan.pdf'),broken=path.join(dir,'Broken.pdf');
  await writeFile(text,await makePdf(['text','text']));await writeFile(scan,await makePdf(['image','image']));await writeFile(broken,'not a pdf');
  const noToken={mineruToken:''},steps=[];
  const doc=await parseReadingPdf(noToken,text,{id:'t',name:'Text.pdf',role:'reading'},async s=>{steps.push(s);});
  assert.equal(parseSourceOf(doc),'text-layer');assert.deepEqual(steps,['读取 PDF 自带文字'],'no MinerU step for a text PDF');
  await assert.rejects(parseReadingPdf(noToken,scan,{id:'s',name:'Scan.pdf',role:'reading'}),/MinerU.*Token/,'a scan reaches MinerU');
  await assert.rejects(parseReadingPdf(noToken,broken,{id:'b',name:'Broken.pdf',role:'reading'}),/MinerU.*Token/,'an unreadable file reaches MinerU');
  await assert.rejects(parseReadingPdf(noToken,text,{id:'t',name:'Text.pdf',role:'reading'},undefined,{force:'mineru'}),/MinerU.*Token/,'MinerU can be forced');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('the server parses a text PDF without MinerU and records where the text came from',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-pdf-text-server-'));
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:dir,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 try{
  for(let i=0;i<100&&!log.includes('http://');i++)await new Promise(r=>setTimeout(r,30));
  const base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(base,log);
  const api=async(url,value)=>{const r=await fetch(base+url,value===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});const data=await r.json();assert(r.ok,JSON.stringify(data));return data;};
  const p=await api('/api/projects',{name:'Text layer'}),route='/api/projects/'+p.id;
  const up=await fetch(base+route+'/upload',{method:'POST',headers:{'x-file-role':'reading','x-file-name':'Reading.pdf'},body:await makePdf(['text','text'])});
  assert.equal(up.status,201);const file=(await up.json()).files[0];
  await api(route+'/process',{mode:'reading',sourceId:file.id});
  let state;for(let i=0;i<200;i++){state=await api(route);if(state.files[0].parseStatus!=='running')break;await new Promise(r=>setTimeout(r,30));}
  const parsed=state.files[0];
  assert.equal(parsed.parseStatus,'ready',parsed.error);assert.equal(parsed.parseSource,'text-layer');assert.equal(parsed.progress,'已读取 PDF 自带文字');
  const blocks=JSON.parse(await readFile(path.join(dir,'classes',p.id,'Parsed',parsed.parsed),'utf8'));
  assert.equal(blocks.provenance,'pdf-text-layer');assert(blocks.blocks.some(b=>b.type==='page_number'&&b.text==='18'));
  // The explicit MinerU re-parse still uses MinerU (here it stops at the missing token) and keeps the text-layer result.
  await api(route+'/process',{mode:'reading',sourceId:file.id,engine:'mineru'});
  for(let i=0;i<200;i++){state=await api(route);if(state.files[0].parseStatus!=='running')break;await new Promise(r=>setTimeout(r,30));}
  assert.match(state.files[0].error,/MinerU.*Token/);assert.equal(state.files[0].parseStatus,'ready','the earlier result stays usable');
 }finally{child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));await rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:50});}
});
