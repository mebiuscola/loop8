import test from 'node:test';
import assert from 'node:assert/strict';
import {compactCoursewareCitations,compactCoursewareGuide} from '../lib/courseware-citations.mjs';

const id='820d8d0a-01e6-4469-94ac-6728b88b7b60';
const files=[{id,name:'Hogarth Introduction_25_10_17_11_45_49.pdf'}];
test('courseware evidence and saved explanations show source names and real pages without UUIDs',()=>{
 const long=`[Source ${id} | Hogarth Introduction_25_10_17_11_45_49.pdf | Block ${id}:b17 | Reading page 3]`;
 assert.equal(compactCoursewareCitations(long,files),'〔Hogarth Introduction · 第 3 页〕');
 assert.equal(compactCoursewareCitations(`[Source ${id}:b112-b114 | Reading page 22-23]`,files),'〔Hogarth Introduction · 第 22-23 页〕');
 assert.equal(compactCoursewareCitations(`[Block ${id}:b28]`,files),'〔Hogarth Introduction〕');
 assert.equal(compactCoursewareCitations(`[Source ${id} | Reading page unavailable]`),'〔来源待核对 · 页码未提供〕');
 assert.equal(compactCoursewareCitations('[Smith, 2020, p. 7] [R1] [Source criticism]',files),'[Smith, 2020, p. 7] [R1] [Source criticism]');
 const shortened=compactCoursewareCitations(long,files);assert.equal(compactCoursewareCitations(shortened,files),shortened);
});
test('existing guide downloads compact explanations while preserving original slide and translated text',()=>{
 const marker=`[Source ${id}:b17 | Reading page 3]`,guide=`# Week\n\n## Slides · 第 1 页\n\n### 正文双语翻译\n\n${marker}\n\n### 本页细读\n\nAnalysis ${marker}\n\n## Theoretical context\n\nMore ${marker}\n\n### Critical distinction\n\nDetail ${marker}\n\n## Slides · 第 2 页\n\n### 正文双语翻译\n\n${marker}`;
 const result=compactCoursewareGuide(guide,files);
 assert(result.includes('Analysis 〔Hogarth Introduction · 第 3 页〕'));
 assert(result.includes('More 〔Hogarth Introduction · 第 3 页〕'));
 assert(result.includes('Detail 〔Hogarth Introduction · 第 3 页〕'));
 assert.equal(result.split(marker).length-1,2);
});
