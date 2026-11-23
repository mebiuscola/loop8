import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {browserExecutable,launchRenderer} from '../lib/browser-render.mjs';
import {testPdf} from '../lib/diagnostics.mjs';
import {listenSafe} from '../lib/ports.mjs';

test('legacy PDF.js renders with missing modern APIs in page and real Worker', async t => {
  try { await browserExecutable(); } catch { t.skip('Chrome/Edge unavailable'); return; }
  const remove = `delete Map.prototype.getOrInsertComputed; delete Uint8Array.prototype.toHex; delete Uint8Array.prototype.toBase64; delete Uint8Array.fromBase64; delete Promise.try;`;
  const server = createServer(async (req,res) => {
    try {
      if(req.url === '/' || req.url.startsWith('/parse-render')) {res.setHeader('Content-Type','text/html');res.end('<canvas id="pdf"></canvas><script>window.materialRenderer={};</script>');return;}
      if(req.url === '/worker.mjs') {res.setHeader('Content-Type','text/javascript');res.end(remove + `await import('/pdf.worker.mjs');`);return;}
      const name = req.url.slice(1);
      if(!['pdf.mjs','pdf.worker.mjs'].includes(name)){res.writeHead(404);res.end();return;}
      res.setHeader('Content-Type','text/javascript');res.end(await readFile(new URL('../public/vendor/pdfjs/'+name, import.meta.url)));
    }catch(e){res.writeHead(500);res.end(e.message);}
  });
  await listenSafe(server);let ui;
  try {
    ui=await launchRenderer('http://127.0.0.1:'+server.address().port,{});
    const result=await ui.evaluate(`(async()=>{
      ${remove}
      const lib=await import('/pdf.mjs');lib.GlobalWorkerOptions.workerSrc='/worker.mjs';
      const task=lib.getDocument({data:new Uint8Array(${JSON.stringify([...testPdf()])}),isEvalSupported:false});
      const doc=await task.promise,page=await doc.getPage(1),text=await page.getTextContent();
      const canvas=document.querySelector('#pdf'),view=page.getViewport({scale:1});canvas.width=view.width;canvas.height=view.height;
      await page.render({canvasContext:canvas.getContext('2d'),viewport:view}).promise;
      const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      const result={realWorker:task._worker?.port instanceof Worker,pages:doc.numPages,fingerprint:doc.fingerprints[0],text:text.items.map(x=>x.str).join(' '),ink:pixels.some((v,i)=>i%4!==3&&v<200)};
      await task.destroy();return result;
    })()`);
    assert.equal(result.realWorker,true);assert.equal(result.pages,1);assert.match(result.fingerprint,/^[a-f0-9]{32}$/);assert.match(result.text,/Classroom connection test/);assert(result.ink);
  }finally{await ui?.close();await new Promise(resolve=>server.close(resolve));}
});
