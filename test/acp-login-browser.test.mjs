import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {browserExecutable,launchRenderer} from '../lib/browser-render.mjs';
async function until(fn){for(let i=0;i<300;i++){const value=await fn();if(value)return value;await sleep(40);}throw Error('Login browser state timed out');}
test('Google sign-in link survives panel remounts, repeated clicks do not restart login, auth success is independent of model discovery',async t=>{
 try{await browserExecutable();}catch{return t.skip('Requires Edge / Chrome');}
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-login-ui-')),exe=path.join(dir,'agy_acp_server.exe'),hook=path.join(dir,'hook.mjs'),fixture=fileURLToPath(new URL('./fixtures/mock-acp.mjs',import.meta.url)).replaceAll('\\','/');await writeFile(exe,'fixture');await writeFile(path.join(dir,'localharness_external.exe'),'fixture');
 await writeFile(hook,`import {registerHooks} from 'node:module';registerHooks({load(url,c,next){const r=next(url,c);if(!url.endsWith('/lib/acp-client.mjs'))return r;return {...r,source:String(r.source).replace('export const acpRuntime=createAcpRuntime();','export const acpRuntime=createAcpRuntime({timeouts:{initialize:5000,authenticate:12000,session:200},launch:(_exe,_args,options)=>spawn(process.execPath,${JSON.stringify([fixture])},options)});')};}});`);
 const child=spawn(process.execPath,['--import',pathToFileURL(hook).href,'server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:dir,PORT:'0',MOCK_ACP_AUTH_URL:'1',MOCK_ACP_AUTH_DELAY:'4000',MOCK_ACP_HANG:'session'},windowsHide:true,stdio:['ignore','pipe','pipe']});let log='',ui;child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 try{
  const base=await until(()=>log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]);const post=async(url,b)=>{const r=await fetch(base+url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});assert(r.ok,await r.clone().text());return r.json();};
  await post('/api/settings',{modelProfiles:[{id:'login-test',provider:'antigravity-acp',name:'Google 登录',model:'',acpEntry:'standalone',acpExecutable:exe}],modelRoutes:{}});
  ui=await launchRenderer(base,{});await ui.evaluate("setTimeout(()=>location.href='/legacy/',0);true");await until(()=>ui.evaluate("!!document.querySelector('.settings-menu')"));await ui.evaluate("document.querySelector('#settings-open').click();true");await until(()=>ui.evaluate("!!document.querySelector('[data-profile=login-test]')"));
  assert(await ui.evaluate("[...document.querySelectorAll('.settings-test-actions button')].some(b=>b.textContent==='退出登录')"));
  assert.equal(await ui.evaluate("(async()=>{const r=await fetch('/api/settings/acp-logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return r.status;})()"),400);
  await ui.evaluate("window.confirm=()=>true;[...document.querySelectorAll('.settings-test-actions button')].find(b=>b.textContent==='退出登录').click();true");
  await until(()=>ui.evaluate("document.body.innerText.includes('已退出 Antigravity 个人账号')"));
  await ui.evaluate("[...document.querySelectorAll('.settings-test-actions button')].find(b=>b.textContent==='个人账号登录').click();true");await until(()=>ui.evaluate("!!document.querySelector('.acp-login-actions a')"));
  const href=await ui.evaluate("document.querySelector('.acp-login-actions a').href");assert(href.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'));
  assert(await ui.evaluate("document.querySelector('.acp-progress').textContent.includes('秒')"));
  await ui.evaluate("document.querySelector('[data-settings-section=mineru]').click();document.querySelector('[data-settings-section=models]').click();true");
  assert.equal(await ui.evaluate("document.querySelector('.acp-login-actions a').href"),href);assert(await ui.evaluate("[...document.querySelectorAll('.settings-test-actions button')].every(b=>b.disabled)"));
  if(process.env.CLASSROOM_LOGIN_EVIDENCE){await mkdir(process.env.CLASSROOM_LOGIN_EVIDENCE,{recursive:true});await writeFile(path.join(process.env.CLASSROOM_LOGIN_EVIDENCE,'Google-login.png'),await ui.screenshot(1500,1000));}
  await until(()=>ui.evaluate("document.querySelector('.profile-test-status')?.textContent.includes('认证已完成')"));assert.equal(await ui.evaluate("document.querySelector('.acp-login-actions a')===null"),true);
  await ui.evaluate("[...document.querySelectorAll('.settings-test-actions button')].find(b=>b.textContent==='读取模型列表').click();true");
  await until(()=>ui.evaluate("document.querySelector('.profile-test-status')?.textContent.includes('读取模型列表超时')"));assert(await ui.evaluate("document.querySelector('.profile-test-status').textContent.includes('无需因此重复登录')"));
  await ui.evaluate("[...document.querySelectorAll('.settings-test-actions button')].find(b=>b.textContent==='个人账号登录').click();true");await until(()=>ui.evaluate("!!document.querySelector('.acp-login-actions a')"));await ui.evaluate("document.querySelector('.settings-testing-bar button').click();true");await until(()=>ui.evaluate("document.querySelector('.settings-testing-bar').hidden"));assert.equal(await ui.evaluate("document.querySelector('.acp-login-actions a')===null"),true);
 }finally{await ui?.close();child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));await rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:50});}
});
