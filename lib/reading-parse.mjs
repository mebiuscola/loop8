// Parses a Reading / BB PDF into the standard block document. The PDF's own text layer is tried
// first (no upload, no quota, exact text); scanned or garbled files, and an explicit request,
// go to MinerU as before.
import {readFile} from 'node:fs/promises';
import {mineruCloud} from './mineru-cloud.mjs';
import {readTextLayer,textLayerSufficient,textLayerDocument} from './pdf-text.mjs';

/** 'text-layer' or 'mineru': where a parsed document's text came from. */
export function parseSourceOf(doc){return doc?.provenance==='pdf-text-layer'?'text-layer':'mineru';}

/**
 * @param runtime  passed on to MinerU (archivePath, uploadGate, signal) plus
 *                 `force: 'mineru'` to skip the text layer.
 */
export async function parseReadingPdf(settings,input,source,onProgress=async()=>{},{force,...runtime}={}){
 if(force!=='mineru'&&/\.pdf$/i.test(source.name||input)){
  await onProgress('读取 PDF 自带文字');
  let pages=null;
  try{pages=await readTextLayer(await readFile(input));}catch{/* not readable by pdf.js: MinerU decides */}
  runtime.signal?.throwIfAborted();
  if(pages&&textLayerSufficient(pages))return textLayerDocument(pages,source);
  await onProgress('没有可用的文字层（扫描件或文字损坏），交给 MinerU');
 }
 return mineruCloud(settings,input,onProgress,{source,...runtime});
}
