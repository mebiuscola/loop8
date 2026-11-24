import {spawn} from 'node:child_process';
import {access,mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export async function browserExecutable(configured=''){
 const candidates=[configured||process.env.CLASSROOM_BROWSER_PATH,...['ProgramFiles(x86)','ProgramFiles','LOCALAPPDATA'].flatMap(k=>process.env[k]?[path.join(process.env[k],'Microsoft/Edge/Application/msedge.exe'),path.join(process.env[k],'Google/Chrome/Application/chrome.exe')]:[])].filter(Boolean);
 for(const file of candidates)try{await access(file);return file;}catch{}
 throw Error('未找到 Edge / Chrome。请在设置中填写浏览器程序路径；也可以继续导入外部解析 JSON。');
}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
// CDP uses Node's built-in WebSocket. A private headless profile never touches
// the user's browser profile, tabs, sign-ins or extensions.
export async function launchRenderer(baseUrl,settings={},signal){
 const executable=await browserExecutable(settings.browserPath),profile=await mkdtemp(path.join(os.tmpdir(),'classroom-render-'));
 let child,ws,seq=0,sessionId,closed=false;const pending=new Map();
 async function close(){if(closed)return;closed=true;for(const v of pending.values())v.reject(Error('页面渲染已结束'));pending.clear();ws?.close();if(child&&child.exitCode===null){child.kill();await Promise.race([new Promise(r=>child.once('exit',r)),delay(2000)]);}await rm(profile,{recursive:true,force:true}).catch(()=>{});}
 const abort=()=>{void close();};signal?.addEventListener('abort',abort,{once:true});
 try{
  signal?.throwIfAborted();
  // Windows may pass the launcher's application-health compatibility shim to
  // Chromium, which then exits successfully without starting headless/CDP.
  // Remove only that shim on our private child; do not change system settings.
  const env={...process.env};if(env.__COMPAT_LAYER==='DetectorsAppHealth')delete env.__COMPAT_LAYER;
  child=spawn(executable,['--headless=new','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--disable-sync','--hide-scrollbars','about:blank'],{env,windowsHide:true,shell:false,stdio:'ignore'});
  let launchError;child.on('error',e=>{launchError=e;});let info;
  for(let i=0;i<150;i++){signal?.throwIfAborted();if(launchError)throw Error('无法启动浏览器：'+launchError.message);if(child.exitCode!==null)throw Error('独立渲染浏览器提前退出，请检查浏览器路径。');try{info=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);break;}catch{}await delay(100);}
  if(!info)throw Error('浏览器渲染启动超时；请检查 Edge / Chrome 是否可以运行。');
  ws=new WebSocket('ws://127.0.0.1:'+info[0]+info[1]);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',()=>reject(Error('无法连接本机渲染浏览器')),{once:true});});
  ws.addEventListener('message',event=>{const data=JSON.parse(event.data);const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.error?p.reject(Error(data.error.message)):p.resolve(data.result);});
  ws.addEventListener('close',()=>{for(const p of pending.values())p.reject(Error('渲染浏览器连接已断开'));pending.clear();});
  const call=(method,params={},session=true)=>new Promise((resolve,reject)=>{signal?.throwIfAborted();if(closed)return reject(Error('渲染任务已停止'));const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('页面渲染等待超时'));},120000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params,...(session&&sessionId?{sessionId}:{})}));});
  const {targetId}=await call('Target.createTarget',{url:'about:blank'},false);({sessionId}=await call('Target.attachToTarget',{targetId,flatten:true},false));
  await call('Emulation.setDeviceMetricsOverride',{width:1600,height:2400,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:baseUrl+'/parse-render.html'});
  async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
  let ready=false;for(let i=0;i<100;i++){if(await evaluate('!!window.materialRenderer')){ready=true;break;}await delay(100);}if(!ready)throw Error('本机渲染页面未能加载。');
  return {evaluate,async screenshot(width=1440,height=1000){await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});const r=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});return Buffer.from(r.data,'base64');},async open(config){return evaluate('window.materialRenderer.open('+JSON.stringify(config)+')');},async modelImage(image){return evaluate('window.materialRenderer.modelImage('+JSON.stringify(image)+')');},async page(index){
   let info=await evaluate('window.materialRenderer.page('+index+')');if(info.image||info.external)return info;
   const pixelRatio=info.pixelRatio||1;
   await call('Emulation.setDeviceMetricsOverride',{width:Math.ceil(info.width),height:Math.ceil(info.height),deviceScaleFactor:pixelRatio,mobile:false});
   // Recheck geometry after the viewport/physical-pixel ratio changes. Layout
   // stays in native CSS pixels; no enlarged CSS transform is used for export.
   info=await evaluate('window.materialRenderer.page('+index+')');
   if(info.integrity?.geometry?.complete===false)throw Error('页面完整性检查失败，未保存截图。');
   const r=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:info.width,height:info.height,scale:1}});
   const png=Buffer.from(r.data,'base64'),pixelWidth=png.readUInt32BE(16),pixelHeight=png.readUInt32BE(20);
   if(Math.abs(pixelWidth-info.width*pixelRatio)>2||Math.abs(pixelHeight-info.height*pixelRatio)>2)throw Error('截图像素尺寸与完整页面不符，未保存。');
   return {...info,capture:{cssWidth:info.width,cssHeight:info.height,pixelWidth,pixelHeight,pixelRatio},image:'data:image/png;base64,'+r.data};
  },async close(){signal?.removeEventListener('abort',abort);await close();}};
 }catch(e){signal?.removeEventListener('abort',abort);await close();throw e;}
}
