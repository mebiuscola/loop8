import test from 'node:test';
import assert from 'node:assert/strict';
import {salvageTranslations,translateBatch} from '../lib/translation-batch.mjs';

test('the complete items of a cut-off batch reply are kept',()=>{
 const reply='{"translations":[{"id":"1","chinese":"他说：\\"世界文学\\"。{不是括号}"},{"id":"2","chinese":"第二段"},{"id":"3","chinese":"第三段被截';
 assert.deepEqual(salvageTranslations(reply),[{id:'1',chinese:'他说："世界文学"。{不是括号}'},{id:'2',chinese:'第二段'}]);
 assert.deepEqual(salvageTranslations('not json at all'),[]);
});

test('after a cut-off reply only the missing paragraphs are sent again',async()=>{
 const items=['1','2','3','4'].map(id=>({id,english:'Paragraph '+id}));
 const asked=[],saved=[];
 await translateBatch(items,{
  request:async batch=>{asked.push(batch.map(i=>i.id));
   return asked.length===1?'{"translations":[{"id":"1","chinese":"一"},{"id":"2","chinese":"二"},{"id":"3","chin'
    :JSON.stringify({translations:batch.map(i=>({id:i.id,chinese:'译'+i.id}))});},
  single:async item=>{asked.push([item.id]);return '译'+item.id;},
  save:async(item,chinese)=>saved.push([item.id,chinese]),
 });
 assert.deepEqual(asked,[['1','2','3','4'],['3','4']]);
 assert.deepEqual(saved,[['1','一'],['2','二'],['3','译3'],['4','译4']]);
});
