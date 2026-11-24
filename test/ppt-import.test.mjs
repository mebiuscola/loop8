import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validateReport} from '../lib/ppt-report.mjs';
import {externalPptDocument} from '../lib/ppt-import.mjs';
import {documentText} from '../lib/materials.mjs';
import {pageOriginalText,pageEvidenceText,pptPages} from '../lib/pages.mjs';
import {zipFixture} from './helpers/zip-fixture.mjs';
import {listenSafe} from '../lib/ports.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function report(bytes){return {schema:'classroom.ppt-visual.v1',source:{fileName:'original.pptx',sha256:hash(bytes),format:'pptx',pageCount:2},pages:[{page:1,title:'Comparison',hidden:false,blank:false,originalText:[{text:'ORIGINAL: Comparative literature',method:'native'}],speakerNotes:'NOTES: contextual note',visualObservations:[{id:'diagram1',kind:'diagram',description:'VISUAL: two labelled boxes joined by a right arrow',relations:['A points to B']}],analysis:['ANALYSIS_ONLY: possible process, not proven causality'],uncertainties:[],inspection:{textExtracted:true,fullPageViewed:true,status:'complete'}},{page:2,title:'',hidden:true,blank:false,originalText:[],speakerNotes:'',visualObservations:[],analysis:[],uncertainties:['Could not render this hidden page'],inspection:{textExtracted:false,fullPageViewed:false,status:'unavailable'}}]};}
test('PPT report enforces original identity, all pages and honest inspection, and separates original from interpretation',()=>{
 const r=report(Buffer.from('original'));const doc=externalPptDocument(r,{id:'ppt1',name:'original.pptx',role:'ppt'},r.source.sha256);
 assert.equal(doc.externalPpt.summary.incomplete,1);assert.equal(doc.blocks.filter(b=>b.evidenceKind==='analysis').length,1);assert.match(documentText(doc),/not original slide text/);
 const page={blocks:doc.blocks.filter(b=>b.pageIndex===0),externalInspection:doc.externalPpt.pages[0]};assert.match(pageOriginalText(page),/ORIGINAL/);assert(!pageOriginalText(page).includes('ANALYSIS_ONLY'));assert(!pageOriginalText(page).includes('NOTES:'));assert.match(pageEvidenceText(page),/ANALYSIS_ONLY/);
 assert.throws(()=>validateReport(r,'a'.repeat(64)),/不匹配/);
 for(const mutate of [r=>r.pages.pop(),r=>r.pages[1].page=3,r=>r.pages[1].inspection.status='complete',r=>r.pages[1].visualObservations=[{id:'fake',kind:'image',description:'invented'}]]){const bad=structuredClone(r);mutate(bad);assert.throws(()=>validateReport(bad));}
});
test('PPT JSON import blocks cloud fallback, checks fingerprint/count, preserves originals and feeds visual evidence separately to preparation',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'classroom-ppt-import-'));let calls=0;const slideCalls=[];
 const mock=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;calls++;const b=JSON.parse(raw),system=b.messages[0].content,user=b.messages[1].content;assert.equal(typeof user,'string','external text report must not resend images');const data=system.includes('Deep Dive issue plan')?null:JSON.parse(user);let content;
  if(system.includes('Deep Dive issue plan'))content=JSON.stringify({centralQuestion:'What does comparison explain?',issues:[{question:'What does comparison explain?',searchQueries:['comparison']}]});
  else if(system.includes('Blackboard question extraction'))throw Error('BB answers must not run');
  else if(system.includes('PPT body translation'))content=JSON.stringify({paragraphs:data.paragraphs.map(p=>({id:p.id,chinese:'比较文学'}))});
  else if(system.includes('PPT close reading')){slideCalls.push(data);content='The imported diagram shows a relation. The app did not inspect page pixels; second page remains unavailable.';}
  else if(system.includes('Weekly synthesis'))content='# Weekly preliminary analysis';
  else content='[Original text] Comparative literature. [Visual observation] A points to B. [Analysis] possible process. [Uncertainty] page 2 unavailable.';
  res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}]}));
 });await listenSafe(mock);
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:temp,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 try{
  for(let i=0;i<100&&!log.includes('http://');i++)await sleep(30);const base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(base,log);
  const call=async(url,data)=>{const r=await fetch(base+url,data===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const text=await r.text();let value;try{value=JSON.parse(text);}catch{value=text;}return {status:r.status,value};};
  await call('/api/settings',{baseUrl:`http://127.0.0.1:${mock.address().port}/v1`,apiKey:'fixture-only',model:'fixture',mineruToken:'',visionEnabled:false});
  const project=(await call('/api/projects',{name:'PPT External'})).value,route='/api/projects/'+project.id;
  const upload=async(role,name,bytes)=>{const r=await fetch(base+route+'/upload',{method:'POST',headers:{'x-file-role':role,'x-file-name':name},body:bytes});assert.equal(r.status,201);return r.json();};
  const ppt=zipFixture([['ppt/slides/slide1.xml','slide1'],['ppt/slides/slide2.xml','slide2']]);let state=await upload('ppt','original.pptx',ppt);const source=state.files[0];assert.equal(source.parseStatus,'awaiting-json');
  state=await upload('reading','reading.pdf','ORIGINAL PDF');const reading=state.files[1];
  const wait=async()=>{for(let i=0;i<150;i++){state=(await call(route)).value;if(state.status!=='running')return;await sleep(20);}throw Error('timeout');};
  assert.equal((await call(route+'/process',{mode:'preparation'})).status,202);await wait();assert.equal(state.status,'error');assert.match(state.error,/Token|PPT/);assert.equal(calls,0);assert.equal(state.files[1].parseStatus,'pending','preflight must run before any Reading parsing');
  const importing=async value=>{const r=await fetch(base+route+'/parsed?source='+source.id,{method:'POST',headers:{'x-parse-format':'json'},body:JSON.stringify(value)});return {status:r.status,value:await r.json()};};
  const wrong=report(Buffer.from('other'));assert.equal((await importing(wrong)).status,400);assert.equal((await call(route)).value.files[0].parsed,undefined);
  const badCount=report(ppt);badCount.pages.pop();badCount.source.pageCount=1;assert.equal((await importing(badCount)).status,400);
  const valid=report(ppt),result=await importing(valid);assert.equal(result.status,200,JSON.stringify(result.value));state=result.value;assert.equal(state.files[0].importSummary.viewed,1);assert.equal(state.files[0].importSummary.incomplete,1);
  const raw=await call(route+'/analysis?source='+source.id);assert.deepEqual(raw.value,valid);
  const pages=await pptPages(path.join(temp,'classes',project.id),state.files[0]);assert.equal(pages.length,2);assert.equal(pages[1].externalInspection.hidden,true);
  const manual=await fetch(base+route+'/parsed?source='+reading.id,{method:'POST',body:'[Reading page 1]\nComparison background.'});assert.equal(manual.status,200);
  await call(route+'/process',{mode:'preparation'});await wait();assert.equal(state.status,'done',state.error);assert.equal(slideCalls.length,2);const first=slideCalls.find(p=>p.pageIndex===0),second=slideCalls.find(p=>p.pageIndex===1);assert(first.importedVisualEvidence.includes('ANALYSIS_ONLY'));assert(!first.original.includes('ANALYSIS_ONLY'));assert.equal(second.original,'');assert(second.visualCoverage.includes('unavailable'));
  const structured=await call(route+'/reader?source='+source.id);assert.equal(structured.status,200);assert.equal(structured.value.pages.length,2);assert(structured.value.generated);assert(!structured.value.pages[0].paragraphs.some(p=>(p.english+p.chinese).includes('ANALYSIS_ONLY')));assert.match(structured.value.pages[0].closeReading,/imported diagram/);
  const original=await readFile(path.join(temp,'classes',project.id,'Source',source.stored));assert.deepEqual(original,ppt);const oldRevision=state.materialRevision;
  assert.equal((await importing(wrong)).status,400);assert.equal((await call(route)).value.materialRevision,oldRevision);assert.deepEqual((await call(route+'/analysis?source='+source.id)).value,valid);
 }finally{child.kill();await new Promise(r=>child.once('exit',r));await new Promise(r=>mock.close(r));await rm(temp,{recursive:true,force:true});}
});
