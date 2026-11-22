// The new frontend's Ask answer formatter (web/src/lib/markdown.ts). Node 24 strips the types itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import {blocks,inline} from '../web/src/lib/markdown.ts';

const id='4f7fb4ff-f545-494a-9d1f-3cc7dd356a2e';

test('class evidence markers become class links, with or without a time', () => {
 assert.deepEqual(inline(`见 [Session ${id} | Lecture | Lecture 1 | SRT 00:51:14,470 → 00:51:40,100 | cues 3–5 | Lecturer] 一段`),[
  {kind:'text',text:'见 '},{kind:'class',sessionId:id,ms:3074470},{kind:'text',text:' 一段'}]);
 assert.deepEqual(inline(`[Session ${id} | Lecture | Lecture 1]`),[{kind:'class',sessionId:id,ms:null}]);
});

test('only reading-reference links become links; other brackets and HTML stay text', () => {
 assert.deepEqual(inline('[原文](/api/projects/W1/reading-reference?ref=r-abcdefghijkl)'),[{kind:'reference',text:'原文',href:'/api/projects/W1/reading-reference?ref=r-abcdefghijkl'}]);
 assert.deepEqual(inline('[x](https://evil.example/)'),[{kind:'text',text:'[x](https://evil.example/)'}]);
 assert.deepEqual(inline('<img src=x onerror=alert(1)> **粗体** `code`'),[
  {kind:'text',text:'<img src=x onerror=alert(1)> '},{kind:'bold',text:'粗体'},{kind:'text',text:' '},{kind:'code',text:'code'}]);
});

test('headings, list items, code and tables are recognised', () => {
 const out=blocks('### 标题\n- 一\n1. 二\n正文\n\n| A | B |\n|---|:-:|\n| 1 | **2** |\n\n```\nraw *x*\n```');
 assert.deepEqual(out.map(b=>b.kind),['heading','item','item','paragraph','table','code']);
 assert.equal(out[4].rows[0][1][0].kind,'bold');
 assert.equal(out[5].text,'raw *x*');
});

test('pipe lines without a separator row stay text', () => {
 assert.deepEqual(blocks('| not | a table |').map(b=>b.kind),['paragraph']);
});
