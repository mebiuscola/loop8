import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {preparePageRedo,restorePageRedo} from '../lib/ppt-cache.mjs';
import {reviewDeck} from '../lib/ppt-review.mjs';
import {localFontService} from '../lib/fonts.mjs';

const page=n=>({page:n,title:'Term',hidden:false,blank:false,originalText:[{text:'Distant\nreading',role:'body',method:'native'}],speakerNotes:'Original notes',visualObservations:[],analysis:[],uncertainties:[],inspection:{status:'complete',textExtracted:true,fullPageViewed:true},learning:{schema:'classroom.ppt-learning.v1',pageType:'concept',paragraphs:[{originalIndex:0,chinese:'远读'}],closeReading:'本页讨论文学研究的尺度。'}});
const deck=()=>({total:3,pages:[page(1),page(2),page(3)],pageDrafts:{},attempts:{},cycles:{},provenance:{0:{model:'m'},1:{model:'m'},2:{model:'m'}}});

test('a page redo opens only the chosen page and keeps its previous result aside',()=>{
 const task=deck();
 preparePageRedo(task,[2],'all');
 assert.equal(task.pages[1],null);assert.deepEqual(task.pageDrafts[1],{},'nothing reused: recognised again');
 assert(task.pages[0]&&task.pages[2],'other pages stay');
 assert.equal(task.redo.pages[1].page.page,2);
 const translation=deck();preparePageRedo(translation,[1],'translation');
 assert.equal(translation.pageDrafts[0].draft.blocks.every(b=>b.chinese===null),true,'only the translation is cleared');
 assert.equal(translation.pageDrafts[0].draft.explanation,'本页讨论文学研究的尺度。','the explanation is kept');
 const explanation=deck();preparePageRedo(explanation,[3],'explanation');
 assert.equal(explanation.pageDrafts[2].draft.explanation,'');assert(explanation.pageDrafts[2].draft.blocks.some(b=>b.chinese),'the translation is kept');
 assert.throws(()=>preparePageRedo(deck(),[4],'all'),/存在的页面/);
 assert.throws(()=>preparePageRedo(deck(),[1],'other'),/重做内容/);
});

test('a redo that fails or is stopped puts the previous page back',()=>{
 const task=deck(),before=structuredClone(task.pages[1]);
 preparePageRedo(task,[2,3],'all');
 task.pages[2]={...page(3),title:'New'};   // page 3 finished, page 2 did not
 assert.deepEqual(restorePageRedo(task),[2]);
 assert.deepEqual(task.pages[1],before);assert.equal(task.pages[2].title,'New','a finished redo is kept');
 assert.equal(task.redo,undefined);
});

test('after one page changes, the whole-deck check checks again only that page’s group',async()=>{
 const task={total:15,pages:Array.from({length:15},(_,i)=>page(i+1))},requests=[];
 const options={checkpoint:task,prompt:'review',settings:{model:'primary',contextChars:100000},persist:async()=>{},call:async(s,sys,user)=>{requests.push(JSON.parse(user));return '{"terms":[],"changes":[]}';}};
 await reviewDeck(options);assert.equal(requests.length,2,'two groups');
 task.pages[12]={...page(13),originalText:[{text:'A newly recognised slide',role:'body',method:'native'}]};
 await reviewDeck(options);
 assert.equal(requests.length,3,'one more request');assert(requests.at(-1).pages.some(p=>p.page===13));
});

test('the font list is refreshed in the background; a request never waits for a new scan once one exists',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-fonts-'));
 try{
  await mkdir(path.join(dir,'f'));await writeFile(path.join(dir,'f','not-a-font.ttf'),'x');
  t.mock.timers.enable({apis:['Date'],now:Date.now()});
  const fonts=localFontService({roots:[path.join(dir,'f')]}),bytes=Buffer.from('');
  const first=await fonts.fingerprint(bytes,false);
  t.mock.timers.tick(10*60*1000);   // the list is now old
  const started=performance.now();const again=await fonts.fingerprint(bytes,false);
  assert.equal(again,first);assert(performance.now()-started<200,'answered from the existing list');
 }finally{await rm(dir,{recursive:true,force:true});}
});
