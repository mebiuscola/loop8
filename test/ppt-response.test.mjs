import test from 'node:test';
import assert from 'node:assert/strict';
import {PPT_CONTENT_SCHEMA,normalizePptDraft,draftToPage,completePptPage,pendingPptParts} from '../lib/ppt-response.mjs';
const source={fileName:'slides.pptx',format:'pptx',sha256:'a'.repeat(64)},input={page:2,hidden:false,speakerNotes:'file note',nativeText:'Main text'},settings={model:'primary',apiKey:'private-key',contextChars:100000};
const prompts={learning:'learn',recognition:'recognize',translation:'translate',explanation:'explain',repair:'repair'};
const content=()=>({title:'Page',blocks:[{original:'Main text',chinese:'正文',role:'body'}],visuals:[{description:'Two boxes linked by an arrow'}],explanation:'箭头说明连接关系，不能仅据此证明因果。',uncertainties:[]});
const options={images:['data:image/png;base64,YQ=='],json:true,signal:new AbortController().signal};

test('content contract has paired blocks; missing/numeric visual IDs and legacy string indexes normalize without losing content',()=>{
 assert(!JSON.stringify(PPT_CONTENT_SCHEMA).includes('originalIndex'));assert(!JSON.stringify(PPT_CONTENT_SCHEMA).includes('"id"'));
 const legacy={originalText:[{text:'Main text',method:'native',role:'body'},{text:'Footer',role:'footer'}],visualObservations:[{description:'Image',kind:'image',id:9}],learning:{paragraphs:[{originalIndex:'0',chinese:'正文'}],closeReading:'解释这页。'},uncertainties:[]};
 const draft=normalizePptDraft(legacy),page=draftToPage(draft,source,input);assert.equal(page.visualObservations[0].id,'figure-1');assert.equal(page.originalText[1].text,'Footer');assert.equal(page.learning.paragraphs.length,1);assert.equal(page.learning.paragraphs[0].chinese,'正文');assert.equal(page.page,2);
 delete legacy.learning.paragraphs[0].originalIndex;assert.deepEqual(pendingPptParts(normalizePptDraft(legacy)),['翻译']);
 assert.throws(()=>normalizePptDraft({blocks:[{chinese:'没有原文'}]}),/原文/);assert.throws(()=>normalizePptDraft({blocks:[],visuals:[],explanation:'generic'}),/非空白/);
});

test('malformed JSON is repaired with the real error, without a new image call, and the original response is retained/redacted',async()=>{
 const state={},calls=[];const malformed='{"blocks":[{"original":"A "quote" private-key"}]}';
 const call=async(s,prompt,user,opts)=>{assert.equal(s.model,'primary');calls.push({prompt,user:JSON.parse(user),images:opts.images});return prompt==='repair'?JSON.stringify(content()):malformed;};
 const result=await completePptPage({state,input,source,settings,prompts,call,options,persist:async()=>{}});assert.equal(calls.length,2);assert(calls[0].images);assert.equal(calls[1].images,undefined);assert(calls[1].user.error);assert.equal(calls[1].user.raw,malformed);assert(!state.diagnostic.response.includes('private-key'));assert(state.diagnostic.response.includes('[已隐藏密钥]'));assert.equal(result.learning.paragraphs[0].chinese,'正文');
});

test('missing translation and explanation resume independently after a transport failure without repeating recognition',async()=>{
 const state={},calls=[];let fail=true;
 const call=async(s,prompt,user,opts)=>{calls.push(prompt.startsWith('learn')?'learn':prompt);if(prompt.startsWith('learn')){const data=content();data.blocks[0].chinese=null;data.explanation='';return JSON.stringify(data);}if(prompt==='translate'){assert.equal(opts.images,undefined);return '{"chinese":"保存的中文"}';}if(fail){const e=Error('temporary 503');e.httpStatus=503;throw e;}return '{"closeReading":"补全后的具体解释","pageType":"concept"}';};
 const args={state,input,source,settings,prompts,call,options,persist:async()=>{}};await assert.rejects(()=>completePptPage(args),/503/);assert.equal(state.draft.blocks[0].chinese,'保存的中文');assert.deepEqual(pendingPptParts(state.draft),['解读']);fail=false;const result=await completePptPage(args);assert.deepEqual(calls,['learn','translate','explain','explain']);assert.equal(result.learning.closeReading,'补全后的具体解释');
});

test('a complete paired response makes one request, preserves tables/formulas and assigns internal metadata in program',async()=>{
 let calls=0;const data=content();data.blocks.push({original:'|x|y|\n|1|2|',chinese:'|x|y|\n|1|2|',role:'table'});data.blocks.push({original:'E=mc^2',chinese:'E=mc^2',role:'formula'});
 const page=await completePptPage({state:{},input,source,settings,prompts,call:async()=>{calls++;return JSON.stringify(data);},options,persist:async()=>{}});assert.equal(calls,1);assert.equal(page.originalText[1].text,data.blocks[1].original);assert.equal(page.originalText[2].text,'E=mc^2');assert.equal(page.page,2);assert.equal(page.visualObservations[0].id,'figure-1');
});
