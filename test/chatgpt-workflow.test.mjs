import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {access,mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {testPdf} from '../lib/diagnostics.mjs';
import {browserExecutable,launchRenderer} from '../lib/browser-render.mjs';

test('ChatGPT default serves diagnostics, Ask, whole course workflows and isolated page trials',async t=>{
 try{await browserExecutable();}catch{t.skip('No local browser to render the source page');return;}
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-siwc-workflow-'));
 const fixture=path.join(dir,'responses-fixture.mjs');
 await writeFile(fixture,`
  import assert from 'node:assert/strict';
  import {writeFile} from 'node:fs/promises';
  import path from 'node:path';
  import {registerHooks} from 'node:module';
  let firstReference=0,secondReference=0;
  registerHooks({load(url,context,next){
   const value=next(url,context);
   if(!url.endsWith('/lib/chatgpt-plan.mjs'))return value;
   return {...value,source:value.source.toString().replace(
    'request=fetch,vault=windowsVault','request=globalThis.responsesFixture,vault=windowsVault'
   ).replace('const access=()=>write','const access=()=>Promise.resolve("fixture-token"); const realAccess=()=>write')
    .replace('connected:!!record?.accessToken&&(record.expiresAt>Date.now()||!!record.refreshToken)','connected:true')};
  }});
  globalThis.responsesFixture=async(url,options)=>{
   assert.equal(url,'https://api.openai.com/v1/responses');
   assert.equal(options.headers.Authorization,'Bearer fixture-token');
   assert.equal(options.headers.Accept,'text/event-stream');
   const body=JSON.parse(options.body),content=body.input[0].content;
   assert.equal(body.model,'fixture-model');
   assert.equal(body.stream,true);
   assert.equal(body.store,false);
   if(body.text?.format?.type==='json_object')assert(content.some(part=>part.type==='input_text'&&part.text.toLowerCase().includes('json')));
   const image=content.find(part=>part.type==='input_image');
   const prompt=body.instructions,inputText=content[0].text;
   let input;try{input=JSON.parse(inputText);}catch{}
   let text='The course concerns comparison. [R1]';
   if(prompt.includes('plain text connectivity check'))text='OK';
   else if(prompt.includes('This is a connectivity check')){
    assert.equal(body.text.format.type,'json_object');text='{"status":"ok"}';
   }else if(prompt.includes('Read the attached chart only'))text='{"books":7,"notes":4}';
   else if(prompt.includes('Build a compact teaching roadmap')){
    text=JSON.stringify({overview:'Map',pages:input.pages.map(p=>({page:p.page,title:'Classroom',section:'Section',purpose:'Test'})),terms:[]});
   }else if(prompt.includes('PPT whole-deck review'))text='{"terms":[],"changes":[]}';
   else if(prompt.includes('Reconstruct classroom'))text=JSON.stringify({segments:input.cues.map(c=>({speaker:'Lecturer',chapter:'Comparison',english:c.text,cueIds:[c.id]}))});
   else if(prompt.includes('Paragraph translation'))text='{"chinese":"讲稿中文译文。"}';
   else if(prompt.includes('Reference bilingual translation')){
    if(input.english.includes('FIRST_REFERENCE'))assert.equal(++firstReference,1);
    if(input.english.includes('SECOND_REFERENCE')&&++secondReference===1){
     const stopped=new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
     await writeFile(path.join(process.env.CLASSROOM_DATA,'reference-started'),'1');
     await stopped;
    }
    text='{"chinese":"文献中文译文。"}';
   }
   else if(prompt.includes('Deep Dive issue plan'))text='{"issues":["How does comparison work?"]}';
   else if(prompt.includes('Weekly synthesis')||prompt.includes('Deep Dive /'))text='## Analysis\\n\\nA grounded comparison.';
   else if(image){
    assert.match(image.image_url,/^data:image[/]png;base64,/);
    text=JSON.stringify({blocks:[{original:input.nativeText||'Classroom connection test',chinese:'测试课件译文',role:'body'}],
     visuals:[],explanation:'本页说明测试用途。',uncertainties:[]});
   }
   const event=value=>'data: '+JSON.stringify(value)+'\\n\\n';
   return new Response(Buffer.from(event({type:'response.output_text.delta',delta:text})+event({type:'response.completed',response:{status:'completed'}})));
  };
 `);
 const child=spawn(process.execPath,['--import',pathToFileURL(fixture).href,'server.mjs'],{cwd:new URL('..',import.meta.url),
  env:{...process.env,PORT:'0',CLASSROOM_DATA:dir},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let log='';
 child.stdout.on('data',value=>log+=value);
 child.stderr.on('data',value=>log+=value);
 t.after(async()=>{
  if(child.exitCode===null&&child.signalCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}
  await rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:50});
 });
 let base;
 for(let i=0;i<200&&!base&&child.exitCode===null;i++){await sleep(25);base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];}
 assert(base,log);
 async function request(route,options){
  const response=await fetch(base+route,options),value=await response.json();
  assert(response.ok,JSON.stringify(value));
  return value;
 }
 const post=(route,body)=>request(route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const profile={id:'gpt',name:'Fixture GPT',model:'fixture-model',provider:'chatgpt-plan'};
 await post('/api/settings/editor',{section:'model',profile});
 await post('/api/settings/editor',{section:'model',profile:{id:'api-choice',provider:'api',name:'Vision API',model:'fixture-vision',baseUrl:'http://127.0.0.1:1',apiKey:'fixture'}});
 await post('/api/settings/editor',{section:'model',profile:{id:'acp-choice',provider:'antigravity-acp',name:'Gemini ACP',model:'fixture-flash',acpEntry:'cli',acpExecutable:'C:/Official/agy.exe'}});

 await post('/api/settings/editor',{section:'models',defaultProfileId:'gpt'});
 await post('/api/settings/editor',{section:'routes',modelRoutes:{pptPreview:'gpt'}});
 const project=await post('/api/projects',{name:'Plan workflow'});
 const route='/api/projects/'+project.id;
 await post(route+'/bb',{text:'COMPARISON_BB. The course concerns comparison.'});
 async function wait(id){
  for(let i=0;i<300;i++){
   const job=await request('/api/chatgpt/jobs/'+id);
   if(job.status!=='running'){assert.equal(job.status,'success',job.message);return job;}
   await sleep(30);
  }
  assert.fail('ChatGPT request did not finish');
 }
 for(const kind of ['text','json','vision']){
  const testJob=await post('/api/settings/model-test',{kind,profile});
  assert.equal(testJob.transport,'chatgpt');
  await wait(testJob.id);
 }
 const ask=await wait((await post(route+'/ask',{question:'What does COMPARISON_BB say?',scope:'week'})).chatgptJobId);
 assert.match(ask.result.answer,/course concerns comparison/);
 assert.match(ask.text,/course concerns comparison/);
 assert(ask.phaseHistory.some(item=>item.phase==='submitted'));
 const upload=await request(route+'/upload',{method:'POST',headers:{'x-file-role':'ppt','x-file-name':'Slides.pdf'},body:testPdf()});
 const original=upload.files.at(-1);
 const trial=await wait((await post(route+'/chatgpt-ppt-page',{sourceId:original.id,pageIndex:0})).chatgptJobId);
 assert.equal(trial.result.page.pageIndex,0);
 assert.equal(trial.result.page.sourceHash,original.sha256);
 assert.equal(trial.result.page.paragraphs[0].chinese,'测试课件译文');
 assert.equal(trial.result.page.closeReading,'本页说明测试用途。');
 assert.deepEqual((await request(route)).files,upload.files);
 const ui=await launchRenderer(base,{});
 t.after(()=>ui.close());
 await ui.evaluate("setTimeout(()=>location.href='/',0);true");
 async function waitFor(expression){
  for(let i=0;i<200;i++){
   try{if(await ui.evaluate(expression))return;}catch{}
   await sleep(30);
  }
  assert.fail('Browser did not reach '+expression);
 }
 await waitFor("!document.querySelector('#workspace').hidden");
 await ui.evaluate("document.querySelector('#surface-reading').click();true");
 await waitFor("document.querySelector('#reader-file').selectedOptions[0]?.textContent.includes('Slides.pdf')");
 await ui.evaluate("document.querySelector('#reader-more summary').click();[...document.querySelectorAll('#reader-more button')].find(b=>b.textContent==='试解析本页').click();true");
 await waitFor("document.querySelector('#chatgpt-page-dialog').open&&document.querySelector('#chatgpt-page-result').textContent.includes('测试课件译文')");
 assert.equal(await ui.evaluate("document.querySelector('#chatgpt-page-label').textContent"),'Slides.pdf · 第 1 页');
 await ui.evaluate("document.querySelector('#chatgpt-page-close').click();document.querySelector('#settings-open').click();true");
 await waitFor("document.querySelector('#default-model')?.value==='gpt'");
 assert.equal(await ui.evaluate("[...document.querySelectorAll('.settings-test-actions button')].filter(b=>/^测试/.test(b.textContent)).map(b=>b.textContent).join(',')"),'测试纯文字,测试 JSON,测试图片');
 await ui.evaluate("document.querySelector('[data-settings-section=routes]').click();true");
 const choices=await ui.evaluate("[...document.querySelectorAll('select[data-task]')].map(s=>[...s.options].map(o=>o.value))");
 assert.equal(choices.length,12);
 for(const options of choices)for(const profileId of ['gpt','api-choice','acp-choice'])assert(options.includes(profileId));
 await wait((await post(route+'/process',{mode:'preparation'})).chatgptJobId);
 assert.match(await (await fetch(base+route+'/output?scope=preparation&name=PPT_Bilingual_Guide.md')).text(),/测试课件译文/);
 const session=(await post(route+'/sessions',{type:'Lecture',title:'Comparison'})).session;
 await request(route+'/upload',{method:'POST',headers:{'x-file-role':'srt','x-file-name':'Class.srt','x-session-id':session.id},
  body:'1\n00:00:01,000 --> 00:00:06,000\nWe compare two literary texts.\n'});
 await wait((await post(route+'/process',{mode:'session',sessionId:session.id})).chatgptJobId);
 assert.match(await (await fetch(base+route+'/output?scope='+session.id+'&name=Class_Script_Bilingual.md')).text(),/讲稿中文译文/);
 await wait((await post(route+'/process',{mode:'analysis',sessionId:session.id})).chatgptJobId);
 await wait((await post(route+'/process',{mode:'week',sessionIds:[session.id]})).chatgptJobId);
 assert.equal((await request(route)).weekly.selectedSessionIds[0],session.id);
 const reference=(await request(route+'/upload',{method:'POST',headers:{'x-file-role':'reading','x-file-name':'Reference.pdf'},body:Buffer.concat([testPdf(),Buffer.from('Reference')])})).files.at(-1);
 await request(route+'/parsed?source='+reference.id,{method:'POST',headers:{'x-parse-format':'json'},body:JSON.stringify([
  {type:'text',page_idx:0,text:'FIRST_REFERENCE Comparative reading reference evidence.'},
  {type:'text',page_idx:0,text:'SECOND_REFERENCE Another original reference paragraph.'}
 ])});
 const referenceJob=(await post(route+'/process',{mode:'reference',sourceId:reference.id})).chatgptJobId;
 const marker=path.join(dir,'reference-started');
 for(let i=0;i<200;i++){if(await access(marker).then(()=>true,()=>false))break;await sleep(20);}
 await access(marker);
 await post('/api/chatgpt/jobs/'+referenceJob+'/cancel',{});
 for(let i=0;i<200;i++){if((await request('/api/chatgpt/jobs/'+referenceJob)).status==='cancelled')break;await sleep(20);}
 assert.equal((await request('/api/chatgpt/jobs/'+referenceJob)).status,'cancelled');
 assert.equal((await request(route+'/reference-reader?source='+reference.id)).summary.completed,1);
 await wait((await post(route+'/process',{mode:'reference',sourceId:reference.id})).chatgptJobId);
 const reader=await request(route+'/reference-reader?source='+reference.id);
 assert.equal(reader.summary.completed,2);
 assert.equal(reader.paragraphs[0].chinese,'文献中文译文。');
});
