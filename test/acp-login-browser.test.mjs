import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {browserExecutable,launchRenderer} from '../lib/browser-render.mjs';
import {openApp,waitFor,waitText,click,text} from './helpers/app.mjs';
async function until(fn){for(let i=0;i<300;i++){const value=await fn();if(value)return value;await sleep(40);}throw Error('Login browser state timed out');}
test('Google sign-in link survives settings page switches, buttons wait for the sign-in, auth success is independent of model discovery, sign-in can be stopped',async t=>{
 try{await browserExecutable();}catch{return t.skip('Requires Edge / Chrome');}
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-login-ui-')),exe=path.join(dir,'agy_acp_server.exe'),hook=path.join(dir,'hook.mjs'),fixture=fileURLToPath(new URL('./fixtures/mock-acp.mjs',import.meta.url)).replaceAll('\\','/');await writeFile(exe,'fixture');await writeFile(path.join(dir,'localharness_external.exe'),'fixture');
 await writeFile(hook,`import {registerHooks} from 'node:module';registerHooks({load(url,c,next){const r=next(url,c);if(!url.endsWith('/lib/acp-client.mjs'))return r;return {...r,source:String(r.source).replace('export const acpRuntime=createAcpRuntime();','export const acpRuntime=createAcpRuntime({timeouts:{initialize:5000,authenticate:12000,session:200},launch:(_exe,_args,options)=>spawn(process.execPath,${JSON.stringify([fixture])},options)});')};}});`);
 const child=spawn(process.execPath,['--import',pathToFileURL(hook).href,'server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:dir,PORT:'0',MOCK_ACP_AUTH_URL:'1',MOCK_ACP_AUTH_DELAY:'4000',MOCK_ACP_HANG:'session'},windowsHide:true,stdio:['ignore','pipe','pipe']});let log='',ui;child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 try{
  const base=await until(()=>log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]);const post=async(url,b)=>{const r=await fetch(base+url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});assert(r.ok,await r.clone().text());return r.json();};
  await post('/api/settings',{modelProfiles:[{id:'login-test',provider:'antigravity-acp',name:'Google 登录',model:'',acpEntry:'standalone',acpExecutable:exe}],modelRoutes:{}});
  ui=await launchRenderer(base,{});await openApp(ui,'/settings');
  await waitText(ui,'Antigravity 账号','main');
  // The quiet check on opening cannot reach the model list here; that is not reported as signed out.
  await waitText(ui,'无法确认登录','main',{timeout:20000});
  assert.equal((await fetch(base+'/api/settings/acp-logout',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,400);
  await click(ui,'退出登录');await click(ui,'确定退出');
  await waitText(ui,'已退出 Antigravity 个人账号','main');
  await click(ui,'重新登录');
  const link="[...document.querySelectorAll('a')].find(a=>a.textContent.trim()==='打开 Google 登录页面')?.href||''";
  const href=await waitFor(ui,link,{label:'Google sign-in link'});assert(href.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'));
  // Another settings page and back: the sign-in under way and its link are still there, and nothing restarts it.
  await click(ui,'模型分配','.nav button');await click(ui,'服务与账号','.nav button');
  assert.equal(await waitFor(ui,link),href);
  assert(await ui.evaluate("[...document.querySelectorAll('main button')].filter(b=>/^(重新登录|登录并读取模型|刷新可用模型|退出登录)$/.test(b.textContent.trim())).every(b=>b.disabled)"),'sign-in and sign-out buttons wait for the sign-in under way');
  if(process.env.CLASSROOM_LOGIN_EVIDENCE){await mkdir(process.env.CLASSROOM_LOGIN_EVIDENCE,{recursive:true});await writeFile(path.join(process.env.CLASSROOM_LOGIN_EVIDENCE,'Google-login.png'),await ui.screenshot(1500,1000));await ui.screenshot(1440,960);}
  // Sign-in completes; the model list then times out, which does not mean signed out.
  await waitText(ui,'无需因此重复登录','main',{timeout:25000});
  assert.equal(await ui.evaluate(link),'');
  assert.doesNotMatch(await text(ui,'main'),/需要登录|登录已失效/);
  await click(ui,'刷新可用模型');
  await waitFor(ui,"[...document.querySelectorAll('main button')].some(b=>b.textContent.trim()==='刷新可用模型'&&!b.disabled)",{timeout:20000});
  assert.equal(await ui.evaluate(link),'','refreshing the model list never opens a sign-in');
  // A sign-in can be stopped; its link goes away.
  await click(ui,'退出登录');await click(ui,'确定退出');
  await click(ui,'重新登录');await waitFor(ui,link);
  await click(ui,'停止');
  await waitFor(ui,`!(${link})`);
  await waitText(ui,/已停止|已取消/,'main');
 }finally{await ui?.close();child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));await rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:50});}
});
