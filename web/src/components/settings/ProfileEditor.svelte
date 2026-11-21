<script lang="ts">
 import {onMount} from 'svelte';
 import JobView from './JobView.svelte';
 import {api,ApiError,type ModelProfile,type Settings,type ChatgptStatus} from '../../lib/api';
 import {JobRun} from '../../lib/jobs.svelte';

 let {profile,saved,saving,ondelete}:{profile:ModelProfile;saved:Settings;saving:boolean;ondelete:()=>void}=$props();

 const isSaved=$derived(saved.modelProfiles.some(p=>p.id===profile.id));
 const provider=$derived(profile.provider||'api');

 // Provider-specific defaults when the connection type changes.
 function setProvider(value:ModelProfile['provider']){
  profile.provider=value;
  if(value==='antigravity-acp'){profile.acpEntry||='standalone';profile.acpExecutable||=saved.acpPaths[profile.acpEntry]||'';}
 }
 function setEntry(value:'cli'|'standalone'){profile.acpEntry=value;profile.acpExecutable=saved.acpPaths[value]||'';}

 // Models offered by the account (ACP "inspect" or ChatGPT model list).
 let accountModels=$state<{modelId:string;name?:string}[]>([]);
 const modelChoices=$derived.by(()=>{
  const list=accountModels.map(m=>[m.modelId,m.name||m.modelId] as [string,string]);
  if(profile.model&&!list.some(([v])=>v===profile.model))list.push([profile.model,profile.model+'（待验证）']);
  return list;
 });

 const test=new JobRun();
 async function check(kind:'ai'|'text'|'json'|'vision'|'inspect'|'login'){
  try{
   const result:any=await test.run(()=>api.modelTest(kind,$state.snapshot(profile) as ModelProfile));
   if((kind==='inspect'||kind==='login')&&result?.models){accountModels=result.models;if(!profile.model&&result.currentModel)profile.model=result.currentModel;test.state.message='已读取 '+result.models.length+' 个可用模型。选择后请保存。';}
  }catch{/* shown by JobView */}
 }

 // ACP sign-out (shared account) — confirmed in place.
 let confirmLogout=$state(false),logoutMessage=$state('');
 async function logout(){
  confirmLogout=false;logoutMessage='正在退出…';
  try{const r=await api.acpLogout(profile.id);logoutMessage=r?.message||'已退出登录。';}catch(e){logoutMessage=(e as Error).message;}
 }

 // ChatGPT subscription account.
 let account=$state<ChatgptStatus|null>(null),accountError=$state(''),authUrl=$state('');
 async function refreshAccount(){try{account=await api.chatgptStatus();accountError='';}catch(e){accountError=(e as Error).message;}}
 async function signIn(reconsent=false){
  accountError='';authUrl='';
  try{
   const {authorizationUrl}=await api.chatgptLogin(reconsent);
   const u=new URL(authorizationUrl);
   if(u.origin!=='https://auth.openai.com'||u.pathname!=='/api/accounts/authorize')throw new Error('授权地址无效。');
   authUrl=authorizationUrl;
   for(let i=0;i<120;i++){await new Promise(r=>setTimeout(r,2500));await refreshAccount();if(account?.connected||!account?.pending)break;}
  }catch(e){accountError=e instanceof ApiError?e.message:(e as Error).message;}
 }
 async function disconnect(){try{await api.chatgptDisconnect();accountModels=[];await refreshAccount();}catch(e){accountError=(e as Error).message;}}
 async function readChatgptModels(){try{accountModels=(await api.chatgptModels()).models;accountError='';}catch(e){accountError=(e as Error).message;}}
 onMount(()=>{if(provider==='chatgpt-plan')refreshAccount();});
 $effect(()=>{if(provider==='chatgpt-plan'&&!account)refreshAccount();});

 let confirmDelete=$state(false);
</script>

<div class="editor">
 <div class="grid">
  <label class="field"><span>名称</span><input type="text" bind:value={profile.name} required/></label>
  <label class="field"><span>连接方式</span>
   <select value={provider} onchange={e=>setProvider((e.currentTarget as HTMLSelectElement).value as ModelProfile['provider'])}>
    <option value="api">API · Chat Completions</option>
    <option value="antigravity-acp">Antigravity · 官方 ACP</option>
    <option value="chatgpt-plan">ChatGPT 订阅 · Responses</option>
   </select>
  </label>

  {#if provider==='api'}
   <label class="field wide"><span>API 地址</span><input type="url" bind:value={profile.baseUrl} placeholder="https://…/v1" spellcheck="false" required/></label>
   <label class="field"><span>模型名称</span><input type="text" bind:value={profile.model} spellcheck="false" required/></label>
   <label class="field"><span>API 密钥</span>
    <input type="password" bind:value={profile.apiKey} autocomplete="new-password" spellcheck="false" placeholder={profile.hasApiKey&&!profile.clearApiKey?'已保存，留空则保留':'粘贴密钥'} disabled={profile.clearApiKey}/>
    {#if profile.hasApiKey}<small><label class="inline"><input type="checkbox" bind:checked={profile.clearApiKey}/>保存时清除已存密钥</label></small>{/if}
   </label>
   <label class="field"><span>输出 Token 上限</span><input type="number" bind:value={profile.maxOutputTokens} min="1000" max="100000"/><small>范围 1000–100000</small></label>
   <label class="field"><span>输出参数名</span><select bind:value={profile.outputTokenField}><option value="max_completion_tokens">max_completion_tokens</option><option value="max_tokens">max_tokens</option></select></label>
  {:else if provider==='antigravity-acp'}
   <label class="field"><span>官方入口</span>
    <select value={profile.acpEntry||'standalone'} onchange={e=>setEntry((e.currentTarget as HTMLSelectElement).value as 'cli'|'standalone')}>
     <option value="standalone">独立 ACP · agy_acp_server.exe</option><option value="cli">CLI · agy acp</option>
    </select>
   </label>
   <label class="field wide"><span>程序完整路径</span><input type="text" bind:value={profile.acpExecutable} spellcheck="false" placeholder={profile.acpEntry==='cli'?'C:\\…\\agy.exe':'C:\\…\\agy_acp_server.exe'}/>
    <small>独立版请完整解压官方 ZIP，agy_acp_server.exe 与同版本 localharness_external.exe 放在同一文件夹。</small></label>
   <label class="field"><span>账号可用模型</span>
    <select bind:value={profile.model}><option value="">{accountModels.length?'请选择模型':'先登录或读取模型列表'}</option>{#each modelChoices as [v,t] (v)}<option value={v}>{t}</option>{/each}</select>
   </label>
  {:else}
   <label class="field"><span>模型</span>
    <select bind:value={profile.model}><option value="">{accountModels.length?'请选择模型':'先读取模型列表'}</option>{#each modelChoices as [v,t] (v)}<option value={v}>{t}</option>{/each}</select>
   </label>
  {/if}

  <label class="field"><span>上下文字符额度</span><input type="number" bind:value={profile.contextChars} min="20000" max="2000000"/><small>范围 20000–2000000</small></label>
  <label class="check"><input type="checkbox" checked={profile.visionEnabled!==false} onchange={e=>profile.visionEnabled=(e.currentTarget as HTMLInputElement).checked}/>允许图片输入（纯文字模型可取消）</label>
 </div>

 {#if provider==='antigravity-acp'}
  <p class="help">使用官方个人账号登录，不填写 API 密钥。剩余额度和计费需要到 Antigravity 查看，这里无法确认。</p>
 {/if}

 {#if provider==='chatgpt-plan'}
  <section class="account" aria-label="ChatGPT 账号">
   <div class="account-line">
    {#if account?.connected}<span>已连接{account.email?'：'+account.email:''}</span>{:else if account?.pending}<span>等待你在浏览器中完成授权…</span>{:else}<span>尚未连接 ChatGPT 账号</span>{/if}
    <div class="buttons">
     {#if !account?.connected}<button class="btn" type="button" onclick={()=>signIn(false)}>登录 ChatGPT</button>{/if}
     {#if account?.permissionDeclined}<button class="btn" type="button" onclick={()=>signIn(true)}>重新授权</button>{/if}
     {#if account?.connected}<button class="btn" type="button" onclick={readChatgptModels}>读取模型列表</button><button class="btn btn-quiet" type="button" onclick={disconnect}>断开连接</button>{/if}
     <a class="btn btn-quiet" href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">管理使用量</a>
    </div>
   </div>
   {#if authUrl}<p class="help">在打开的页面中完成授权：<a href={authUrl} target="_blank" rel="noopener noreferrer">打开 ChatGPT 授权页面</a></p>{/if}
   {#if accountError||account?.error}<p class="error" role="alert">{accountError||account?.error}</p>{/if}
  </section>
 {/if}

 <div class="actions">
  {#if provider==='antigravity-acp'}
   <button class="btn" type="button" disabled={test.state.running} onclick={()=>check('login')}>个人账号登录</button>
   <button class="btn" type="button" disabled={test.state.running} onclick={()=>check('inspect')}>读取模型列表</button>
  {/if}
  {#if provider==='api'}
   <button class="btn" type="button" disabled={test.state.running} onclick={()=>check('ai')}>测试文字 / JSON</button>
  {:else}
   <button class="btn" type="button" disabled={test.state.running} onclick={()=>check('text')}>测试纯文字</button>
   <button class="btn" type="button" disabled={test.state.running} onclick={()=>check('json')}>测试 JSON</button>
  {/if}
  <button class="btn" type="button" disabled={test.state.running} onclick={()=>check('vision')}>测试图片</button>
  <span class="spacer"></span>
  {#if provider==='antigravity-acp'&&isSaved}
   {#if confirmLogout}
    <span class="confirm">退出后，所有使用这个 Antigravity 账号的连接都需要重新登录。<button class="btn" type="button" onclick={logout}>确定退出</button><button class="btn btn-quiet" type="button" onclick={()=>confirmLogout=false}>取消</button></span>
   {:else}<button class="btn btn-quiet" type="button" onclick={()=>confirmLogout=true}>退出登录</button>{/if}
  {/if}
  {#if confirmDelete}
   <span class="confirm danger">删除"{profile.name||'未命名连接'}"？引用它的功能将改用默认模型。<button class="btn danger-btn" type="button" disabled={saving} onclick={()=>{confirmDelete=false;ondelete();}}>确定删除</button><button class="btn btn-quiet" type="button" onclick={()=>confirmDelete=false}>取消</button></span>
  {:else}<button class="btn btn-quiet danger-text" type="button" onclick={()=>confirmDelete=true}>删除连接</button>{/if}
 </div>
 {#if logoutMessage}<p class="help">{logoutMessage}</p>{/if}
 <JobView job={test.state}/>
</div>

<style>
 .editor{display:flex;flex-direction:column;gap:var(--space-3);}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:var(--space-4);}
 .field{display:flex;flex-direction:column;gap:var(--space-1);font-size:var(--text-sm);}
 .field.wide{grid-column:span 2;}
 .field>span{font-weight:var(--weight-medium);}
 input:not([type=checkbox]),select{height:34px;padding:0 var(--space-2);border-radius:var(--radius-sm);border:1px solid var(--line-strong);background:var(--bg-raised);}
 small{color:var(--fg-muted);font-size:var(--text-xs);}
 .inline{display:inline-flex;align-items:center;gap:var(--space-1);}
 .check{grid-column:1/-1;display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm);}
 .help{margin:0;font-size:var(--text-xs);color:var(--fg-muted);}
 .account{padding:var(--space-3);border:1px solid var(--line);border-radius:var(--radius-md);background:var(--bg-raised);font-size:var(--text-sm);}
 .account-line{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);flex-wrap:wrap;}
 .buttons{display:flex;gap:var(--space-2);flex-wrap:wrap;}
 .actions{display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap;padding-top:var(--space-2);border-top:1px solid var(--line);}
 .spacer{flex:1;}
 .confirm{display:inline-flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm);}
 .danger{color:var(--status-failed-fg);}
 .danger-text{color:var(--status-failed-fg);}
 .danger-btn{border-color:var(--status-failed-fg);color:var(--status-failed-fg);}
 .error{margin:var(--space-2) 0 0;color:var(--status-failed-fg);font-size:var(--text-xs);}
 @media (max-width:900px){.field.wide{grid-column:auto;}}
</style>
