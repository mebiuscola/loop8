import {acpPanel,chatgptUsageLink,observeAcpJob} from './acp.js';
const TASKS={pptPreview:'单页 PPT 试解析',pptRecognition:'课件识别',pptTranslation:'课件翻译',pptExplanation:'课件解读',referenceTranslation:'参考文献翻译',pdfRecognition:'文献 AI 补救',classroom:'课堂重建',transcriptTranslation:'讲稿翻译',context:'材料背景整理',deepDive:'本节 Deep Dive',weeklyDeepDive:'整周 Deep Dive',qa:'Ask 问答'};
const GROUPS=[['课件与文献',['pptRecognition','pptTranslation','pptExplanation','pptPreview','referenceTranslation','pdfRecognition']],['课堂讲稿',['classroom','transcriptTranslation','context']],['Deep Dive',['deepDive','weeklyDeepDive']],['问答',['qa']]];
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
const button=(text,action,cls)=>{const b=el('button',text,cls);b.type='button';b.onclick=action;return b;};
let welcomed=false;
function showChatGPTWelcome(){
 if(welcomed)return;
 try{if(localStorage.getItem('classroom-chatgpt-plan-welcome'))return;}catch{}
 const dialog=el('dialog'),title=el('h2','正在使用 ChatGPT 订阅'),actions=el('div',null,'dialog-actions');
 title.id='chatgpt-welcome-title';dialog.setAttribute('aria-labelledby',title.id);
 actions.append(chatgptUsageLink(),button('知道了',()=>dialog.close(),'primary'));
 dialog.append(title,el('p','分配给此连接的合资格请求将使用你的 ChatGPT 订阅额度。你可以在 ChatGPT 设置中查看和管理使用量。'),actions);
 dialog.addEventListener('close',()=>{try{localStorage.setItem('classroom-chatgpt-plan-welcome','1');}catch{}dialog.remove();},{once:true});
 document.body.append(dialog);dialog.showModal();welcomed=true;
}
export function initSettings({api,post,notice}){
 const dialog=document.querySelector('#settings'),form=document.querySelector('#settings-form');form.replaceChildren();form.onsubmit=e=>e.preventDefault();dialog.classList.add('settings-redesigned');
 let saved=null,section='models',selected='',dirty=new Set(),drafts=new Map(),routes={},fallback='',fallbackEnabled=false,defaultId='',sectionDrafts={},testing=new Map(),results=new Map(),metadata=new Map();
 let pathDrafts=new WeakMap(),selectionDrafts=new WeakMap(),chatgptModels=[];
 const plan=p=>p.provider==='chatgpt-plan';
 const providerLabel=p=>plan(p)?'ChatGPT 订阅':p.provider==='antigravity-acp'?'ACP':'API';
 const connectionKey=p=>JSON.stringify([p.acpEntry,p.acpExecutable]);
 const heading=el('header',null,'settings-heading'),title=el('h2','模型与解析设置'),close=button('关闭',()=>dialog.close());close.id='settings-close';heading.append(title,close);
 const layout=el('div',null,'settings-layout'),nav=el('nav',null,'settings-menu'),body=el('div',null,'settings-content'),footer=el('footer',null,'settings-footer'),status=el('span'),save=button('保存当前设置',()=>saveSection(),'primary');status.id='settings-status';status.setAttribute('role','status');footer.append(status,save);layout.append(nav,body);form.append(heading,layout,footer);
 const categories=[['models','AI 模型'],['routes','功能分配'],['mineru','MinerU'],['preview','原页预览'],['advanced','高级设置']];
 const testBar=el('div',null,'settings-testing-bar');heading.after(testBar);
 function paintTesting(){testBar.replaceChildren();testBar.hidden=!testing.size;if(testing.size){testBar.append(el('span','正在测试 '+testing.size+' 个连接；可以继续浏览其他设置。'),button('停止测试',()=>{for(const value of testing.values())value.cancel?.();}));}}
 for(const [id,label] of categories){const b=button(label,()=>{section=id;render();});b.dataset.settingsSection=id;nav.append(b);}nav.setAttribute('aria-label','设置分类');
 function models(){return [...saved.modelProfiles.map(p=>drafts.get(p.id)||p),...[...drafts.values()].filter(p=>!saved.modelProfiles.some(x=>x.id===p.id))];}
 const name=id=>{
  const profile=saved.modelProfiles.find(p=>p.id===id);
  if(!profile)return '未选择模型';
  return [profile.name,profile.model,profile.acpThinking].filter(Boolean).join(' · ');
 };
 function labelField(host,label,key,value,{type='text',choices,change,required=false}={}){const wrap=el('label',null,'settings-field'),text=el('span',label),input=el(choices?'select':'input');input.dataset.field=key;input.name=key;if(choices){for(const [v,t] of choices){const o=el('option',t);o.value=v;input.append(o);}}else input.type=type;
  if(type==='checkbox'){input.checked=!!value;wrap.classList.add('check');wrap.append(input,text);}else{input.value=value??'';wrap.append(text,input);}input.required=required;input.oninput=()=>{change?.(type==='checkbox'?input.checked:type==='number'?Number(input.value):input.value);dirty.add(section==='models'?(key==='defaultProfileId'?'default':'model:'+selected):section);status.textContent='有未保存的修改';};host.append(wrap);return input;}
 function modelOptions(){return [['','未选择'],...saved.modelProfiles.map(p=>[p.id,p.name+' · '+providerLabel(p)])];}
 function render(){if(!saved)return;for(const b of nav.children){b.classList.toggle('selected',b.dataset.settingsSection===section);b.setAttribute('aria-current',b.dataset.settingsSection===section?'page':'false');}body.replaceChildren();status.textContent=(section==='models'?(dirty.has('default')||dirty.has('model:'+selected)):dirty.has(section))?'有未保存的修改':'';save.textContent=section==='models'?'保存连接':'保存当前设置';save.hidden=false;
  if(section==='models')renderModels();else if(section==='routes')renderRoutes();else renderOther();
 }
 function renderModels(){
  body.append(el('h3','AI 模型'),el('p','添加连接，选一个作为默认模型。需要时再为个别功能指定其他模型。','settings-intro'));
  const defaultRow=el('div',null,'settings-default'),impact=el('p',null,'settings-note');
  const inherited=()=>Object.keys(TASKS).filter(t=>!saved.modelRoutes[t]&&(t!=='pptPreview'||!saved.modelRoutes.pptRecognition));
  function showImpact(){impact.textContent=defaultId!==saved.defaultProfileId?'将切换 '+inherited().map(t=>TASKS[t]).join('、')+'。已有单项分配继续优先。':'';impact.hidden=!impact.textContent;}
  const picker=labelField(defaultRow,'全局默认模型','defaultProfileId',defaultId,{choices:modelOptions(),change:v=>{defaultId=v;showImpact();}});picker.id='default-model';showImpact();
  defaultRow.append(button('保存默认模型',async()=>{try{const affected=inherited().length;await persist({section:'models',defaultProfileId:defaultId});dirty.delete('default');showImpact();status.textContent='默认模型已保存，'+affected+' 个沿用默认的功能将使用它。';}catch(e){status.textContent=e.message;}}));body.append(defaultRow,impact);
  const split=el('div',null,'settings-model-workspace'),list=el('nav',null,'settings-model-list'),editor=el('section',null,'settings-model-editor');list.setAttribute('aria-label','已添加的模型');
  for(const p of models()){const b=button(p.name||'未命名连接',()=>{selected=p.id;render();});b.dataset.modelId=p.id;b.classList.toggle('selected',selected===p.id);b.append(el('small',providerLabel(p)+(p.id===defaultId?' · 默认':'')));list.append(b);}
  list.append(button('添加模型',()=>{const p={id:crypto.randomUUID(),name:'新模型',provider:'api',baseUrl:'https://api.openai.com/v1',model:'',apiKey:'',contextChars:180000,maxOutputTokens:12000,outputTokenField:'max_completion_tokens',visionEnabled:true};drafts.set(p.id,p);selected=p.id;dirty.add('model:'+p.id);render();},'settings-add-model'));split.append(list,editor);body.append(split);
  let original=models().find(p=>p.id===selected);if(!original){original=models()[0];selected=original?.id||'';}if(!original){editor.append(el('p','还没有模型连接。点击“添加模型”开始。'));save.hidden=true;return;}
  if(!drafts.has(selected))drafts.set(selected,{...original,apiKey:''});const p=drafts.get(selected);editor.dataset.profile=p.id;
  const fields=el('div',null,'settings-fields');editor.append(el('h4',p.name||'连接设置'),fields);
  const change=(key,v)=>{p[key]=v;};
  labelField(fields,'连接名称','name',p.name,{change:v=>change('name',v),required:true});
  const provider=labelField(fields,'连接方式','provider',p.provider||'api',{choices:[['api','API · Chat Completions'],['antigravity-acp','Antigravity · 官方 ACP'],['chatgpt-plan','ChatGPT 订阅 · Responses']],change:v=>change('provider',v)});
  provider.onchange=()=>{if(p.provider==='antigravity-acp'){p.acpEntry||='standalone';p.acpExecutable||='';p.model='';p.apiKey='';}else{p.baseUrl||='https://api.openai.com/v1';p.model='';if(plan(p))p.apiKey='';}render();};
  if(p.provider==='antigravity-acp'){
   if(!pathDrafts.has(p))pathDrafts.set(p,{...saved.acpPaths,...(p.acpExecutable?{[p.acpEntry]:p.acpExecutable}:{})});
   if(!selectionDrafts.has(p))selectionDrafts.set(p,{});
   const paths=pathDrafts.get(p),selections=selectionDrafts.get(p);
   if(!p.acpExecutable)p.acpExecutable=paths[p.acpEntry]||'';
   const entry=labelField(fields,'官方入口','acpEntry',p.acpEntry||'standalone',{choices:[['standalone','独立 ACP · agy_acp_server.exe'],['cli','CLI · agy acp']],change:v=>{
    selections[p.acpEntry]={model:p.model,acpThinking:p.acpThinking};
    p.acpEntry=v;
    p.acpExecutable=paths[v]||'';
    Object.assign(p,selections[v]||{model:'',acpThinking:''});
   }});
   entry.onchange=()=>render();
   const executable=labelField(fields,'程序完整路径','acpExecutable',p.acpExecutable,{change:v=>{p.acpExecutable=v;paths[p.acpEntry]=v;},required:true});
   executable.placeholder=p.acpEntry==='cli'?'C:\\…\\agy.exe':'C:\\…\\agy_acp_server.exe';
   editor.append(el('p','CLI 和独立 ACP 各保存一条路径。同一入口的预设共用路径。先登录并读取模型列表，再选择模型。','settings-note'));
   if(p.acpEntry==='standalone')editor.append(el('p','agy_acp_server.exe 与 localharness_external.exe 应在同一目录。','settings-note'));
   const currentMeta=metadata.get(connectionKey(p));
   const choices=[['','请选择模型'],...(currentMeta?.models||[]).map(m=>[m.modelId,m.name||m.modelId])];if(p.model&&!choices.some(o=>o[0]===p.model))choices.push([p.model,p.model+'（已保存）']);
   const model=labelField(fields,'账号可用模型','model',p.model,{choices,change:v=>{p.model=v;p.acpThinking='';}});
   model.onchange=()=>render();
   const thinking=currentMeta?.currentModel===p.model?currentMeta.thinking:null;
   const thinkingPicker=thinking?labelField(fields,'思考强度','acpThinking',p.acpThinking||'',{choices:[['','运行时默认'],...thinking.options.map(o=>[o.value,o.name])],change:v=>change('acpThinking',v)}):null;
   if(!thinking&&p.model&&currentMeta)editor.append(el('p','读取模型列表后，可查看所选模型的思考强度。','settings-note'));
   executable.addEventListener('input',()=>{
    model.replaceChildren(new Option('请读取模型列表',''));
    if(p.model)model.add(new Option(p.model+'（已保存）',p.model,true,true));
    if(thinkingPicker)thinkingPicker.closest('label').remove();
   });
   editor.append(button('复制 ACP 预设',()=>{
    const copy={...p,id:crypto.randomUUID(),name:(p.name||'ACP')+' 副本'};
    pathDrafts.set(copy,{...paths});drafts.set(copy.id,copy);
    selected=copy.id;dirty.add('model:'+copy.id);render();
   }));
   editor.append(el('p','点击任务按钮后，ACP 自动继续模型请求并允许本次工具操作；可随时停止。额度与额外积分请在 Antigravity 中查看。','settings-note'));
  }else if(plan(p)){
   const choices=[['','请选择模型'],...chatgptModels.map(m=>[m.modelId,m.name])];
   if(p.model&&!choices.some(o=>o[0]===p.model))choices.push([p.model,p.model+'（已保存）']);
   labelField(fields,'ChatGPT 账号可用模型','model',p.model,{choices,change:v=>change('model',v)});
   const accountStatus=el('p','正在检查 ChatGPT 连接…','settings-note');
   accountStatus.setAttribute('role','status');editor.append(accountStatus);
   const accountActions=el('div',null,'settings-test-actions');editor.append(accountActions);
   async function signInFlow(reconsent){
    const popup=window.open('about:blank','_blank');
    if(popup)popup.opener=null;
    signIn.disabled=true;retryConsent.disabled=true;authorize.hidden=true;
    try{
     const {authorizationUrl}=await post('/api/chatgpt/login',{reconsent});
     const url=new URL(authorizationUrl);
     if(url.origin!=='https://auth.openai.com'||url.pathname!=='/api/accounts/authorize')throw Error('授权地址无效。');
     authorize.href=url.href;authorize.hidden=false;
     if(popup)popup.location.replace(url.href);
     for(let i=0;i<303;i++){
      await new Promise(resolve=>setTimeout(resolve,1000));
      const result=await updateAccount();
      if(!result.pending){authorize.hidden=true;break;}
     }
    }catch(e){popup?.close();accountStatus.textContent=e.message;}
    finally{signIn.disabled=false;retryConsent.disabled=false;}
   }
   const signIn=button('Continue with ChatGPT',()=>signInFlow(false));
   const retryConsent=button('重新授权订阅额度',()=>signInFlow(true));retryConsent.hidden=true;
   const authorize=el('a','打开 OpenAI 授权页');authorize.hidden=true;authorize.target='_blank';authorize.rel='noopener noreferrer';
   const disconnect=button('断开连接',async()=>{
    disconnect.disabled=true;
    try{
     const result=await post('/api/chatgpt/disconnect',{});chatgptModels=[];
     await updateAccount();
     if(!result.revoked)accountStatus.textContent='已断开本地连接。远程撤销未确认，可在 ChatGPT 使用情况中断开授权。';
    }catch(e){accountStatus.textContent=e.message;}
    finally{disconnect.disabled=false;}
   });
   const readModels=button('读取模型列表',async()=>{
    readModels.disabled=true;
    try{chatgptModels=(await api('/api/chatgpt/models')).models;if(section==='models'&&selected===p.id)render();}
    catch(e){accountStatus.textContent=e.message;}
    finally{readModels.disabled=false;}
   });
   accountActions.append(signIn,retryConsent,authorize,disconnect,readModels,chatgptUsageLink());
   async function updateAccount(){
    const result=await api('/api/chatgpt/status');
    accountStatus.textContent=result.error||(result.pending?'等待在浏览器中授权…':result.connected?'使用 ChatGPT 订阅'+(result.email?' · '+result.email:''):'尚未连接 ChatGPT 订阅');
    disconnect.hidden=!result.connected&&!result.pending;
    readModels.disabled=!result.connected||result.pending;
    retryConsent.hidden=!result.permissionDeclined;
    if(result.connected&&!result.pending&&dialog.open)showChatGPTWelcome();
    return result;
   }
   updateAccount().catch(e=>accountStatus.textContent=e.message);
   editor.append(el('p','登录后选择账号可用的模型，依次测试纯文字、JSON 和图片。保存连接后可设为全局默认，也可分配给单项功能。','settings-note'));
  }else{
   labelField(fields,'API 地址','baseUrl',p.baseUrl,{type:'url',change:v=>change('baseUrl',v),required:true});
   const key=labelField(fields,'API 密钥','apiKey',p.apiKey||'',{type:'password',change:v=>{p.apiKey=v;p.clearApiKey=false;}});key.autocomplete='off';key.placeholder=p.hasApiKey?'已保存；填写新密钥可更换':'填写此连接的密钥';
   labelField(fields,'模型名称','model',p.model,{change:v=>change('model',v)});
   const clear=button('清除此连接密钥',()=>{p.apiKey='';p.clearApiKey=true;key.value='';dirty.add('model:'+p.id);status.textContent='密钥将在保存连接后清除。';});editor.append(clear);
  }
  const advanced=el('details',null,'settings-model-advanced');advanced.append(el('summary','高级参数'));const af=el('div',null,'settings-fields');advanced.append(af);editor.append(advanced);
  labelField(af,'上下文字符上限','contextChars',p.contextChars||180000,{type:'number',change:v=>change('contextChars',v)});
  if(!plan(p)&&p.provider!=='antigravity-acp'){labelField(af,'输出 Token 上限','maxOutputTokens',p.maxOutputTokens||12000,{type:'number',change:v=>change('maxOutputTokens',v)});labelField(af,'输出参数','outputTokenField',p.outputTokenField||'max_completion_tokens',{choices:[['max_completion_tokens','max_completion_tokens'],['max_tokens','max_tokens']],change:v=>change('outputTokenField',v)});}
  labelField(af,'允许图片输入','visionEnabled',p.visionEnabled!==false,{type:'checkbox',change:v=>change('visionEnabled',v)});
  const actions=el('div',null,'settings-test-actions');editor.append(actions);const testStatus=el('p',null,'profile-test-status');testStatus.setAttribute('role','status');const panel=testing.get(p.id)?.panel||acpPanel();editor.append(testStatus,panel);if(testing.has(p.id))editor.insertBefore(panel,fields);
  const fingerprint=()=>{const {id,name,hasApiKey,...configuration}=p;return JSON.stringify(configuration);};
  const paintResults=()=>{const records=results.get(p.id)||{};testStatus.textContent=Object.entries(records).map(([k,r])=>({ai:'文字 / JSON',text:'纯文字',json:'JSON',vision:'图片',inspect:'模型列表',login:'登录'}[k]||k)+'：'+(r.fingerprint===fingerprint()?r.message:'设置已更改，需重新测试')).join('；');};paintResults();
  async function check(kind){if(testing.has(p.id))return;const snapshot={...p},fp=fingerprint();let job;const running={panel,cancel:()=>{if(job)post(job.transport==='acp'?'/api/acp/jobs/'+job.id+'/cancel':job.transport==='chatgpt'?'/api/chatgpt/jobs/'+job.id+'/cancel':'/api/settings/test/'+job.id+'/cancel',{}).catch(e=>status.textContent=e.message);}};testing.set(p.id,running);editor.insertBefore(panel,fields);paintTesting();panel.scrollIntoView({block:'nearest'});for(const b of actions.children)b.disabled=true;testStatus.textContent='正在测试…';
   try{job=await post('/api/settings/model-test',{kind,profile:snapshot});let result;
    if(['acp','chatgpt'].includes(job.transport))result=await observeAcpJob({api,post,id:job.id,host:panel,transport:job.transport});else{
     const stop=button('停止测试',()=>post('/api/settings/test/'+job.id+'/cancel',{}));panel.replaceChildren(stop);
     while(job.status==='running'){await new Promise(r=>setTimeout(r,650));job=await api('/api/settings/test/'+job.id);testStatus.textContent=job.stage+' · '+Math.round((Date.now()-job.started)/1000)+' 秒';}panel.replaceChildren();if(job.status!=='success')throw Error(job.message);result={message:job.message};
    }
    if(kind==='login')metadata.delete(connectionKey(snapshot));
    if(kind==='inspect'){
     metadata.set(connectionKey(snapshot),result);
     if(connectionKey(p)===connectionKey(snapshot)&&p.model===snapshot.model){
      if(!p.model)p.model=result.currentModel||'';
      if(result.selectedModel&&result.selectedModel!==p.model){
       p.model=result.selectedModel;p.acpThinking=result.selectedThinking||'';
       dirty.add('model:'+p.id);
      }
     }
    }
    const record=results.get(p.id)||{};record[kind]={fingerprint:fp,message:(result.message||'已完成')+' · '+new Date().toLocaleTimeString()};results.set(p.id,record);paintResults();
   }catch(e){testStatus.textContent=e.message;const record=results.get(p.id)||{};record[kind]={fingerprint:fp,message:e.message};results.set(p.id,record);}finally{testing.delete(p.id);paintTesting();for(const b of actions.children)b.disabled=false;if(section==='models'&&selected===p.id)render();}
  }
  for(const [text,kind] of [...(p.provider==='antigravity-acp'?[['个人账号登录','login'],['读取模型列表','inspect']]:[]),...(plan(p)||p.provider==='antigravity-acp'?[['测试纯文字','text'],['测试 JSON','json']]:[['测试文字 / JSON','ai']]),['测试图片','vision']])actions.append(button(text,()=>check(kind)));
  if(testing.has(p.id)){for(const b of actions.children)b.disabled=true;testStatus.textContent='此连接有正在进行的任务，进度如下。';}
  editor.append(button('删除连接',async()=>{if(!confirm('删除“'+(p.name||'未命名连接')+'”？引用此连接的功能将改为使用默认模型；若它是默认模型，则需要重新选择默认模型。'))return;try{if(saved.modelProfiles.some(x=>x.id===p.id))await persist({section:'delete-model',profileId:p.id});drafts.delete(p.id);dirty.delete('model:'+p.id);defaultId=saved.defaultProfileId||'';routes={...saved.modelRoutes};selected='';render();}catch(e){status.textContent=e.message;}},'settings-delete-model'));
 }
 function renderRoutes(){
  body.append(el('h3','功能分配'),el('p','每项功能可使用默认模型或单独指定。最终使用的模型显示在右侧。','settings-intro'));
  for(const [group,tasks] of GROUPS){body.append(el('h4',group));const table=el('table',null,'settings-routes');const head=el('tr');for(const t of ['功能','选择方式','实际使用'])head.append(el('th',t));table.append(head);
   for(const task of tasks){const row=el('tr'),choice=el('td'),effective=el('td',name(routes[task]||(task==='pptPreview'?routes.pptRecognition||defaultId:defaultId)));row.append(el('td',TASKS[task]),choice,effective);const select=labelField(choice,TASKS[task]+'使用的模型',task,routes[task]||'',{choices:[['',task==='pptPreview'?'跟随课件识别':'使用默认模型'],...modelOptions().slice(1)],change:v=>{routes[task]=v;if(task==='pptRecognition'&&!routes.pptPreview)body.querySelector('[data-task-row=pptPreview] td:last-child').textContent=name(v||defaultId);effective.textContent=name(v||(task==='pptPreview'?routes.pptRecognition||defaultId:defaultId));}});select.dataset.task=task;row.dataset.taskRow=task;table.append(row);}body.append(table);}
  body.append(el('h4','文献 AI 补救的备用模型'),el('p','仅用于文献识别失败后的备用步骤。ChatGPT 订阅与其他连接之间由你手动切换。','settings-note'));
  labelField(body,'启用文献备用模型','fallbackEnabled',fallbackEnabled,{type:'checkbox',change:v=>fallbackEnabled=v});labelField(body,'备用模型','fallbackProfileId',fallback,{choices:modelOptions(),change:v=>fallback=v});
 }
 function renderOther(){const values=sectionDrafts[section]||=(structuredClone(saved)),fields=el('div',null,'settings-fields');body.append(el('h3',categories.find(c=>c[0]===section)[1]),fields);
  const add=(label,key,type='text',choices)=>labelField(fields,label,key,values[key],{type,choices,change:v=>values[key]=v});
  if(section==='mineru'){const token=add('MinerU API Token','mineruToken','password');token.value='';token.placeholder=saved.hasMineruToken?'已保存；留空保留':'填写 MinerU Token';add('解析语言','mineruLanguage');add('同时上传文件数','uploadConcurrency','number');body.append(el('p','使用 MinerU 官方云端；连接检查不上传文件，测试解析会上传一个小测试 PDF。','settings-note'));
   const result=el('p');result.setAttribute('role','status');for(const [kind,label] of [['mineru-connection','检查连接'],['mineru','测试解析']])body.append(button(label,async()=>{try{let j=await post('/api/settings/test',{kind,settings:{...values,mineruMode:'cloud',mineruModel:'vlm'}});while(j.status==='running'){result.textContent=j.stage;await new Promise(r=>setTimeout(r,700));j=await api('/api/settings/test/'+j.id);}result.textContent=j.message;}catch(e){result.textContent=e.message;}}));body.append(result);
   body.append(button('清除已存 Token',()=>{values.clearMineruToken=true;values.mineruToken='';token.value='';dirty.add(section);status.textContent='Token 将在保存后清除。';}));
  }else if(section==='preview'){add('预览方式','previewEngine','text',[['auto','自动选择'],['powerpoint','本机 PowerPoint'],['libreoffice','LibreOffice'],['manual','手动提供 PDF 预览']]);add('浏览器程序路径（可选）','browserPath');add('LibreOffice 程序路径（可选）','libreOfficePath');body.append(el('p','预览设置用于显示原页，不决定翻译或解读使用的模型。','settings-note'));}
  else{add('材料背景整理并发数','contextConcurrency','number');add('AI 材料解析并发数','parseConcurrency','number');add('课件使用较小的传输图（试验）','compactPptImages','checkbox');add('课堂字幕分段字符数','chunkChars','number');add('要求结构化 JSON 输出','structuredOutput','checkbox');body.append(el('p','上下文和输出额度在每个模型的“高级参数”中设置。ACP 课件分析最多可同时处理 4 页。','settings-note'));}
 }
 async function persist(payload){const next=await post('/api/settings/editor',payload);saved=next;return next;}
 async function saveSection(){save.disabled=true;try{
  if(section==='models'){
   const p=drafts.get(selected);if(!p)throw Error('请先添加模型。');
   for(const f of body.querySelectorAll('[data-profile] input'))if(!f.reportValidity())return;
   const paths=p.provider==='antigravity-acp'?{...pathDrafts.get(p),[p.acpEntry]:p.acpExecutable}:undefined;
   const acpPaths=paths&&Object.fromEntries(Object.entries(paths).filter(([entry,value])=>value||entry===p.acpEntry));
   await persist({section:'model',profile:p,acpPaths});drafts.delete(p.id);
  }
  else if(section==='routes'){await persist({section:'routes',modelRoutes:routes,fallbackProfileId:fallback,fallbackEnabled});}
  else await persist({section,...sectionDrafts[section]});
  dirty.delete(section==='models'?'model:'+selected:section);render();status.textContent=dirty.size?'\u5f53\u524d\u9879\u5df2\u4fdd\u5b58\uff0c\u4ecd\u6709\u5176\u4ed6\u672a\u4fdd\u5b58\u4fee\u6539':'\u5df2\u4fdd\u5b58';
 }catch(e){status.textContent=e.message;}finally{save.disabled=false;}}
 dialog.addEventListener('cancel',e=>{if(dirty.size&&!confirm('仍有未保存修改，关闭并放弃这些修改？'))e.preventDefault();});
 dialog.addEventListener('close',()=>{for(const value of testing.values())value.cancel?.();});
 close.onclick=()=>{if(!dirty.size||confirm('仍有未保存修改，关闭并放弃这些修改？'))dialog.close();};
 document.querySelector('#settings-open').onclick=async()=>{try{saved=await api('/api/settings/editor');drafts=new Map();dirty=new Set();metadata=new Map();results=new Map();pathDrafts=new WeakMap();selectionDrafts=new WeakMap();sectionDrafts={};chatgptModels=[];routes={...saved.modelRoutes};fallback=saved.fallbackProfileId||'';fallbackEnabled=!!saved.fallbackEnabled;defaultId=saved.defaultProfileId||'';selected=defaultId||saved.modelProfiles[0]?.id||'';section='models';render();dialog.showModal();}catch(e){notice(e.message);}};
}
