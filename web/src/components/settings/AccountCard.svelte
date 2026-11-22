<script lang="ts">
 // An account-based service (Antigravity or ChatGPT): sign in once, then its models can be chosen anywhere.
 import {onMount} from 'svelte';
 import JobView from './JobView.svelte';
 import ModelRow from './ModelRow.svelte';
 import {api,ApiError,type ChatgptStatus} from '../../lib/api';
 import {JobRun} from '../../lib/jobs.svelte';
 import {providerOf,type AccountKind,type SettingsModel} from '../../lib/settings.svelte';

 let {kind,model}:{kind:AccountKind;model:SettingsModel}=$props();
 const acp=$derived(kind==='acp');
 // Sorted by name so the list does not reorder after a save.
 const inUse=$derived(model.profiles.filter(p=>providerOf(p)===kind&&model.saved?.modelProfiles.some(x=>x.id===p.id)).sort((a,b)=>(a.name||'').localeCompare(b.name||'')));
 const available=$derived(model.accountModels[kind]);
 const nameOf=(id:string)=>available.find(m=>m.modelId===id)?.name||id;

 // ---- Antigravity ----
 const job=new JobRun();
 let showPath=$state(false);
 // The backend signs in and lists models as two steps: "login" only authenticates
 // (reusing a valid sign-in), "inspect" opens a session and reads the model list.
 // A saved Google sign-in stays valid between visits. On opening the page we quietly
 // read the model list ("inspect" never opens a sign-in page): success means still signed in.
 type AcpStatus='unknown'|'checking'|'ok'|'needLogin'|'error';
 let acpStatus=$state<AcpStatus>('unknown'),acpProblem=$state('');
 const quiet=new JobRun();
 async function silentCheck(){
  acpStatus='checking';acpProblem='';
  try{
   const result:any=await quiet.run(()=>api.modelTest('inspect',model.accountProbe('acp')));
   if(Array.isArray(result?.models))model.setAccountModels('acp',result.models);
   acpStatus='ok';
  }catch(e){
   const m=(e as Error).message||'';
   acpStatus=/需要官方登录|登录|auth|sign.in/i.test(m)?'needLogin':'error';acpProblem=m;
  }
 }
 async function signIn(){
  try{
   if(acpStatus!=='ok')await job.run(()=>api.modelTest('login',model.accountProbe('acp')));
   const result:any=await job.run(()=>api.modelTest('inspect',model.accountProbe('acp')));
   const models=Array.isArray(result?.models)?result.models:[];
   model.setAccountModels('acp',models);acpStatus='ok';acpProblem='';
   job.state.message=models.length?'已登录，读取到 '+models.length+' 个可用模型。现在可以在"模型分配"中选择它们。':'已登录，但 Antigravity 没有返回可用模型。请稍后点"刷新可用模型"重试。';
  }catch{/* shown by JobView */}
 }
 let confirmLogout=$state(false),logoutMessage=$state('');
 async function logout(){
  confirmLogout=false;logoutMessage='正在退出…';
  try{const r=await api.acpLogout(inUse[0].id);logoutMessage=r?.message||'已退出登录。';model.setAccountModels('acp',[]);acpStatus='needLogin';}
  catch(e){logoutMessage=(e as Error).message;}
 }

 // ---- ChatGPT ----
 let status=$state<ChatgptStatus|null>(null),chatError=$state(''),authUrl=$state(''),waiting=$state(false);
 async function refresh(){try{status=await api.chatgptStatus();chatError='';}catch(e){chatError=(e as Error).message;}}
 async function chatSignIn(reconsent=false){
  chatError='';authUrl='';
  try{
   const {authorizationUrl}=await api.chatgptLogin(reconsent);
   const u=new URL(authorizationUrl);
   if(u.origin!=='https://auth.openai.com'||u.pathname!=='/api/accounts/authorize')throw new Error('授权地址无效。');
   authUrl=authorizationUrl;waiting=true;
   for(let i=0;i<120&&waiting;i++){await new Promise(r=>setTimeout(r,2500));await refresh();if(status?.connected){await readChatModels();break;}if(!status?.pending)break;}
  }catch(e){chatError=e instanceof ApiError?e.message:(e as Error).message;}
  finally{waiting=false;authUrl='';}
 }
 async function readChatModels(){try{model.setAccountModels('chatgpt',(await api.chatgptModels()).models);chatError='';}catch(e){chatError=(e as Error).message;}}
 async function disconnect(){try{await api.chatgptDisconnect();model.setAccountModels('chatgpt',[]);await refresh();}catch(e){chatError=(e as Error).message;}}
 // Only check when Antigravity has been used before, so a fresh install starts nothing.
 onMount(()=>{if(!acp)refresh();else if(model.acpExecutable&&(inUse.length||available.length))silentCheck();});
 const acpLabel=$derived(
  acpStatus==='checking'?'正在确认登录…':
  acpStatus==='ok'?'已登录 · 可用模型 '+available.length+' 个':
  acpStatus==='needLogin'?'需要登录':
  acpStatus==='error'?'无法确认登录':
  available.length?'可用模型 '+available.length+' 个':'尚未登录');
</script>

<section class="card">
 <header>
  <div>
   <h2>{acp?'Antigravity 账号':'ChatGPT 订阅'}</h2>
   <p>{acp?'用你的 Google 账号登录 Antigravity，不需要 API 密钥；用量由 Antigravity 账号计算，额度请到 Antigravity 查看。':'用你的 ChatGPT 账号授权，按订阅额度使用。'}</p>
  </div>
  {#if acp}
   <span class="state" class:ok={acpStatus==='ok'} class:warn={acpStatus==='needLogin'||acpStatus==='error'} title={acpProblem||undefined}>{acpLabel}</span>
  {:else}
   <span class="state" class:ok={status?.connected}>{status?.connected?'已连接'+(status.email?' · '+status.email:''):status?.pending||waiting?'等待授权…':'未连接'}</span>
  {/if}
 </header>

 {#if acp}
  <div class="line">
   <span class="muted">程序：{model.acpExecutable?model.acpSource||'已设置':'未找到随包的 agy_acp_server.exe'}</span>
   <button class="btn btn-quiet" type="button" onclick={()=>showPath=!showPath}>{showPath?'收起':'更改程序位置'}</button>
  </div>
  {#if showPath||!model.acpExecutable}
   <label class="path">
    <span>Antigravity 程序完整路径（agy_acp_server.exe 或 agy.exe）</span>
    <input type="text" bind:value={model.acpPath} placeholder={model.acpExecutable||'C:\\…\\agy_acp_server.exe'} spellcheck="false"/>
    <small>留空使用{model.saved?.acpBundled?'随包自带的程序':'已保存的路径'}。独立版需与同版本 localharness_external.exe 放在同一文件夹。</small>
   </label>
  {/if}
  <div class="actions">
   <button class="btn btn-primary" type="button" disabled={job.state.running||quiet.state.running||!model.acpExecutable} onclick={signIn}>{acpStatus==='ok'?'刷新可用模型':acpStatus==='needLogin'?'重新登录':'登录并读取模型'}</button>
   {#if inUse.length}
    {#if confirmLogout}
     <span class="confirm">退出后，所有 Antigravity 模型都需要重新登录才能使用。<button class="btn" type="button" onclick={logout}>确定退出</button><button class="btn btn-quiet" type="button" onclick={()=>confirmLogout=false}>取消</button></span>
    {:else}<button class="btn btn-quiet" type="button" onclick={()=>confirmLogout=true}>退出登录</button>{/if}
   {/if}
  </div>
  {#if acpStatus==='needLogin'}<p class="muted small">Antigravity 的登录已失效，点"重新登录"在浏览器中完成授权。</p>
  {:else if acpStatus==='error'}<p class="error small">无法确认登录：{acpProblem}</p>{/if}
  {#if logoutMessage}<p class="muted small">{logoutMessage}</p>{/if}
  <JobView job={job.state}/>
 {:else}
  <div class="actions">
   {#if !status?.connected}<button class="btn btn-primary" type="button" disabled={waiting} onclick={()=>chatSignIn(false)}>登录 ChatGPT</button>{/if}
   {#if status?.permissionDeclined}<button class="btn" type="button" onclick={()=>chatSignIn(true)}>重新授权</button>{/if}
   {#if status?.connected}<button class="btn" type="button" onclick={readChatModels}>{available.length?'刷新可用模型':'读取可用模型'}</button><button class="btn btn-quiet" type="button" onclick={disconnect}>断开连接</button>{/if}
   <a class="btn btn-quiet" href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">管理使用量</a>
  </div>
  {#if authUrl}<p class="muted small">如果浏览器没有自动打开，请<a href={authUrl} target="_blank" rel="noopener noreferrer">打开 ChatGPT 授权页面</a>，授权由你本人完成。</p>{/if}
  {#if chatError||status?.error}<p class="error small" role="alert">{chatError||status?.error}</p>{/if}
 {/if}

 {#if inUse.length}
  <div class="models">
   <h3>已在使用的模型</h3>
   {#each inUse as p (p.id)}<ModelRow profile={p} {model} label={nameOf(p.model)}/>{/each}
  </div>
 {:else if available.length}
  <p class="muted small">到"模型分配"中为功能选择 {acp?'Antigravity':'ChatGPT'} 模型后，会出现在这里。</p>
 {/if}
</section>

<style>
 .card{padding:var(--space-4) var(--space-5);border:1px solid var(--line);border-radius:var(--radius-md);background:var(--bg-surface);display:flex;flex-direction:column;gap:var(--space-3);}
 header{display:flex;justify-content:space-between;align-items:flex-start;gap:var(--space-4);}
 h2{font-size:var(--text-lg);}
 header p{margin:var(--space-1) 0 0;color:var(--fg-muted);font-size:var(--text-sm);}
 .state{flex:none;padding:2px var(--space-2);border-radius:999px;background:var(--status-idle-bg);color:var(--status-idle-fg);font-size:var(--text-xs);}
 .state.warn{background:var(--status-stopped-bg);color:var(--status-stopped-fg);}
 .state.ok{background:var(--status-done-bg);color:var(--status-done-fg);}
 .line{display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm);}
 .path{display:flex;flex-direction:column;gap:var(--space-1);font-size:var(--text-sm);}
 .path input{height:34px;padding:0 var(--space-2);border-radius:var(--radius-sm);border:1px solid var(--line-strong);background:var(--bg-raised);}
 .path small{color:var(--fg-muted);font-size:var(--text-xs);}
 .actions{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);}
 .confirm{display:inline-flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);font-size:var(--text-sm);}
 .models h3{font-size:var(--text-sm);margin:var(--space-2) 0 var(--space-1);color:var(--fg-muted);font-weight:var(--weight-medium);}
 .muted{color:var(--fg-muted);}
 .small{margin:0;font-size:var(--text-xs);}
 .error{color:var(--status-failed-fg);}
</style>
