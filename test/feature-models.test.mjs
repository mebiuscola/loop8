import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import http from 'node:http';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {resolveModel,validateModelRouting,modelIdentity} from '../lib/model-routing.mjs';
import {completePptPage} from '../lib/ppt-response.mjs';
import {resetPptTeaching} from '../lib/ppt-cache.mjs';
import {browserExecutable,launchRenderer} from '../lib/browser-render.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function validPdf(pages=1){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',''],kids=[];
 for(let i=0;i<pages;i++){
  const page=objects.length+1,stream=page+1;
  kids.push(page+' 0 R');
  const text='BT /F1 16 Tf 40 700 Td (Reference source page '+(i+1)+') Tj ET';
  objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 '+(3+pages*2)+' 0 R >> >> /Contents '+stream+' 0 R >>','<< /Length '+text.length+' >>\nstream\n'+text+'\nendstream');
 }
 objects[1]='<< /Type /Pages /Kids ['+kids.join(' ')+'] /Count '+pages+' >>';
 objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
 let out='%PDF-1.4\n';const offsets=[];
 for(const [i,value] of objects.entries()){offsets.push(Buffer.byteLength(out));out+=(i+1)+' 0 obj\n'+value+'\nendobj\n';}
 const pos=Buffer.byteLength(out);
 return out+'xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+pos+'\n%%EOF';
}

test('function routes inherit defaults, PPT teaching inherits recognition and weekly analysis inherits single analysis',()=>{
 const s={baseUrl:'http://default',model:'default',apiKey:'D',modelProfiles:[{id:'v',name:'Vision',baseUrl:'http://vision',model:'vision',apiKey:'V'},{id:'t',name:'Translate',baseUrl:'http://text',model:'text',apiKey:'T'}],modelRoutes:{pptRecognition:'v',deepDive:'t'}};validateModelRouting(s);assert.equal(resolveModel(s,'pptTranslation').model,'vision');assert.equal(resolveModel(s,'weeklyDeepDive').apiKey,'T');assert.equal(resolveModel(s,'qa').model,'default');s.modelRoutes.pptTranslation='t';assert.equal(resolveModel(s,'pptTranslation').apiKey,'T');assert.notEqual(modelIdentity(resolveModel(s,'pptTranslation')),modelIdentity(resolveModel(s,'pptRecognition')));assert.throws(()=>validateModelRouting({...s,modelRoutes:{qa:'missing'}}),/无效/);
});
test('PPT uses assigned vision, translation and explanation models without trusting translations emitted by recognition',async()=>{
 const primary={model:'vision',baseUrl:'http://mock',apiKey:'V',contextChars:50000},translation={...primary,model:'translator',apiKey:'T'},explanation={...primary,model:'critic',apiKey:'E',visionEnabled:false},calls=[],state={};
 const answer=await completePptPage({state,source:{fileName:'Slides.pptx',sha256:'a'.repeat(64),format:'pptx'},input:{page:1},settings:{...primary,taskModels:{translation,explanation}},prompts:{learning:'merged',recognition:'recognition',translation:'translate',explanation:'explain',repair:'repair'},options:{images:['data:image/png;base64,AA==']},persist:async()=>{},call:async(s,sys,user,options)=>{calls.push({model:s.model,apiKey:s.apiKey,images:options.images});if(s.model==='vision')return JSON.stringify({title:'Comparison',pageType:'concept',status:'complete',blocks:[{original:'A distinction',chinese:'Wrong unused translation',role:'body'}],visuals:[],explanation:'Wrong unused explanation',uncertainties:[]});if(s.model==='translator')return JSON.stringify({chinese:'一个区分'});return JSON.stringify({closeReading:'This explains a distinction.'});}});
 assert.deepEqual(calls.map(c=>c.model),['vision','translator','critic']);assert(!calls[1].images);assert(calls[0].images&&!calls[2].images,'a text-only explanation profile receives recognized evidence without images');assert.equal(answer.learning.paragraphs[0].chinese,'一个区分');assert.equal(answer.learning.closeReading,'This explains a distinction.');assert.equal(state.models['补译正文'].model,'translator');
});
test('updating only translation or explanation preserves recognized content and never calls the other teaching model',async()=>{
 const settings={baseUrl:'http://mock',apiKey:'V',model:'vision',contextChars:50000,taskModels:{translation:{baseUrl:'http://mock',apiKey:'T',model:'translator'},explanation:{baseUrl:'http://mock',apiKey:'E',model:'critic'}}},source={fileName:'Slide.pptx',sha256:'a'.repeat(64),format:'pptx'},prompts={recognition:'recognition',learning:'merged',translation:'translation',explanation:'explanation',repair:'repair'};
 const task={total:1,pageDrafts:{},pages:[{page:1,title:'Original',blank:false,hidden:false,originalText:[{text:'Original content',role:'body',method:'native'}],visualObservations:[],analysis:[],uncertainties:[],inspection:{fullPageViewed:true,textExtracted:true,status:'complete'},learning:{schema:'classroom.ppt-learning.v1',pageType:'concept',paragraphs:[{originalIndex:0,chinese:'原译文'}],closeReading:'Original explanation'}}]};
 for(const [part,expected] of [['translation','translator'],['explanation','critic']]){resetPptTeaching(task,part);const calls=[];const page=await completePptPage({state:task.pageDrafts[0],input:{page:1},source,settings,prompts,options:{images:['image']},persist:async()=>{},call:async(s)=>{calls.push(s.model);return JSON.stringify(part==='translation'?{chinese:'新译文'}:{closeReading:'New explanation'});}});assert.deepEqual(calls,[expected]);assert.equal(page.originalText[0].text,'Original content');assert.equal(page.learning.paragraphs[0].chinese,'新译文');if(part==='translation')assert.equal(page.learning.closeReading,'Original explanation');task.pages[0]=page;}
});
test('server keeps profile secrets private, translates a reference only, isolates file QA and changes purpose without copying originals',async()=>{
 const data=await mkdtemp(path.join(os.tmpdir(),'classroom-models-')),seen=[];let ui;
 const mock=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw),system=b.messages[0].content,input=JSON.parse(b.messages[1].content);seen.push({model:b.model,key:req.headers.authorization,system,input});let answer='Shared notes';if(system.includes('Reference bilingual translation'))answer=JSON.stringify({chinese:'文献中文译文。'});else if(system.includes('Reconstruct classroom'))answer=JSON.stringify({segments:input.cues.map(c=>({speaker:'Lecturer',chapter:'Class',english:c.text,cueIds:[c.id]}))});else if(system.includes('Paragraph translation'))answer=JSON.stringify({chinese:'课堂中文译文。'});else if(system.includes('Ask this class'))answer='Only the selected document supports this claim. [R1]';else if(system.includes('Deep Dive issue plan'))answer=JSON.stringify({issues:['How is evidence distinguished?']});else if(system.includes('Weekly synthesis'))answer='## Analysis\n\nA grounded comparison.';if(input.english==='ABORT_THIS_BLOCK'&&b.model==='translator'){res.writeHead(401);return res.end();}const filtered=input.english==='FILTER_THIS_BLOCK'&&b.model==='translator';res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:filtered?'content_filter':'stop',message:{content:filtered?null:answer}}]}));});await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:data,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 try{
  for(let i=0;i<150&&!log.includes('http://');i++)await sleep(30);const base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(base,log);const api=async(url,b)=>{const r=await fetch(base+url,b===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});const value=await r.json();assert(r.ok,JSON.stringify(value));return value;};
  const profiles=['translator','asker','scholar'].map((model,i)=>({id:model,name:model,model,baseUrl:`http://127.0.0.1:${mock.address().port}/v1`,apiKey:'secret-'+i,contextChars:70000,maxOutputTokens:4000}));await api('/api/settings',{baseUrl:profiles[0].baseUrl,model:'default',apiKey:'default-secret',modelProfiles:profiles,modelRoutes:{referenceTranslation:'translator',transcriptTranslation:'translator',qa:'asker',weeklyDeepDive:'scholar'}});let settings=await api('/api/settings');assert(settings.modelProfiles.every(p=>!('apiKey' in p)&&p.hasApiKey));assert(!JSON.stringify(settings).includes('secret-'));
  await api('/api/settings',{modelProfiles:settings.modelProfiles.map(p=>({...p,apiKey:''})),modelRoutes:settings.modelRoutes});assert.equal(JSON.parse(await readFile(path.join(data,'settings.json'),'utf8')).modelProfiles[0].apiKey,'secret-0');
  const p=await api('/api/projects',{name:'Reference library'}),route='/api/projects/'+p.id;await api(route+'/bb',{text:'UNRELATED_BB must not enter focused reference questions.'});
  const upload=async(name,text)=>{const r=await fetch(base+route+'/upload',{method:'POST',headers:{'x-file-role':'reading','x-file-name':name},body:validPdf(Array.isArray(text)?text.length:1)+name});assert.equal(r.status,201);const state=await r.json(),f=state.files.at(-1);const parsed=await fetch(base+route+'/parsed?source='+f.id,{method:'POST',headers:{'x-parse-format':'json'},body:JSON.stringify(Array.isArray(text)?text.map((text,page_idx)=>({type:'text',page_idx,text})):[{type:'text',page_idx:0,text}])});assert.equal(parsed.status,200);return f;};
  const a=await upload('A.pdf','SELECTED_ORIGINAL: Evidence is different from interpretation.'),b=await upload('B.pdf','UNRELATED_REFERENCE must not enter A.');
  await api(route+'/process',{mode:'reference',sourceId:a.id});let state;for(let i=0;i<200;i++){state=await api(route);if(state.status!=='running')break;await sleep(20);}assert.equal(state.status,'done',state.error);assert(!state.weekly);assert.equal(seen.length,1);assert.equal(seen[0].model,'translator');assert.equal(seen[0].key,'Bearer secret-0');assert(!seen[0].input.english.includes('UNRELATED'));
  const reader=await api(route+'/reference-reader?source='+a.id);assert(reader.generated);assert.equal(reader.paragraphs[0].chinese,'文献中文译文。');assert.equal(reader.paragraphs[0].pageIndex,0);const generation=state.files.find(f=>f.id===a.id).referenceTranslation.generation;
  const answer=await api(route+'/ask',{question:'What is evidence?',scope:'preparation',focus:{kind:'file',sourceId:a.id}});assert(answer.answer.includes('reading-reference?ref=r-'));const ask=seen.at(-1);assert.equal(ask.model,'asker');assert(ask.input.passages.every(v=>v.sourceId===a.id));assert(!JSON.stringify(ask.input).includes('UNRELATED'));assert.equal(ask.input.sourceNotes.length,0);
  const md=await (await fetch(base+route+'/output?scope='+encodeURIComponent('reference:'+a.id)+'&name=Bilingual.md')).text();assert(md.startsWith('# A.pdf'));
  let browser=true;try{await browserExecutable();}catch{browser=false;}if(browser){
   ui=await launchRenderer(base,{});await ui.screenshot(1500,1000);await ui.evaluate("setTimeout(()=>location.href='/legacy/',0);true");const wait=async expression=>{for(let i=0;i<220;i++){try{if(await ui.evaluate(expression))return;}catch{}await sleep(40);}throw Error('UI timeout: '+expression);};await wait("!!document.querySelector('#workspace')&&!document.querySelector('#workspace').hidden");
   await ui.evaluate("document.querySelector('#surface-reading').click();true");await wait("!document.querySelector('#material-reference').hidden");await ui.evaluate("document.querySelector('#material-reference').click();true");await wait("document.querySelector('#reference-canvas').dataset.page==='0'&&document.querySelector('#reference-paragraphs').textContent.includes('文献中文译文')");assert.equal(await ui.evaluate("document.querySelector('#ask-kind').value"),'reference');await wait("document.querySelector('#process').textContent.includes('文献翻译')");
   if(process.env.CLASSROOM_MODEL_EVIDENCE){await mkdir(process.env.CLASSROOM_MODEL_EVIDENCE,{recursive:true});await writeFile(path.join(process.env.CLASSROOM_MODEL_EVIDENCE,'Reference-reading.png'),await ui.screenshot(1500,1000));}
   await ui.evaluate("document.querySelector('#qa-launch').click();true");const width=await ui.evaluate("document.querySelector('.qa').getBoundingClientRect().width");await ui.evaluate("document.querySelector('.qa-resize[data-edge=left]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));true");assert(await ui.evaluate("document.querySelector('.qa').getBoundingClientRect().width")>width+15);await ui.evaluate("document.querySelector('#qa-maximize').click();true");assert(await ui.evaluate("document.querySelector('.qa').getBoundingClientRect().width>innerWidth-20"));await ui.evaluate("document.querySelector('#qa-maximize').click();true");assert(await ui.evaluate("document.querySelector('.qa').getBoundingClientRect().width")<800);
   await ui.evaluate(`(()=>{const f=document.querySelector('#ask-file');f.value='${b.id}';f.dispatchEvent(new Event('change'));const s=document.querySelector('#ask-scope');s.value='file';s.dispatchEvent(new Event('change'));return true;})()`);assert.equal(await ui.evaluate("document.querySelectorAll('#chat .message').length"),0,'history from another file is not mixed in');await ui.evaluate("document.querySelector('#question').value='Explain this reference';document.querySelector('#ask-form').requestSubmit();true");await wait("document.querySelectorAll('#chat .message').length===2");assert(seen.at(-1).input.passages.every(v=>v.sourceId===b.id));
   if(process.env.CLASSROOM_MODEL_EVIDENCE){await ui.evaluate("document.querySelector('#qa-layout').click();true");await sleep(150);await writeFile(path.join(process.env.CLASSROOM_MODEL_EVIDENCE,'Ask-reference.png'),await ui.screenshot(1500,1000));}
   await ui.evaluate("document.querySelector('#qa-toggle').click();document.querySelector('#settings-open').click();true");await wait("document.querySelector('#settings').open&&document.querySelectorAll('[data-model-id]').length>=3");await ui.evaluate("document.querySelector('[data-settings-section=routes]').click();true");assert.equal(await ui.evaluate("document.querySelector('[data-task=referenceTranslation]').value"),'translator');await ui.evaluate("document.querySelector('[data-settings-section=models]').click();document.querySelector('[data-model-id=translator]').click();true");assert.equal(await ui.evaluate("document.querySelector('[data-profile=translator] [data-field=apiKey]').value"),'');if(process.env.CLASSROOM_MODEL_EVIDENCE)await writeFile(path.join(process.env.CLASSROOM_MODEL_EVIDENCE,'Settings.png'),await ui.screenshot(1500,1000));await ui.evaluate("document.querySelector('#settings').close();true");
  }
  const oldBytes=await readFile(path.join(data,'classes',p.id,'Source',a.stored));state=await api(route+'/material-role',{sourceId:a.id,role:'ppt'});assert.equal(state.files.find(f=>f.id===a.id).stored,a.stored);const oldRef=answer.answer.match(/ref=(r-[\w-]+)/)[1];assert.equal((await fetch(base+route+'/reading-reference-data?ref='+oldRef)).status,200,'changing purpose preserves the original citation');assert.equal(state.files.find(f=>f.id===a.id).parsed,a.id+'/blocks.json');state=await api(route+'/material-role',{sourceId:a.id,role:'reading'});assert.equal(state.files.find(f=>f.id===a.id).referenceTranslation.generation,generation);assert((await readFile(path.join(data,'classes',p.id,'Source',a.stored))).equals(oldBytes));
  const lesson=(await api(route+'/sessions',{title:'Lecture'})).session;const subtitle=await fetch(base+route+'/upload',{method:'POST',headers:{'x-file-role':'srt','x-file-name':'Class.srt','x-session-id':lesson.id},body:'1\n00:00:01,000 --> 00:00:02,000\nLecturer: Classroom evidence stays separate.'});assert.equal(subtitle.status,201);await api(route+'/process',{mode:'session',sessionId:lesson.id});for(let i=0;i<200;i++){state=await api(route);if(state.status!=='running')break;await sleep(20);}assert.equal(state.status,'done',state.error);assert.equal(seen.find(r=>r.system.includes('Reconstruct classroom')).model,'default');assert.equal(seen.find(r=>r.system.includes('Paragraph translation')).model,'translator');
  await api(route+'/process',{mode:'week',sessionIds:[]});for(let i=0;i<200;i++){state=await api(route);if(state.status!=='running')break;await sleep(20);}assert.equal(state.status,'done',state.error);assert(seen.filter(r=>r.system.includes('Weekly synthesis')||r.system.includes('Deep Dive issue plan')).every(r=>r.model==='scholar'));
  const c=await upload('Filtered.pdf',['FIRST_REFERENCE_BLOCK','FILTER_THIS_BLOCK','LAST_REFERENCE_BLOCK']);
  const waitForReference=async()=>{for(let i=0;i<200;i++){const project=await api(route);if(project.status!=='running')return project;await sleep(20);}assert.fail('reference task did not finish');};
  const processReference=async(referenceProfileId,sourceId=c.id)=>{await api(route+'/process',{mode:'reference',sourceId,referenceProfileId});return waitForReference();};
  const readerUrl=route+'/reference-reader?source='+c.id,outputUrl=route+'/output?scope='+encodeURIComponent('reference:'+c.id)+'&name=Bilingual.md';
  const from=seen.length;
  assert.equal((await processReference()).status,'partial');
  assert.deepEqual(seen.slice(from).map(r=>r.input.english),['FIRST_REFERENCE_BLOCK','FILTER_THIS_BLOCK','LAST_REFERENCE_BLOCK']);
  const partial=await api(readerUrl);
  assert.deepEqual(partial.summary,{total:3,completed:2,blocked:1});
  assert.equal(partial.paragraphs[1].status,'blocked');
  assert.equal(partial.paragraphs[1].pageIndex,1);
  const partialMarkdown=await (await fetch(base+outputUrl)).text();
  assert.match(partialMarkdown,/2\/3/);assert.match(partialMarkdown,/FILTER_THIS_BLOCK/);
  const checkpoint=JSON.parse(await readFile(path.join(data,'classes',p.id,'Parsed',c.id,'reference-translation.json'),'utf8'));
  assert.equal(Object.values(checkpoint.entries).filter(r=>r.status==='complete').length,2);
  const retryFrom=seen.length;
  if(ui){
   const waitReload=async origin=>{for(let i=0;i<100;i++){try{if(await ui.evaluate('performance.timeOrigin!=='+origin))return;}catch{}await sleep(40);}assert.fail('reload did not complete');};
   const reloadOrigin=await ui.evaluate("setTimeout(()=>location.reload(),0);performance.timeOrigin");
   await waitReload(reloadOrigin);
   const wait=async expression=>{for(let i=0;i<220;i++){try{if(await ui.evaluate(expression))return;}catch{}await sleep(40);}throw Error('UI timeout: '+expression);};
   await wait("!document.querySelector('#workspace').hidden");
   await ui.evaluate("document.querySelector('#surface-reading').click();true");
   await wait("!document.querySelector('#material-reference').hidden");
   await ui.evaluate("document.querySelector('#material-reference').click();true");
   await wait("Array.from(document.querySelector('#reference-file').options).some(o=>o.value==='"+c.id+"')");
   await ui.evaluate("(()=>{const file=document.querySelector('#reference-file');file.value='"+c.id+"';file.dispatchEvent(new Event('change'));return true;})()");
   await wait("document.querySelector('#reference-status').textContent.includes('2/3')&&!document.querySelector('#reference-retry-model').hidden&&!document.querySelector('#process').disabled");
   await wait("document.querySelectorAll('.reference-page-row').length===3");
   await ui.evaluate("(()=>{const scroller=document.querySelector('#reference-scroll'),row=document.querySelector('.reference-page-row[data-page=\"1\"]');scroller.scrollTop+=row.getBoundingClientRect().top-scroller.getBoundingClientRect().top+10;return true;})()");
   await wait("document.querySelector('#reference-page').value==='2'&&!!document.querySelector('.reference-page-row[data-page=\"1\"] canvas')");
   await ui.evaluate("document.querySelector('.reference-toolbar .reading-ask').click();true");
   assert.equal(await ui.evaluate("document.querySelector('#ask-page').value"),'2','scrolling updates the question page');
   assert.equal(await ui.evaluate("document.querySelector('#ask-file').value"),c.id);
   await ui.evaluate("document.querySelector('#qa-toggle').click();document.querySelector('#reference-page').value='3';document.querySelector('#reference-page').dispatchEvent(new Event('change'));true");
   await wait("document.querySelector('#reference-page').value==='3'&&!!document.querySelector('.reference-page-row[data-page=\"2\"] canvas')");
   await ui.evaluate("document.querySelector('#surface-overview').click();document.querySelector('#surface-reading').click();true");
   await wait("document.querySelector('#reference-page').value==='3'");
   assert(await ui.evaluate("document.querySelectorAll('#reference-scroll canvas').length<=3"),'only nearby PDF canvases are retained');
   if(process.env.CLASSROOM_MODEL_EVIDENCE)await writeFile(path.join(process.env.CLASSROOM_MODEL_EVIDENCE,'Reference-continuous.png'),await ui.screenshot(1500,1000));
   await ui.evaluate("document.querySelector('#reference-more').open=true;document.querySelector('#reference-retry-model').value='scholar';document.querySelector('#process').click();true");
   await wait("document.querySelector('#reference-status').textContent.includes('3/3')");
   assert.equal(await ui.evaluate("document.querySelector('#reference-page').value"),'3','translation refresh preserves the current page');
   assert(await ui.evaluate("document.querySelector('.progress').hidden"),'reading uses the compact task indicator');
   if(process.env.CLASSROOM_MODEL_EVIDENCE){
    await ui.evaluate("document.querySelector('#reference-scroll').scrollTop-=400;true");
    await sleep(100);
    await writeFile(path.join(process.env.CLASSROOM_MODEL_EVIDENCE,'Reference-continuous.png'),await ui.screenshot(1500,1000));
   }

   assert.equal((await api(route)).status,'done');
  }else assert.equal((await processReference('scholar')).status,'done');
  assert.deepEqual(seen.slice(retryFrom).map(r=>[r.model,r.input.english]),[['scholar','FILTER_THIS_BLOCK']]);
  const recovered=await api(readerUrl);
  assert.deepEqual(recovered.summary,{total:3,completed:3,blocked:0});
  assert.deepEqual(recovered.paragraphs.map(r=>r.model),['translator','scholar','translator']);
  assert.equal((await api('/api/settings')).modelRoutes.referenceTranslation,'translator');
  const legacy=await upload('Legacy interrupted.pdf',['CACHED_BEFORE_FAILURE','ABORT_THIS_BLOCK','NOT_YET_ATTEMPTED']);
  const legacyFrom=seen.length;
  assert.equal((await processReference(undefined,legacy.id)).status,'error');
  assert.deepEqual(seen.slice(legacyFrom).map(r=>r.input.english),['CACHED_BEFORE_FAILURE','ABORT_THIS_BLOCK'],'global credential errors stop the run');
  // Reproduce the previous release, which had the model cache but no per-reference checkpoint.
  await rm(path.join(data,'classes',p.id,'Parsed',legacy.id,'reference-translation.json'));
  const migratedFrom=seen.length;
  assert.equal((await processReference('scholar',legacy.id)).status,'done');
  assert.deepEqual(seen.slice(migratedFrom).map(r=>[r.model,r.input.english]),[['scholar','ABORT_THIS_BLOCK'],['scholar','NOT_YET_ATTEMPTED']]);

 }finally{await ui?.close();child.kill();await new Promise(r=>child.once('exit',r));await new Promise(r=>mock.close(r));await rm(data,{recursive:true,force:true});}
});
