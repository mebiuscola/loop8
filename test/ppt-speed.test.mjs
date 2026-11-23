import test from 'node:test';
import assert from 'node:assert/strict';
import {completePptPage} from '../lib/ppt-response.mjs';

const api=(model)=>({provider:'api',baseUrl:'https://api.example.com/v1',apiKey:'k',model,contextChars:180000,maxOutputTokens:8000,visionEnabled:true});

// With translation assigned to another API model, each text block used to be its own request
// (12 requests for a page of 10 blocks). Now blocks go in batches of up to five, like Antigravity.
test('a page translated by a separate API model sends its blocks in batches, not one request each',async()=>{
 const calls={recognition:0,translation:[],explanation:0};
 const blocks=Array.from({length:6},(_,i)=>({original:`Line ${i+1} of the slide about comparison.`,role:'body',chinese:null}));
 const call=async(provider,prompt,user)=>{
  const value=JSON.parse(user);
  if(Array.isArray(value.items)){calls.translation.push(value.items.length);return JSON.stringify({translations:value.items.map(i=>({id:i.id,chinese:'译文 '+i.id}))});}
  if(typeof value.english==='string'){calls.translation.push(1);return JSON.stringify({chinese:'译文 single'});}
  if(value.expected?.closeReading){calls.explanation++;return JSON.stringify({pageType:'concept',closeReading:'本页讨论比较。'});}
  calls.recognition++;return JSON.stringify({title:'Comparison',status:'complete',blocks,visuals:[],explanation:'',uncertainties:[]});
 };
 const settings={...api('vision-model'),taskModels:{translation:api('translation-model'),explanation:api('vision-model')}};
 const prompts={recognition:'recognise',learning:'learn',translation:'translate',explanation:'explain',repair:'repair'};
 const page=await completePptPage({state:{},input:{page:1,source:'Deck.pptx',nativeText:blocks.map(b=>b.original).join('\n')},source:{fileName:'Deck.pptx',sha256:'a'.repeat(64),format:'pptx'},
  settings,prompts,call,options:{signal:new AbortController().signal,images:['data:image/png;base64,YQ==']},persist:async()=>{}});
 assert.equal(calls.recognition,1);
 assert.deepEqual(calls.translation,[5,1],'six blocks in two requests');
 assert.equal(calls.explanation,1);
 assert.equal(page.learning.paragraphs.length,6);
 assert(page.learning.paragraphs.every(p=>p.chinese.startsWith('译文')));
});

test('a page from the smaller image is redone with the full image only for what the image could cause',async()=>{
 const {needsFullImage}=await import('../lib/doubts.mjs');
 const page=(status,extra={})=>({page:1,inspection:{status,fullPageViewed:true,textExtracted:true},uncertainties:[],...extra});
 assert.equal(needsFullImage(page('partial',{uncertainties:['渲染检查发现 1 个文字区域可能裁切或超出页面。']}),0),false,'a program check alone: no redo');
 assert.equal(needsFullImage(page('complete'),0),false);
 assert.equal(needsFullImage(page('partial'),1),true,'the model could not read something: redo with the full image');
 assert.equal(needsFullImage(page('unavailable'),0),true,'the page could not be read: redo');
});
