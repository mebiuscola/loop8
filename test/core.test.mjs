import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSrt,cueBatches,validateSegments,chunks,safeName} from '../lib/core.mjs';
test('SRT: multiline, BOM, timestamps and ambiguous speakers survive',()=>{
 const cues=parseSrt('\uFEFF1\r\n00:00:01,000 --> 00:00:03,000\r\nStudent: why?\r\nAnother line\r\n\r\n2\r\n00:00:03,100 --> 00:00:04,000\r\nPerhaps.');
 assert.equal(cues[0].text,'Student: why?\nAnother line');assert.equal(cues[1].start,'00:00:03,100');assert.deepEqual(cueBatches(cues,5).flat().map(c=>c.id),[1,2]);
 assert.throws(()=>parseSrt('invalid subtitle'));
});
test('coverage rejects omitted, duplicated, reordered and invented cues',()=>{
 const cues=[{id:1},{id:2},{id:3}],segment=ids=>[{speaker:'Student',english:'A meaningful discussion.',cueIds:ids}];
 assert.doesNotThrow(()=>validateSegments(segment([1,2,3]),cues));for(const ids of [[1,3],[1,2,2,3],[3,2,1],[1,2,3,4]])assert.throws(()=>validateSegments(segment(ids),cues));
});
test('chunking retains long unbroken text and filename cannot traverse',()=>{
 const input='a'.repeat(40000);assert.equal(chunks(input).join('').replace(/\n/g,''),input);assert(!safeName('../../file.pdf').includes('/'));
});
