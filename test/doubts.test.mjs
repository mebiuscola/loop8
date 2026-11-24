import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import {exactPages,needsWork,pageHints,deckNotes,doubtSummary,reviewOpen,migrateDoubtCounts,DOUBT_VERSION} from '../lib/doubts.mjs';
import {contentListDocument,contentHash} from '../lib/materials.mjs';
import {browserExecutable,launchRenderer} from '../lib/browser-render.mjs';
import {openApp,waitFor,waitText,click,go} from './helpers/app.mjs';

const FONT='本机缺少课件字体：Garamond Premier；这些文字可能使用替代字体';
const ok=(page,extra=[])=>({page,inspection:{status:extra.length?'partial':'complete',fullPageViewed:true,textExtracted:true},uncertainties:[FONT,...extra],visualObservations:[],originalText:[{text:'Slide '+page}]});
// Like the real data: the font warning on every page, a few page doubts, one page not readable.
const checkpoint=()=>({total:4,pages:[ok(1),ok(2,['第二行小字“Bhabha 1994”看不清']),{...ok(3),visualObservations:[{description:'chart',uncertainties:['图例颜色难以区分']}]},{page:4,inspection:{status:'unavailable',fullPageViewed:false,textExtracted:true},uncertainties:['图片无法访问'],visualObservations:[],originalText:[]}],
 deckReview:{status:'pending',issues:[{kind:'change',error:'修改前文本与当前内容不匹配。'},{kind:'term',error:'术语未核对到译法'}]}});

test('only unreadable pages need work; doubts are page hints; the font warning is one file note',()=>{
 const c=checkpoint();
 assert.deepEqual(c.pages.map(p=>needsWork(p,true)),[false,false,false,true]);
 assert.deepEqual(pageHints(c.pages[0]),[],'the copied font warning is not a page hint');
 assert.deepEqual(pageHints(c.pages[2]),['图例颜色难以区分'],'doubts on a figure are hints of its page');
 assert.deepEqual(deckNotes(c),[FONT]);
 assert.deepEqual(doubtSummary(c,true),{incomplete:1,hints:3,notes:[FONT],doubtVersion:DOUBT_VERSION});
 assert.equal(doubtSummary(c,true,{2:['第二行小字“Bhabha 1994”看不清']}).hints,2,'checked hints are not counted');
 assert.equal(needsWork({page:1,status:'partial',uncertainties:['x']},false),false);
 assert.equal(needsWork({page:1,status:'unreadable',uncertainties:['x']},false),true);
 assert.deepEqual(pageHints({uncertainties:['渲染检查发现 2 个文字区域可能裁切或超出页面。','1 个文本框可能溢出，可用 PDF 核对','2 个文字区域可能裁切或超出页面，需核对原件']}),['2 个文字区域可能超出页面或被裁切，请对照原页核对。'],'one overflow finding reported by three checks is one hint');
 // With PowerPoint's own slide images, the approximate drawing's findings (overflow, missing fonts) are not hints.
 assert.deepEqual(pageHints({uncertainties:['2 个文字区域可能裁切或超出页面，需核对原件','图例颜色难以区分']},{exact:true}),['图例颜色难以区分']);
 assert.deepEqual(deckNotes(c,{exact:true}),[]);
 assert.deepEqual(doubtSummary({pages:[{page:1,uncertainties:['1 个文本框可能溢出，可用 PDF 核对']}]},true,{},{exact:true}),{incomplete:0,hints:0,notes:[],doubtVersion:DOUBT_VERSION});
 assert.equal(exactPages({status:'ready',slides:true}),true);assert.equal(exactPages({status:'error'}),false);assert.equal(exactPages(null),false);
 assert.equal(reviewOpen(c.deckReview),false,'suggested edits that failed verification leave nothing to do');
 assert.equal(reviewOpen({issues:[{kind:'request',error:'timeout'}]}),true);
});

test('existing results are recounted once at startup, without re-parsing; hints can be checked in the reader',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-doubts-')),id='Week_D',folder=path.join(dir,'classes',id);let child,ui;
 try{
  const {PDFDocument,StandardFonts}=createRequire(import.meta.url)('../vendor/pdf-lib.cjs');
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
  for(let i=1;i<=4;i++)pdf.addPage([720,405]).drawText('Slide '+i,{x:40,y:300,size:30,font});
  const bytes=Buffer.from(await pdf.save());
  // Saved before doubt levels: every page counted as having doubts.
  const f={id:'deck',role:'ppt',name:'Slides.pdf',stored:'Slides.pdf',sha256:contentHash(bytes),size:bytes.length,parsed:'deck/blocks.json',parseStatus:'ready',
   aiParse:{status:'done',stage:'页面已完成 · 检查待处理',completed:4,total:4,incomplete:4,review:checkpoint().deckReview}};
  const p={id,name:'Doubt week',created:new Date().toISOString(),schemaVersion:2,sourceLayoutVersion:1,outputStorageVersion:1,status:'idle',materialRevision:1,revision:1,bbText:'',sessions:[],files:[f],chat:[],tasks:{}};
  const cp=checkpoint(),stored=JSON.stringify(cp);
  for(const [file,value] of Object.entries({'project.json':JSON.stringify(p),'Source/Slides.pdf':bytes,'Parsed/deck/ppt_task.json':stored,
   'Parsed/deck/blocks.json':JSON.stringify(contentListDocument([1,2,3,4].map(i=>({type:'text',text:'Slide '+i,page_idx:i-1})),f))})){
   await mkdir(path.dirname(path.join(folder,file)),{recursive:true});await writeFile(path.join(folder,file),value);
  }
  child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:dir,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
  for(let i=0;i<150&&!log.includes('http://');i++)await sleep(30);
  const base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(base,log);
  const api=async(url,body)=>{const r=await fetch(base+'/api/projects/'+id+url,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {ok:r.ok,data:await r.json()};};

  const ai=(await api('')).data.files[0].aiParse;
  assert.deepEqual([ai.incomplete,ai.hints,ai.notes,ai.doubtVersion],[1,3,[FONT],DOUBT_VERSION],'recounted from the saved checkpoint');
  assert.equal(await readFile(path.join(folder,'Parsed/deck/ppt_task.json'),'utf8'),stored,'the parse result itself is untouched');

  const reader=(await api('/reader?source=deck')).data;
  assert.deepEqual(reader.notes,[],'a PDF is drawn exactly, so the font note of the approximate drawing is not shown');
  assert.deepEqual(reader.pages.map(pg=>(pg.hints||[]).length),[0,1,1,1]);
  const hint='第二行小字“Bhabha 1994”看不清';
  assert.equal((await api('/hint-check',{sourceId:'deck',page:2,hint:'不存在的提示'})).ok,false,'only an existing hint can be checked');
  const checked=await api('/hint-check',{sourceId:'deck',page:2,hint,checked:true});
  assert(checked.ok,JSON.stringify(checked.data));assert.equal(checked.data.hints,2);
  assert.deepEqual((await api('/reader?source=deck')).data.pages[1].hints,[{text:hint,checked:true}]);
  assert.equal((await api('/hint-check',{sourceId:'deck',page:2,hint,checked:false})).data.hints,3,'undo');

  // The interface: plain counts in the overview, hints under the page in the reader.
  try{await browserExecutable();}catch{t.diagnostic('browser unavailable; interface not checked');return;}
  ui=await launchRenderer(base,{});
  await openApp(ui,'/w/'+id+'/overview',{width:1400,height:900});
  await waitText(ui,'Slides.pdf','main');
  await ui.evaluate("document.querySelector('main details.details')?.setAttribute('open','');true");
  const details=await waitFor(ui,"document.querySelector('main details.details')?.innerText");
  assert.match(details,/1 页未能识别/);assert.match(details,/3 页有解析提示/);assert.doesNotMatch(details,/本机缺少课件字体/,'a PDF is drawn exactly: no font note');
  assert.match(details,/整课检查已完成 · 2 条修改建议未通过核对，没有采用/);
  assert.doesNotMatch(details,/疑点|待处理/);
  await go(ui,'/w/'+id+'/read/ppt/deck/p/2');
  await waitFor(ui,"[...document.querySelectorAll('section[data-page=\"2\"] details.hints summary')].some(s=>s.textContent.includes('解析提示 1 条'))",{label:'page 2 shows its hint'});
  assert(await ui.evaluate("!!document.querySelector('section[data-page=\"2\"] .notes-col details.hints')"),'the hints sit in the analysis column of the page');
  assert.equal(await ui.evaluate("document.querySelector('section[data-page=\"1\"] details.hints')"),null,'no hint box on a page whose only doubt was the font warning');
  await ui.evaluate("document.querySelector('section[data-page=\"2\"] details.hints').open=true;true");
  await click(ui,'已核对','section[data-page="2"] button');
  await waitFor(ui,"document.querySelector('section[data-page=\"2\"] details.hints summary')?.textContent.includes('已全部核对')",{label:'hint checked'});
  assert.equal((await api('')).data.files[0].aiParse.hints,2);
 }finally{
  await ui?.close();child?.kill();
  if(child)await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));
  await rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:50});
 }
});

test('doubt rules from skills/doubt_rules.md reach the model; editing them keeps finished pages',async()=>{
 const {aiMaterialService}=await import('../lib/ai-material.mjs');
 const {serialWriter}=await import('../lib/concurrency.mjs');
 const {cp}=await import('node:fs/promises');
 const repo=path.resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
 const root=await mkdtemp(path.join(os.tmpdir(),'classroom-rules-root-')),dir=await mkdtemp(path.join(os.tmpdir(),'classroom-rules-'));
 try{
  await cp(path.join(repo,'skills'),path.join(root,'skills'),{recursive:true});
  await mkdir(path.join(dir,'Source'));await writeFile(path.join(dir,'Source','r.pdf'),'PDF');
  const p={id:'Week_R',revision:0,materialRevision:0,files:[{id:'r',name:'r.pdf',stored:'r.pdf',role:'reading'}]},write=serialWriter(),systems=[];
  const page={printedPage:null,status:'complete',blocks:[{kind:'body',text:'Original text'}],uncertainties:[]};
  const service=aiMaterialService({root,getClass:async()=>structuredClone(p),dirFor:()=>dir,mutate:async(id,fn)=>write(()=>{fn(p);}),previews:{status:async()=>({status:'missing'})},
   render:async()=>({open:async()=>({pages:2}),page:async i=>({image:'data:image/png;base64,YQ==',nativeText:'page '+i,warnings:[],speakerNotes:'',hidden:false}),close:async()=>{}}),
   call:async(settings,system)=>{systems.push(system);return JSON.stringify(page);}});
  const s={baseUrl:'http://local/v1',apiKey:'secret',model:'vision',maxOutputTokens:8000,parseConcurrency:1};
  await (await service.start(p.id,'r',s,{origin:'http://local'})).done;
  assert.equal(systems.length,2);
  assert(systems.every(t=>t.includes('uncertainties lists only concrete problems')),'the rules are appended');
  assert(systems.every(t=>!t.includes('可编辑：只规定')),'the editing note in the rules file is not sent');
  await writeFile(path.join(root,'skills','doubt_rules.md'),'Changed rules for doubts.');
  await (await service.start(p.id,'r',s,{origin:'http://local'})).done;
  assert.equal(systems.length,2,'changing the doubt rules does not re-parse finished pages');
 }finally{await rm(root,{recursive:true,force:true});await rm(dir,{recursive:true,force:true});}
});
