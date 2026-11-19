import {initQaWindow} from './qa-window.js';
import {initSettings} from './settings.js';
import {watchAcpWorkflow} from './acp-workflow.js';
import {acpPanel,observeAcpJob} from './acp.js';
import {createReferenceReader} from './reference-reader.js';
import {scriptState,analysisState,weeklyState,taskKey} from './workflow.js';
import {createTranscriptReader} from './transcript.js';
import {createReader} from './reader.js';
import {QA_MODES,questionTarget} from './qa-scope.js';
const $=s=>document.querySelector(s);let current=null,projects=[],docName='PPT_Bilingual_Guide.md',busy=false,outputKey='',viewScope='preparation',askScope='week',selectedVersion='',surface='overview',askManual=false,askSessionId='';let surfaceState={overview:{scope:'preparation'},transcripts:{scope:'week'},analysis:{scope:'week'}};const weekChoices=new Map();let materialView='courseware',askKind='course',askSourceId='',askPage=0;
async function api(url,options={}){const response=await fetch(url,options);if(!response.ok){let data;try{data=await response.json();}catch{}throw Error(data?.error||`请求失败 ${response.status}`);}return response.headers.get('content-type')?.includes('application/json')?response.json():response.text();}
const post=async(url,value)=>{const result=await api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});if(result.acpJobId&&!url.endsWith('/ask'))watchAcpWorkflow(result.acpJobId,{api,post,notice});if(result.chatgptJobId&&url.endsWith('/process'))watchAcpWorkflow(result.chatgptJobId,{api,post,notice,transport:'chatgpt'});return result;};
function notice(text){$('#notice').textContent=text;$('#notice').hidden=!text;}
const endpoint=action=>`/api/projects/${encodeURIComponent(current.id)}/${action}`;
const importToggle=$('#toggle-import'),importPanel=$('#material-import');
const readingToolbars=[$('.reader-toolbar'),$('.reference-toolbar')];
for(const [index,toolbar] of readingToolbars.entries()){
 const left=document.createElement('div'),right=document.createElement('div'),more=index?document.createElement('details'):$('#reader-more');
 left.className='reading-toolbar-left';right.className='reading-toolbar-right';
 const select=index?$('#reference-file'):$('.reader-file-label');
 left.append(select);
 if(index){more.id='reference-more';more.innerHTML='<summary>更多</summary><div class="reading-menu-content"></div>';}
 more.classList.add('reading-more');
 more.addEventListener('keydown',event=>{if(event.key==='Escape'&&more.open){event.preventDefault();event.stopPropagation();more.open=false;more.querySelector('summary').focus();}});
 more.addEventListener('click',event=>{if(event.target.closest('#process,a'))more.open=false;});
 document.addEventListener('click',event=>{if(!more.contains(event.target))more.open=false;});

 const content=index?more.querySelector('div'):$('#reader-more-content');
 if(!index){
  more.querySelector('summary').textContent='更多';
  content.prepend($('.continuous-tools'),...$('.reader-display').querySelectorAll(':scope > label'),$('#reading-focus'),$('#reader-generation'));
  const trial=document.createElement('button');trial.type='button';trial.textContent='试解析本页';
  trial.onclick=()=>{more.open=false;previewPptPage();};
  content.append(trial);
  $('.reader-display').remove();
 }else content.append($('#reference-actions'),$('#reference-original'));
 const ask=document.createElement('button');
 ask.type='button';ask.className='reading-ask';ask.textContent='问这页';
 ask.onclick=()=>{more.open=false;const context=activeMaterialContext();if(context){askManual=false;askKind=context.file.role==='reading'?'reference':'courseware';askSourceId=context.file.id;askPage=context.focus.pageIndex;askScope='page';}renderChat();setQa(false,{focus:true});};
 const progress=document.createElement('span');progress.className='reading-task-status';progress.hidden=true;
 content.append(progress);right.append(ask,more);
 toolbar.prepend(left);toolbar.append(right);
 toolbar.adaptReadingLayout=()=>{
  if(!toolbar.clientWidth)return;
  const compact=toolbar.clientWidth<900,secondary=compact?content:right;
  for(const node of [ask]){
   if(node.parentElement!==secondary){if(compact)secondary.append(node);else right.insertBefore(node,more);}
  }
  const tabs=$('#material-tabs');
  if(toolbar.contains(tabs)){
   const tabsHome=toolbar.clientWidth<680?content:left;
   if(tabs.parentElement!==tabsHome)tabsHome.prepend(tabs);
  }
 };
 new ResizeObserver(toolbar.adaptReadingLayout).observe(toolbar);
}
importToggle.onclick=()=>{
 importPanel.hidden=!importPanel.hidden;
 importToggle.setAttribute('aria-expanded',String(!importPanel.hidden));
 if(!importPanel.hidden)importPanel.querySelector('.drop').focus({preventScroll:true});
};
const askDrafts=new Map(),askPending=new Map(),askErrors=new Map(),projectViews=new Map(),askAcpPanels=new Map();
let shownConversation='',shownMessages='',selectTicket=0;
const conversationKey=(id,target)=>JSON.stringify([id,target?.scope??null,target?.focus??null]);
const mineruRunning=p=>p?.status==='running'&&p.job?.mode==='reading';
const generationRunning=p=>p?.status==='running'&&!mineruRunning(p);
function saveDraft(){if(shownConversation)askDrafts.set(shownConversation,$('#question').value);}
const scopePicker=document.createElement('details');
scopePicker.className='ask-scope-picker';
const scopeSummary=document.createElement('summary');
scopeSummary.id='ask-context';
$('#ask-context').replaceWith(scopePicker);
scopePicker.append(scopeSummary,...document.querySelectorAll('.qa-scope'));
const moveAskDraft=document.createElement('button');
moveAskDraft.type='button';
moveAskDraft.className='ask-move-draft';
moveAskDraft.textContent='将草稿移到当前页';
moveAskDraft.hidden=true;
scopePicker.after(moveAskDraft);
$('.qa-intro').remove();
$('.qa-heading').insertBefore($('.qa-window-tools'),$('#qa-toggle'));
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function inline(text){
 const links=[];text=text.replace(/\[([^\]]+)\]\((\/api\/projects\/[^/\s)]+\/reading-reference\?ref=[A-Za-z0-9_-]+)\)/g,(all,label,url)=>{links.push('<a href="'+escape(url)+'" target="_blank" rel="noopener noreferrer">'+escape(label)+'</a>');return '\uE000'+(links.length-1)+'\uE001';});
 return escape(text).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\uE000(\d+)\uE001/g,(all,n)=>links[+n]||'');
}
function markdown(text){let code=false,list=false,html='';for(const line of text.split('\n')){if(line.startsWith('```')){if(list){html+='</ul>';list=false;}html+=code?'</pre>':'<pre>';code=!code;continue;}if(code){html+=escape(line)+'\n';continue;}const m=line.match(/^(#{1,6})\s+(.+)$/);if(m){if(list){html+='</ul>';list=false;}html+=`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`;continue;}if(/^\s*[-*]\s+/.test(line)){if(!list){html+='<ul>';list=true;}html+=`<li>${inline(line.replace(/^\s*[-*]\s+/,''))}</li>`;continue;}if(list){html+='</ul>';list=false;}if(line.startsWith('>'))html+=`<blockquote>${inline(line.slice(1))}</blockquote>`;else if(line.trim())html+=`<p>${inline(line)}</p>`;}if(list)html+='</ul>';if(code)html+='</pre>';return html;}
const scopeLabel=s=>s==='preparation'?'预习材料':s==='week'?'本周课':current?.sessions?.find(e=>e.id===s)?.title||'课堂记录';
function target(){if(surface==='reading'&&materialView==='reference')return current?.files.find(f=>f.id===referenceReader.sourceId())?.referenceTranslation;return viewScope==='preparation'?current?.preparation:viewScope==='week'?current?.weekly:current?.sessions?.find(s=>s.id===viewScope);}
function resultState(){
 if(surface==='reading'&&materialView==='reference')return referenceReader.state();
 if(viewScope==='preparation')return {available:!!current?.preparation?.generation,stale:!!current?.preparation?.generation&&current.preparation.materialRevision!==current.materialRevision};
 if(viewScope==='week')return weeklyState(current);
 return surface==='analysis'?analysisState(current,target()):scriptState(current,target());
}
function isStale(){return resultState().stale;}
const documents=()=>surface==='analysis'?(viewScope==='week'?[['Weekly_Deep_Dive.md','整周 Deep Dive']]:[['Deep_Dive.md','本节 Deep Dive']]):surface==='transcripts'?(viewScope==='week'?[]:[['Class_Script_Bilingual.md','双语课堂讲稿']]):[['PPT_Bilingual_Guide.md','PPT 逐页阅读']];
function currentMode(){return surface==='reading'?(materialView==='reference'?'reference':'preparation'):surface==='analysis'?(viewScope==='week'?'week':'analysis'):'session';}
function currentTask(){return current?.tasks?.[taskKey(currentMode(),currentMode()==='reference'?referenceReader.sourceId():viewScope)];}
function weeklyChoice(){const ready=current.sessions.filter(s=>s.generation).map(s=>s.id);if(!weekChoices.has(current.id)){const selected=new Set(current.weekly?.selectedSessionIds||ready);selected.known=new Set(ready);weekChoices.set(current.id,selected);}const selected=weekChoices.get(current.id);for(const id of ready)if(!selected.known.has(id)){selected.add(id);selected.known.add(id);}return selected;}
function renderPlan(){
 const panel=$('#analysis-plan');panel.hidden=surface!=='analysis';if(panel.hidden)return;
 const signature=JSON.stringify([current.id,viewScope,current.status,current.materialRevision,current.files.map(f=>[f.id,f.parsed,f.parseStatus]),current.sessions.map(s=>[s.id,s.generation,s.revision,s.title,s.materialRevision])]);
 if(panel.dataset.signature===signature)return;panel.dataset.signature=signature;panel.replaceChildren();
 const title=document.createElement('b');title.textContent=viewScope==='week'?'本次整周分析范围':'本节分析依据';panel.append(title);
 const materials=document.createElement('p');const ready=current.files.filter(f=>!['srt','audio'].includes(f.role)&&(f.parsed||f.role==='bb'&&!/\.pdf$/i.test(f.name)));const missing=current.files.filter(f=>!['srt','audio'].includes(f.role)&&!ready.includes(f));materials.className='hint';materials.textContent=`教学材料：${ready.length} 份可用${current.bbText?'，含 BB 介绍':''}。`+(missing.length?'未解析：'+missing.map(f=>f.name).join('、')+'；本次不会视为已读。':'');panel.append(materials);
 const sessions=viewScope==='week'?current.sessions:current.sessions.filter(s=>s.id===viewScope);
 for(const session of sessions){const label=document.createElement('label');label.className='analysis-session';const state=scriptState(current,session);if(viewScope==='week'){const input=document.createElement('input');input.type='checkbox';input.dataset.sessionId=session.id;input.checked=state.available&&weeklyChoice().has(session.id);input.disabled=!state.available||current.status==='running';input.onchange=()=>{input.checked?weeklyChoice().add(session.id):weeklyChoice().delete(session.id);};label.append(input);}const text=document.createElement('span');text.textContent=session.type+' · '+session.title+' — '+(!state.available?'尚无讲稿，不能纳入':state.stale?'讲稿待更新'+(viewScope==='week'?'；选择后将注明使用旧证据':'，请先更新讲稿'):'讲稿可用');label.append(text);panel.append(label);}
 const hint=document.createElement('p');hint.className='hint';hint.textContent=viewScope==='week'?'由你确认本周内容是否齐全，再点击生成；不会自动启动。未勾选课堂不纳入；没有课堂时仅分析教学材料。':'只使用本节课堂证据和本周相关教学材料，不自动纳入其他节课堂的发言。';panel.append(hint);
}
async function refreshList(){const scrollTop=$("#projects").scrollTop;projects=await api('/api/projects');$('#projects').replaceChildren();for(const p of projects){const row=document.createElement('div');row.className='project-row';const b=document.createElement('button');b.className='project'+(p.id===current?.id?' active':'');b.innerHTML=`${escape(p.name)}<small>${escape(p.weekDeletionPending?'删除未完成':p.status==='running'?'任务进行中':p.status==='error'?'上次任务未完成':'课程资料')} · ${p.sessions?.length||0} 节课堂</small>`;b.onclick=()=>select(p.id);const menu=itemMenu('管理整周课程 '+p.name),rename=menuAction('重命名整周课程',()=>openWeekRename(p.id)),remove=menuAction(p.weekDeletionPending?'继续删除整周课程':'删除整周课程',()=>openWeekDelete(p.id),true);rename.disabled=!!p.weekDeletionPending;menu.panel.append(rename,remove);row.append(b,menu.root);$('#projects').append(row);}$('#projects').scrollTop=scrollTop;}

async function select(id){
 if(busy)return notice('文件正在保存，请稍后切换。');
 const ticket=++selectTicket,next=await api(`/api/projects/${encodeURIComponent(id)}`);
 if(ticket!==selectTicket||busy)return;
 if(current)projectViews.set(current.id,{viewScope,surface,materialView,askKind,askSourceId,askPage,surfaceState,askScope,askManual,askSessionId,docName});
 saveDraft();
 reader.reset();referenceReader.reset();transcript.reset();current=next;
 localStorage.setItem('classroom-project',id);
 ({viewScope,surface,materialView,askKind,askSourceId,askPage,surfaceState,askScope,askManual,askSessionId,docName}=projectViews.get(id)||{
  viewScope:'preparation',surface:'overview',materialView:'courseware',askKind:'course',askSourceId:'',askPage:0,
  surfaceState:{overview:{scope:next.sessions[0]?.id||'preparation'},transcripts:{scope:next.sessions[0]?.id||'week'},analysis:{scope:'week'}},
  askScope:'week',askManual:false,askSessionId:next.sessions.length===1?next.sessions[0].id:'',docName:'PPT_Bilingual_Guide.md'
 });
 const readingTab=sessionStorage.getItem('classroom-reading-tab:'+id);
 if(!projectViews.has(id)&&['courseware','reference'].includes(readingTab)){
  surface='reading';materialView=readingTab;askKind=readingTab;askScope='page';
 }
 selectedVersion='';outputKey='';$('#bb').value=current.bbText||'';notice('');render();await refreshList();await loadDoc();
}
async function switchScope(scope){viewScope=scope;if(scope!=='preparation'&&scope!=='week'){askSessionId=scope;if(!askManual)askScope='session';}else if(!askManual)askScope=scope==='preparation'&&surface==='reading'?'page':'week';if(!askManual){askKind=surface==='reading'?(materialView==='reference'?'reference':'courseware'):'course';if(surface!=='reading'&&askScope==='page')askScope='week';}
 docName=documents()[0]?.[0]||'Class_Script_Bilingual.md';selectedVersion='';outputKey='';render();await loadDoc();}
function renderSurface(){
 const readingKey='classroom-reading-tab:'+current.id;
 if(surface==='reading')sessionStorage.setItem(readingKey,materialView);
 else sessionStorage.removeItem(readingKey);
 const reading=surface==='reading',transcripts=surface==='transcripts',analysis=surface==='analysis',overview=surface==='overview';
 document.body.classList.toggle('reading-surface',reading);document.body.classList.toggle('transcript-surface',transcripts);document.body.classList.toggle('analysis-surface',analysis);document.body.classList.toggle('focus-reading',reading&&localStorage.getItem('classroom-reading-focus')==='1');$('#reading-focus').textContent=document.body.classList.contains('focus-reading')?'退出专注':'专注阅读';$('#reading-focus').setAttribute('aria-pressed',String(document.body.classList.contains('focus-reading')));$('#course-overview').hidden=!overview;$('#transcript-controls-slot').hidden=overview;$('.lower').hidden=overview;
 for(const name of ['overview','reading','transcripts','analysis']){
  const tab=$('#surface-'+name),selected=surface===name;
  tab.classList.toggle('selected',selected);
  if(selected)tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current');
 }
 const materialTabs=$('#material-tabs'),materialToolbar=materialView==='reference'?$('.reference-toolbar'):$('.reader-toolbar');
 const empty=reading&&!current?.files.some(f=>f.role===(materialView==='reference'?'reading':'ppt'));
 const tabsParent=empty?$('.lower .output'):materialToolbar.querySelector('.reading-toolbar-left');
 if(materialTabs.parentElement!==tabsParent)tabsParent.prepend(materialTabs);
 materialTabs.hidden=!reading;$('#material-courseware').classList.toggle('selected',materialView==='courseware');$('#material-reference').classList.toggle('selected',materialView==='reference');$('#document-tabs').hidden=reading||overview||transcripts;$('#output-heading').hidden=reading||transcripts;
 const controls=$('#study-controls'),progress=$('.progress'),parent=overview?$('#course-overview'):$('#transcript-controls-slot');if(controls.parentElement!==parent)parent.append(controls,progress);controls.hidden=reading;progress.hidden=!current?.job;
 const taskHome=$('#task-actions'),statusHome=reading?(materialView==='reference'?$('#reference-actions'):$('#reader-generation')):taskHome;
 if($('#scope-status').parentElement!==statusHome)statusHome.append($('#scope-status'));
 const actionHome=reading?materialToolbar.querySelector('.reading-toolbar-right'):taskHome;
 if($('#process').parentElement!==actionHome){if(reading)actionHome.insertBefore($('#process'),actionHome.querySelector('.reading-ask')||actionHome.querySelector('.reading-more'));else actionHome.append($('#process'));}
 if(reading)materialToolbar.adaptReadingLayout();
 $('#view-preparation').hidden=!analysis;$('#view-week').hidden=!analysis;$('#session-select').parentElement.hidden=reading||analysis&&viewScope==='week';
 $('#task-heading').textContent=overview?'课堂与记录':reading?'PPT 逐页导读':analysis?'Deep Dive':'课堂讲稿';$('#add-session').hidden=!overview;$('#process').hidden=overview;
 const options=$('#output-options'),outputParent=reading?(materialView==='reference'?$('#reference-actions'):$('#reader-more-content')):overview?$('#output-heading'):$('#task-actions');if(options.parentElement!==outputParent)outputParent.append(options);
}
async function changeSurface(next){
 notice('');
 if(current&&surface!=='reading')surfaceState[surface]={scope:viewScope,docName,selectedVersion};surface=next;const state=surfaceState[next]||{scope:next==='analysis'?'week':'preparation'};let scope=next==='reading'?'preparation':state.scope;
 if(!['preparation','week',...current.sessions.map(s=>s.id)].includes(scope))scope=next==='overview'?'preparation':current.sessions[0]?.id||'week';
 if(next==='transcripts'&&['preparation','week'].includes(scope))scope=current.sessions[0]?.id||'week';
 if(next==='analysis'&&scope==='preparation')scope='week';
 await switchScope(scope);if(state.docName&&documents().some(([name])=>name===state.docName)){docName=state.docName;selectedVersion='';outputKey='';render();await loadDoc();}
}

function fillOptions(select,options,value){const signature=JSON.stringify(options);if(select.dataset.options!==signature){select.innerHTML=options.map(([id,text])=>`<option value="${escape(id)}">${escape(text)}</option>`).join('');select.dataset.options=signature;}if(select.value!==value)select.value=value;}
async function openReadingFile(file){
 const projectId=current.id;
 materialView=file.role==='reading'?'reference':'courseware';
 await changeSurface('reading');
 if(current?.id!==projectId||surface!=='reading')return;
 const select=$(file.role==='reading'?'#reference-file':'#reader-file');
 if(select.value!==file.id&&[...select.options].some(option=>option.value===file.id)){
  select.value=file.id;select.dispatchEvent(new Event('change'));
 }
}
const classList=document.createElement('div');
classList.className='class-list';classList.setAttribute('aria-label','课堂记录');
$('#study-controls>.section-title').after(classList);
function renderClassList(project,selected){
 classList.hidden=surface!=='overview';
 if(classList.hidden)return;
 classList.replaceChildren();
 if(!project.sessions.length){
  const empty=document.createElement('p');empty.className='empty';empty.textContent='添加课堂后，可上传字幕和录音。';classList.append(empty);
 }
 for(const session of project.sessions){
  const item=document.createElement('button'),script=scriptState(project,session);
  item.type='button';item.className='class-row';
  item.setAttribute('aria-pressed',String(selected?.id===session.id));
  item.innerHTML=`<span class="class-type">${escape(session.type)}</span><strong>${escape(session.title)}</strong><span class="class-row-date">${escape(session.date||'')}</span><span class="status" data-state="${script.available&&!script.stale?'ready':'pending'}">${script.available?(script.stale?'讲稿待更新':'讲稿已就绪'):session.srtId?'字幕已保存':'等待字幕'}</span><span aria-hidden="true">›</span>`;
  item.onclick=()=>switchScope(session.id).catch(e=>notice(e.message));
  const row=document.createElement('div');row.className='class-entry';
  const menu=itemMenu('管理课堂 '+session.title),pending=project.deletionPending?.sessionId;
  const rename=menuAction('重命名本节课',()=>openSessionRename(session.id));
  const remove=menuAction(pending===session.id?'继续删除本节课':'删除本节课',()=>openSessionDelete(session.id),true);
  rename.disabled=busy||generationRunning(project)||!!pending;
  remove.disabled=busy||generationRunning(project)||!!pending&&pending!==session.id;
  menu.panel.append(rename,remove);row.append(item,menu.root);classList.append(row);
 }
}
function renderFile(f,running){
 const isMaterial=['bb','ppt','reading'].includes(f.role);
 const pending=current.materialDeletionPending;
 let mineruAction,failedAction;
running||=f.parseStatus==='running';const row=document.createElement('div');row.className='file';row.dataset.fileId=f.id;row.innerHTML=`<div class="file-info"><b>${escape(f.name)}</b><small>${escape({bb:'课程说明',ppt:'课件',reading:'参考文献',srt:'SmartSub SRT',audio:'课堂录音'}[f.role])} · ${(f.size/1048576).toFixed(2)} MB<span data-file-progress>${f.progress?' · '+escape(f.progress):''}</span>${f.error?' · '+escape(f.error):''}</small></div><div class="file-actions"><span class="status ${f.parseStatus==='failed'?'failed':''}">${escape({'awaiting-json':'待 AI 解析',pending:f.role==='ppt'?'待 AI 解析':'待解析',running:'处理中',ready:['ppt','reading'].includes(f.role)?'JSON 已就绪':'已保存',manual:f.role==='ppt'?(f.importSummary?'AI 解析已收录':'JSON 已收录'):'已补入解析',failed:'等待补入'}[f.parseStatus])}</span><a href="${endpoint('source')}?id=${encodeURIComponent(f.id)}">原件 ↓</a></div>`;
 if(['ppt','reading','bb'].includes(f.role)&&/\.(pdf|pptx?)$/i.test(f.name)){const label=document.createElement('label'),select=document.createElement('select');label.className='material-purpose';select.setAttribute('aria-label','材料用途 · '+f.name);for(const [id,name] of [['ppt','课件'],['reading','参考文献'],['bb','课程说明']]){const o=document.createElement('option');o.value=id;o.textContent=name;select.append(o);}select.value=f.role;select.disabled=running||busy;select.onchange=async()=>{try{current=await post(endpoint('material-role'),{sourceId:f.id,role:select.value});referenceReader.reset();outputKey='';render();notice('材料用途已更新，原件名称和已有解析保持不变。');}catch(e){notice(e.message);}};label.append(select);row.querySelector('.file-actions').prepend(label);}
 if(['reading','bb'].includes(f.role)&&/\.pdf$/i.test(f.name)){
  const mineru=document.createElement('button');
  mineru.textContent=f.parseStatus==='running'?'MinerU 处理中':'MinerU 解析';
  mineru.disabled=running||busy;
  mineru.onclick=async()=>{
   const id=current.id;mineru.disabled=true;
   try{
    await post(endpoint('process'),{mode:'reading',sourceId:f.id});
    const next=await api('/api/projects/'+encodeURIComponent(id));
    if(current?.id===id){current=next;render();}
   }catch(e){if(current?.id===id)notice(e.message);mineru.disabled=false;}
  };
  mineruAction=mineru;row.querySelector('.file-actions').append(mineru);
 }
 if(['ppt','reading'].includes(f.role)||f.role==='bb'&&/\.pdf$/i.test(f.name)){const button=document.createElement('button');button.textContent=f.role==='ppt'?(f.parsed?'更换 AI 解析 JSON':'导入 AI 解析 JSON'):f.parsed?'更换解析结果':'导入补充解析';button.disabled=running||busy;button.onclick=()=>{const input=document.createElement('input');input.type='file';input.accept=f.role==='ppt'?'.json':'.json,.md,.txt';input.onchange=()=>{if(input.files[0])importParsed(f,input.files[0]);};input.click();};row.querySelector('.file-actions').append(button);}if(['ppt','reading'].includes(f.role)||f.role==='bb'&&/\.pdf$/i.test(f.name)){
  const action=document.createElement('button'),ongoing=f.aiParse?.status==='running';
  const reviewPending=f.role==='ppt'&&(f.aiParse?.review?.status==='pending'||f.aiParse?.completed>0&&f.aiParse.completed===f.aiParse.total&&/整课.*检查/.test(f.aiParse.error||''));
  action.className='parse-action';action.textContent=ongoing?'取消解析':reviewPending?'继续检查':f.aiParse?'继续 / 补全解析':f.role==='ppt'?'AI 解析 PPT':'AI 解析整份 PDF';
  action.disabled=busy||current.status==='running';action.onclick=async()=>{try{await post(endpoint(ongoing?'ai-parse-cancel':'ai-parse'),{sourceId:f.id});notice(ongoing?'正在取消；已完成页面会保留。':'解析任务已开始，可切换阅读页面，后台会继续。');current=await api('/api/projects/'+encodeURIComponent(current.id));render();}catch(e){notice(e.message);}};
  row.querySelector('.file-actions').prepend(action);
  const detail=document.createElement('details');detail.className='parse-details';detail.innerHTML='<summary>解析与缓存</summary>';const clear=document.createElement('button');clear.textContent='清理页面缓存';clear.disabled=running||busy;clear.onclick=async()=>{try{await post(endpoint('ai-cache-clear'),{sourceId:f.id});notice('页面缓存已清理，原件和当前解析结果保留。');}catch(e){notice(e.message);}};detail.append(clear);const fresh=document.createElement('button');fresh.textContent='重新解析全部';fresh.disabled=running||busy;fresh.onclick=async()=>{if(!confirm('这将重新识别全部页面并重置本次尝试次数，成功后替换当前结果。继续吗？'))return;try{await post(endpoint('ai-parse'),{sourceId:f.id,fresh:true});notice('已开始重新解析全部页面。');}catch(e){notice(e.message);}};detail.append(fresh);row.querySelector('.file-actions').append(detail);
  if(f.role==='ppt'&&f.aiParse?.total&&f.aiParse.completed===f.aiParse.total){for(const [part,label] of [['translation','只更新翻译'],['explanation','只更新解读']]){const button=document.createElement('button');button.type='button';button.textContent=label;button.disabled=running||busy;button.onclick=async()=>{try{await post(endpoint('ai-parse'),{sourceId:f.id,teachingPart:part});notice(label+'已开始，识别和另一项内容保持不变。');}catch(e){notice(e.message);}};row.querySelector('.parse-details').append(button);}}
  if(f.aiParse?.status!=='running'&&f.aiParse?.missing?.length){const retry=document.createElement('button');retry.textContent='再次尝试未完成页';retry.disabled=running||busy;retry.onclick=async()=>{try{await post(endpoint('ai-parse'),{sourceId:f.id,retryFailed:true});notice('仅为未完成页开始新一轮尝试；成功页保留。');}catch(e){notice(e.message);}};failedAction=retry;row.querySelector('.file-actions').append(retry);}
  if(f.aiParse?.completed||f.aiParse?.drafted||f.aiParse?.failed?.length){const preview=document.createElement('button');preview.textContent='查看逐页结果';preview.disabled=busy;preview.onclick=()=>showAIResults(f);row.querySelector('.file-actions').append(preview);}

  if(f.aiParse?.status!=='running'&&f.aiParse?.incomplete){const retry=document.createElement('button');retry.textContent=f.role==='ppt'?'主模型核对疑点页':'备用模型复核疑点页';retry.disabled=running||busy;retry.onclick=async()=>{try{await post(endpoint('ai-parse'),{sourceId:f.id,retryIssues:true});notice('正在重新识别有疑点的页面。');}catch(e){notice(e.message);}};row.querySelector('.file-actions').append(retry);}
  if(f.aiParse){const j=f.aiParse,progress=document.createElement('div');progress.className='parse-progress';const elapsed=Math.max(0,Math.round(((j.finished||Date.now())-j.started)/1000));progress.innerHTML=`<b>${escape(j.stage)}</b><span>页面准备 ${j.prepared||0}/${j.total||'?'} · AI 完成 ${j.completed||0}/${j.total||'?'} · ${elapsed} 秒</span>`;for(const [page,t] of Object.entries(j.tasks||{})){const line=document.createElement('small');line.textContent=`第 ${Number(page)+1} 页 · ${t.phase} · ${Math.round((Date.now()-t.at)/1000)} 秒`;progress.append(line);}for(const r of j.rounds||[]){const line=document.createElement('small');line.textContent=`${r.label}${r.model?' · '+r.model:''}：成功 ${r.success}/${r.total}${r.status==='not_configured'?'（未配置）':r.status==='configuration_error'?'（配置错误，已暂停）':''}`;progress.append(line);}
   if(j.review){const review=document.createElement('small');review.textContent=`整课检查 ${j.review.completed||0}/${j.review.total||0} 批 · ${j.review.status==='complete'?'已完成':'待处理 '+(j.review.issues?.length||0)+' 项；完整页面已发布'}`;progress.append(review);for(const item of (j.review.issues||[]).slice(0,3)){const issue=document.createElement('small');issue.textContent=`检查第 ${item.batch||'?'} 批：${item.error}`;progress.append(issue);}}
   if(j.incomplete){const issue=document.createElement('small');issue.textContent=j.incomplete+' 页有疑点，可下载解析 JSON 查看。';progress.append(issue);}if(j.pendingParts?.length){const pending=document.createElement('small');pending.textContent='待完成：'+j.pendingParts.map(p=>'第 '+p.page+' 页 '+p.parts.join('、')).join('；');progress.append(pending);}row.append(progress);}
 }
 if(f.externalAnalysis){const link=document.createElement('a');link.textContent='解析 JSON ↓';link.href=endpoint('analysis')+'?source='+encodeURIComponent(f.id);row.querySelector('.file-actions').append(link);}
 if(isMaterial){
  const actions=row.querySelector('.file-actions');
  const retry=pending?.sourceId===f.id;
  const remove=menuAction(retry?'继续删除材料':'删除材料',()=>openMaterialDelete(f.id),true);
  remove.disabled=!!pending&&!retry||(!retry&&(running||busy||f.aiParse?.status==='running'));
  if(retry){actions.replaceChildren(remove);row.querySelector('[data-file-progress]').textContent=' · 删除未完成';}
  else{
   const ai=actions.querySelector('.parse-action');
   const next=f.aiParse?.status==='running'?ai:failedAction||(f.parseStatus==='running'?mineruAction:!f.parsed&&(mineruAction||ai))||(f.aiParse?.review?.status==='pending'?ai:null);
   const menu=itemMenu('管理材料 '+f.name);
   for(const control of [...actions.children]){
    if(control===next||control.matches('.status,[href*="/source?"]'))continue;
    if(control.matches('.parse-details')){menu.panel.append(...control.querySelectorAll('button'));control.remove();}
    else menu.panel.append(control);
   }
   if(next)actions.append(next);
   menu.panel.append(remove);actions.append(menu.root);
  }
 }
 const type=f.role==='srt'?'SRT':f.role==='audio'?'音频':f.name.match(/\.(pdf|pptx?|md|txt)\b/i)?.[1]?.toUpperCase()||'文件';
 row.dataset.kind=f.role;
 const info=row.querySelector('.file-info'),icon=document.createElement('span');
 icon.className='file-type-icon';icon.setAttribute('aria-hidden','true');icon.textContent=type==='PPTX'?'PPT':type;
 row.insertBefore(icon,info);
 if(f.role==='ppt'||f.role==='reading'&&f.parsed){
  const name=info.querySelector('b'),open=document.createElement('button');
  open.type='button';open.className='file-title';open.textContent=f.name;
  open.title='打开材料阅读';open.onclick=()=>openReadingFile(f).catch(e=>notice(e.message));name.replaceWith(open);
 }
 const status=row.querySelector('.file-actions .status');
 if(status)status.dataset.state=f.error?'error':f.aiParse?.status==='running'?'running':f.parseStatus;
 return row;
}
function render(){
 if(current?.weekDeletionPending||current?.materialDeletionPending){viewScope='preparation';surface='overview';}renderSurface();const p=current;$('#welcome').hidden=!!p;$('#workspace').hidden=!p;if(!p)return;
 $('#title').textContent=p.name;$('#subtitle').textContent='本周材料共用 · 讲稿、本节分析、整周分析分别生成';
 const materials=p.files.filter(f=>!['srt','audio'].includes(f.role));
 $('#collection-summary').textContent=`${materials.length} 份教学材料 · ${p.sessions.length} 节课堂`;
 const running=generationRunning(p)||p.files.some(f=>f.aiParse?.status==='running')||!!p.weekDeletionPending,session=p.sessions.find(s=>s.id===viewScope),a=target();if($('#ai-results-dialog').open)$('#ai-results-accept').disabled=running||busy;
 renderClassList(p,session);
 $('#save-bb').disabled=running||busy;$('#add-session').disabled=running||busy;document.querySelectorAll('.drop input').forEach(i=>i.disabled=running||busy||(['srt','audio-upload'].includes(i.id)&&!session));
 const waitingPpt=p.files.filter(f=>f.role==='ppt'&&!f.parsed);$('#ppt-import-needed').textContent=waitingPpt.length?`${waitingPpt.length} 份 PPT 尚未解析；可在材料行解析，或在 PPT 阅读生成导读。`:'';
 const mode=currentMode(),script=scriptState(p,session),ready=resultState().available;
 const processButton=$('#process'),currentJob=currentTask()?.status==='running',referenceState=mode==='reference'?referenceReader.state():null;
 processButton.disabled=!!p.deletionPending||running||mineruRunning(p)||busy||(mode==='session'&&!session?.srtId)||(mode==='analysis'&&(!script.available||script.stale))||(mode==='reference'&&!current.files.some(f=>f.id===referenceReader.sourceId()&&f.parsed));
 if(referenceState?.available&&!referenceState.pending&&!referenceState.stale&&!referenceState.needsPublish)processButton.disabled=true;
 processButton.classList.toggle('primary',!ready||!!referenceState?.pending);
 for(const toolbar of readingToolbars){
  const progress=toolbar.querySelector('.reading-task-status');
  const active=surface==='reading'&&currentJob&&toolbar===readingToolbars[materialView==='reference'?1:0];
  progress.hidden=!active;if(active)progress.textContent=mode==='reference'?'翻译中':'生成中';
 }
 const retryScript=mode==='session'&&['error','interrupted'].includes(currentTask()?.status);
 const actionLabel=mode==='reference'?'文献翻译':mode==='preparation'?'课件导读':mode==='week'?'整周 Deep Dive':mode==='analysis'?'本节 Deep Dive':'本节讲稿';
 processButton.textContent=currentJob?'正在处理…':retryScript?'重试本节讲稿':referenceState?.pending?'补译剩余':referenceState?.needsPublish?'保存译文':referenceState?.available&&!referenceState.stale?'文献翻译':(ready?'更新':'生成')+actionLabel+' ↗';
 $('#scope-status').hidden=surface==='reading'||mode==='reference'&&ready&&!resultState().stale;
 $('#view-preparation').classList.toggle('selected',viewScope!=='week');$('#view-week').classList.toggle('selected',viewScope==='week');
 fillOptions($('#session-select'),[['','选择课堂…'],...p.sessions.map(s=>[s.id,`${s.type} · ${s.title}${s.date?' · '+s.date:''}`])],session?session.id:'');
 $('#session-panel').hidden=!session||surface!=='overview';$('#to-session-upload').hidden=surface==='overview'||!session;$('#output-heading h2').textContent=surface==='transcripts'?(session?session.type+' · '+session.title:'请先添加课堂'):session?session.type+' · '+session.title+' · Deep Dive':'整周 Deep Dive';$('#session-files').replaceChildren();if(session){for(const f of p.files.filter(f=>f.sessionId===session.id)){$('#session-files').append(renderFile({...f,name:f.name+(f.role==='srt'?(f.id===session.srtId?'（当前字幕）':'（保留的旧字幕）'):f.role==='audio'?(f.id===session.audio?.fileId?'（当前录音）':'（保留的旧录音）'):'')},running));}}
 $('#scope-description').textContent=surface==='overview'?'先上传本周材料，再为每节课补充 SRT 和录音。':surface==='reading'?'完整逐页导读；生成后即结束，不自动生成任何 Deep Dive。':surface==='analysis'?(viewScope==='week'?'确认本周资料齐全后，手动生成整周综合分析。':'本节分析独立生成，不重新生成讲稿或整周分析。'):'只生成本节双语讲稿，保持课堂顺序；不会自动生成分析。';
 const state=resultState(),task=currentTask();$('#scope-status').textContent=surface==='overview'?(session?'为这节课保存字幕与录音。':'添加并选择一节课以补充课堂记录。'):mode==='analysis'&&(!script.available||script.stale)?'请先生成或更新本节讲稿。':state.stale?'输入已变化，当前结果待更新；已有结果仍可阅读。':state.available?'当前结果可用。':'尚未生成；不会自动启动。';
 const matchingJob=p.job?.mode===mode&&(!['session','analysis','reference'].includes(mode)||(mode==='reference'?p.job.sourceId===referenceReader.sourceId():p.job.sessionId===viewScope));const taskNeedsAttention=['error','interrupted'].includes(task?.status)||matchingJob&&(p.status==='running'||!!p.error||!!p.warnings?.length);$('.progress').hidden=surface==='reading'||!taskNeedsAttention;$('#process').title=mineruRunning(p)?'本周材料解析完成后可启动生成。':$('#scope-description').textContent;
 $('#stage').textContent=['error','interrupted'].includes(task?.status)?(retryScript&&task.stage?'讲稿未完成 · '+task.stage:'本次任务未完成；已有结果保留'):matchingJob?p.stage:task?.status==='complete'?'本项任务已完成':'尚未开始';$('#error').textContent=(task?.error||(matchingJob?p.error:'' )||'')+((task?.warnings||matchingJob&&p.warnings)?.length?' 提示：'+(task?.warnings||p.warnings).join('；'):'');$('#coverage').textContent=surface==='transcripts'&&session?.coverage?`本节字幕编号覆盖 ${session.coverage.covered}/${session.coverage.cues} · ${session.coverage.segments} 段`+(session.contentAudit?.length?' · '+session.contentAudit.length+' 段内容需核对':''):'';
 const titles=mode==='preparation'?['解析材料','构建课程上下文','生成预习']:mode==='reference'?['参考文献翻译']:mode==='session'?['构建课程上下文','重建课堂','生成双语讲稿']:['构建课程上下文','Deep Dive · 建立 Reading','Deep Dive · 确定核心问题','Deep Dive · 按问题回到 Reading','Deep Dive · 围绕问题'];const index=matchingJob?titles.findIndex(t=>p.stage?.startsWith(t)):-1;$('#steps').innerHTML=titles.map((t,i)=>`<span class="${task?.status==='complete'?'complete':i===index?'current':i<index?'complete':''}">${t}</span>`).join('');renderPlan();
 $('#parallel-tasks').replaceChildren();if(p.parallel&&running){const summary=document.createElement('p');summary.className='hint';summary.textContent=`${p.parallel.phase}：完成 ${p.parallel.completed}/${p.parallel.total}；活动 ${p.parallel.active}/${p.parallel.limit}；失败 ${p.parallel.failed}`;$('#parallel-tasks').append(summary);for(const label of p.parallelTasks||[]){const item=document.createElement('div');item.className='hint';item.textContent='处理中 · '+label;$('#parallel-tasks').append(item);}}
 $('#files').replaceChildren();
 for(const file of materials)$('#files').append(renderFile(file,running));
 if(p.materialDeletionPending&&!materials.some(file=>file.id===p.materialDeletionPending.sourceId)){
  $('#files').append(menuAction('继续删除材料',()=>openMaterialDelete(p.materialDeletionPending.sourceId),true));
 }
 if(!materials.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='添加课件、参考文献或课程说明后，会显示在这里。';$('#files').append(empty);}
 $('#document-tabs').replaceChildren();for(const [name,label] of documents()){const button=document.createElement('button');button.textContent=label;button.className=docName===name?'selected':'';button.onclick=async()=>{docName=name;outputKey='';render();await loadDoc();};$('#document-tabs').append(button);}
 renderChat();
 syncAskAvailability();
}
async function loadDoc(){const transcriptMode=surface==='transcripts'&&docName==='Class_Script_Bilingual.md'&&!!target()?.generation;if(!transcriptMode)transcript.show(false);const reading=surface==='reading'&&viewScope==='preparation';if(reading&&materialView==='reference'){await reader.show(false);await referenceReader.show(true);$('#doc').hidden=true;$('.lower').classList.add('reading-mode');const f=current.files.find(f=>f.id===referenceReader.sourceId());$('#download').hidden=!referenceReader.state().available;if(f&&referenceReader.state().available)$('#download').href=endpoint('output')+'?scope='+encodeURIComponent('reference:'+f.id)+'&name=Bilingual.md&download=1';return;}await referenceReader.show(false);if(surface==='overview'){await reader.show(false);return;}$('.lower').classList.toggle('reading-mode',reading);$('#doc').hidden=reading;await reader.show(reading);const a=target();if(reading){$('#download').hidden=!a?.generation;if(a?.generation)$('#download').href=endpoint('output')+'?scope=preparation&name=PPT_Bilingual_Guide.md'+(selectedVersion?'&version='+encodeURIComponent(selectedVersion):'')+'&download=1';return;}if(!resultState().available||surface==='transcripts'&&!current.sessions.some(s=>s.id===viewScope)){$('#doc').className='markdown empty';$('#doc').textContent=surface==='transcripts'&&!current.sessions.length?'先在本周材料添加课堂并上传 SRT。':'当前结果尚未生成，请点击本页生成按钮。';$('#download').hidden=true;return;}const key=current.id+target()?.title+viewScope+(selectedVersion||(surface==='analysis'&&viewScope!=='week'?a.analysis?.generation:a.generation)||a.generation)+docName;if(key===outputKey){if(transcriptMode){const ok=await transcript.load(current,target(),selectedVersion);$('#doc').hidden=ok;}return;}const id=current.id,name=docName,scope=viewScope;const url=endpoint('output')+'?scope='+encodeURIComponent(scope)+'&name='+encodeURIComponent(name)+(selectedVersion?'&version='+encodeURIComponent(selectedVersion):'');const text=await api(url);if(current?.id!==id||docName!==name||viewScope!==scope)return;$('#doc').className='markdown';$('#doc').innerHTML=markdown(text);if(transcriptMode){const ok=await transcript.load(current,target(),selectedVersion);$('#doc').hidden=ok;}$('#download').hidden=false;$('#download').href=url+'&download=1';outputKey=key;}
async function saveBB(){if(!current)return;current=await post(endpoint('bb'),{text:$('#bb').value});render();}
async function upload(role,files){if(!current||busy||current.status==='running')return;if(['srt','audio'].includes(role)&&!current.sessions.some(s=>s.id===viewScope))return notice('请先添加并选择一节课，再补充 SRT。');busy=true;render();try{for(const file of files){notice(`正在保存 ${file.name}…`);current=role==='audio'?await uploadAudio(file):await api(endpoint('upload'),{method:'POST',headers:{'X-File-Name':encodeURIComponent(file.name),'X-File-Role':role,...(role==='srt'?{'X-Session-Id':viewScope}:{})},body:file});}notice(current.lastUpload?.kind==='reused'?'相同内容已存在，复用 '+current.lastUpload.name:current.lastUpload?.kind==='renamed'?'同名文件内容不同，已另存为 '+current.lastUpload.name:role==='srt'?'本节课字幕已保存；本周教学材料继续复用。':'教学材料已按原名保存。');await reader.refresh();}catch(e){notice(e.message);}finally{busy=false;render();await loadDoc();}}
async function importParsed(f,file){busy=true;render();try{current=await api(endpoint('parsed')+'?source='+encodeURIComponent(f.id),{method:'POST',headers:{'X-Parse-Format':file.name.toLowerCase().endsWith('.json')?'json':'text'},body:file});notice(f.role==='ppt'?'PPT 解析 JSON 已收录。完整 Skill 报告已核对原件指纹；旧格式按内容列表收录。可生成预习或整理课堂。':'补充解析已收录。原件保留；相关文档可重新生成。');}catch(e){notice(e.message);}finally{busy=false;render();}}
function activeMaterialContext(){return materialView==='reference'?referenceReader.context():reader.context();}
function askTarget(){if(askKind==='course')return questionTarget({mode:askScope==='session'?'session':'week',sessionId:askSessionId,sessions:current.sessions});const role=askKind==='reference'?'reading':'ppt',context=activeMaterialContext(),sourceId=askSourceId||context?.file.id||current.files.find(f=>f.role===role)?.id,file=current.files.find(f=>f.id===sourceId&&f.role===role);if(!file)throw Error('请先选择要提问的材料。');return {scope:'preparation',focus:{kind:askScope==='page'?'page':'file',sourceId:file.id,...(askScope==='page'?{pageIndex:askPage}:{} )}};}
function askUnavailable(target){
 if(current?.deletionPending||current?.weekDeletionPending)return '请先完成课程清理。';
 const file=current?.files.find(f=>f.id===target?.focus?.sourceId);
 if(file&&!file.parsed)return file.parseStatus==='running'?'这份文件正在解析，结果就绪后即可提问。':'请先完成所选材料的解析。';
 return '';
}
function syncAskAvailability(){
 let reason='',pending=false;
 try{const chosen=askTarget();reason=askUnavailable(chosen);pending=askPending.has(conversationKey(current.id,chosen));}
 catch(e){reason=e.message;}
 $('#ask').disabled=pending||!!reason;
 $('#ask').textContent=pending?'等待回复…':'提问 ↗';
 $('#ask').title=reason;
 $('#question').placeholder=reason||'输入问题';
}
function renderChat(){
 if(!current)return;
 const context=surface==='reading'?activeMaterialContext():null;
 const nextKey=context?conversationKey(current.id,{scope:'preparation',focus:context.focus}):'';
 const currentKey=conversationKey(current.id,{scope:'preparation',focus:{kind:'page',sourceId:askSourceId,pageIndex:askPage}});
 const pinned=!!context&&!askManual&&askScope==='page'&&shownConversation===currentKey&&!!$('#question').value.trim()&&nextKey!==currentKey;
 if(context&&!askManual&&!pinned){askKind=context.file.role==='reading'?'reference':'courseware';askSourceId=context.file.id;askPage=context.focus.pageIndex;askScope='page';}
 moveAskDraft.hidden=!pinned;
 moveAskDraft.disabled=!!askDrafts.get(nextKey)?.trim();
 moveAskDraft.title=moveAskDraft.disabled?'当前页已有草稿，请从范围菜单切换。':'';
 $('#ask-kind').value=askKind;fillOptions($('#ask-scope'),askKind==='course'?[['session','本节课'],['week','本周课']]:[['page','当前页'],['file','整份材料']],askKind==='course'?(askScope==='session'?'session':'week'):(askScope==='page'?'page':'file'));
 $('#ask-session-label').hidden=askKind!=='course'||askScope!=='session';fillOptions($('#ask-session'),[['','选择本节课…'],...current.sessions.map(s=>[s.id,s.type+' · '+s.title])],askSessionId);
 const role=askKind==='reference'?'reading':'ppt',files=current.files.filter(f=>f.role===role);if(!files.some(f=>f.id===askSourceId))askSourceId=files[0]?.id||'';$('#ask-file-label').hidden=askKind==='course';$('#ask-page-label').hidden=askKind==='course'||askScope!=='page';fillOptions($('#ask-file'),[['','选择材料…'],...files.map(f=>[f.id,f.name])],askSourceId);$('#ask-page').value=askPage+1;
 $('#ask-context').textContent=askKind==='course'?(askScope==='session'?'本节课：'+(current.sessions.find(s=>s.id===askSessionId)?.title||'请选择课堂'):'本周课：'+current.name):(current.files.find(f=>f.id===askSourceId)?.name||'请选择材料')+(askScope==='page'?' · 第 '+(askPage+1)+' 页':' · 仅检索此文件');
 let chosen;try{chosen=askTarget();}catch{}
 const key=conversationKey(current.id,chosen),changed=key!==shownConversation;
 if(changed){saveDraft();shownConversation=key;$('#question').value=askDrafts.get(key)||'';}
 const chat=$('#chat'),pending=askPending.get(key),error=askErrors.get(key);
 const messages=(current.chat||[]).filter(e=>chosen&&(e.scope||'week')===chosen.scope&&JSON.stringify(e.focus||null)===JSON.stringify(chosen.focus||null));
 const signature=JSON.stringify([key,messages,pending,error]);
 if(signature!==shownMessages){
  const scroll=chat.scrollTop,atEnd=chat.scrollHeight-chat.clientHeight-scroll<36;
  chat.replaceChildren();
  if(!messages.length&&!pending)chat.innerHTML='<p class="empty">针对所选范围提问。</p>';
  for(const entry of messages){
   const item=document.createElement('div');item.className='message '+entry.role;
   item.innerHTML=`<b>${entry.role==='user'?'你':'Classroom'}</b><div class="markdown">${markdown(entry.text)}</div>`;
   chat.append(item);
  }
  if(pending||error){
   const item=document.createElement('p');item.className=pending?'hint':'error';
   item.textContent=pending?'正在回答：'+pending:error;chat.append(item);
  }
  if(askAcpPanels.has(key))chat.append(askAcpPanels.get(key));
  chat.scrollTop=changed||atEnd?chat.scrollHeight:scroll;
  shownMessages=signature;
 }
 syncAskAvailability();
}
moveAskDraft.onclick=()=>{
 const question=$('#question'),draft=question.value,previous=shownConversation;
 question.value='';
 renderChat();
 if(shownConversation!==previous)askDrafts.delete(previous);
 question.value=draft;
 question.focus();
};
$('#question').addEventListener('input',()=>{if(!$('#question').value.trim())renderChat();});
const transcript=createTranscriptReader({api,post,endpoint,escape,notice,onProject:p=>{current=p;render();}});
function uploadAudio(file){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST',endpoint('audio-upload'));xhr.setRequestHeader('X-File-Name',encodeURIComponent(file.name));xhr.setRequestHeader('X-Session-Id',viewScope);xhr.upload.onprogress=e=>notice(`正在保存录音 ${file.name} · ${(e.loaded/1048576).toFixed(1)} MB${e.lengthComputable?' / '+(e.total/1048576).toFixed(1)+' MB':''}`);xhr.upload.onload=()=>notice('录音已传输，正在核对并保存原件…');xhr.onload=()=>{try{const result=JSON.parse(xhr.responseText);if(xhr.status>=400)throw Error(result.error||'录音保存失败。');resolve(result);}catch(e){reject(e);}};xhr.onerror=()=>reject(Error('录音上传中断，请检查本地服务并重试。'));xhr.send(file);});}
const referenceReader=createReferenceReader({api,project:()=>current,endpoint,onContext:()=>{render();if(surface==='reading'&&materialView==='reference'){const f=current.files.find(f=>f.id===referenceReader.sourceId());$('#download').hidden=!referenceReader.state().available;if(f&&referenceReader.state().available)$('#download').href=endpoint('output')+'?scope='+encodeURIComponent('reference:'+f.id)+'&name=Bilingual.md&download=1';}},onError:notice});
const reader=createReader({api,post,project:()=>current,endpoint,markdown,escape,version:()=>selectedVersion,onContext:()=>renderChat(),onError:message=>notice(typeof message==='string'?message:message.message)});
function setSidebar(collapsed){document.body.classList.toggle('sidebar-collapsed',collapsed);$('#sidebar-toggle').setAttribute('aria-label',collapsed?'展开课程列表':'收起课程列表');$('#sidebar-toggle').setAttribute('aria-expanded',String(!collapsed));$('#sidebar-toggle').title=collapsed?'展开课程列表':'收起课程列表';localStorage.setItem('classroom-sidebar-collapsed',collapsed?'1':'0');dispatchEvent(new Event('resize'));}
$('#sidebar-toggle').onclick=()=>setSidebar(!document.body.classList.contains('sidebar-collapsed'));setSidebar(localStorage.getItem('classroom-sidebar-collapsed')!=='0');
function setQa(collapsed,{focus=false}={}){
 document.body.classList.toggle('qa-open',!collapsed);
 $('#qa-toggle').setAttribute('aria-expanded',String(!collapsed));
 $('#qa-launch').setAttribute('aria-expanded',String(!collapsed));
 localStorage.setItem('classroom-qa-collapsed',collapsed?'1':'0');
 dispatchEvent(new Event('qa-resized'));
 if(focus)$(collapsed?'#qa-launch':'#question').focus({preventScroll:true});
}
$('#qa-toggle').onclick=()=>setQa(true,{focus:true});
$('#qa-launch').onclick=()=>setQa(false,{focus:true});
setQa(localStorage.getItem('classroom-qa-collapsed')!=='0');initQaWindow();
addEventListener('keydown',event=>{
 if(event.key!=='Escape'||event.defaultPrevented||document.querySelector('dialog[open]')||!document.body.classList.contains('qa-open'))return;
 event.preventDefault();setQa(true,{focus:true});
});
$('#surface-overview').onclick=()=>changeSurface('overview').catch(e=>notice(e.message));
$('#surface-reading').onclick=()=>changeSurface('reading').catch(e=>notice(e.message));
$('#reading-focus').onclick=()=>{const enabled=!document.body.classList.contains('focus-reading');localStorage.setItem('classroom-reading-focus',enabled?'1':'0');render();dispatchEvent(new Event('resize'));};
$('#surface-transcripts').onclick=()=>changeSurface('transcripts').catch(e=>notice(e.message));
for(const [id,kind] of [['material-courseware','courseware'],['material-reference','reference']])$('#'+id).onclick=async()=>{materialView=kind;askManual=false;outputKey='';render();await loadDoc();render();};
$('#surface-analysis').onclick=()=>changeSurface('analysis').catch(e=>notice(e.message));


function create(){if(busy)return;$('#create-dialog').showModal();$('#project-name').focus();}
$('#new-project').onclick=create;$('#welcome-new').onclick=create;$('#create-close').onclick=()=>$('#create-dialog').close();
$('#create-form').onsubmit=async e=>{e.preventDefault();try{const p=await post('/api/projects',{name:$('#project-name').value});$('#create-dialog').close();$('#project-name').value='';await select(p.id);}catch(e){notice(e.message);}};
$('#save-bb').onclick=()=>saveBB().then(()=>notice('BB 信息已保存。')).catch(e=>notice(e.message));
for(const drop of document.querySelectorAll('.drop')){const input=drop.querySelector('input'),role=drop.dataset.role;drop.tabIndex=0;drop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click();}};input.onchange=()=>{upload(role,[...input.files]);input.value='';};drop.ondragover=e=>{e.preventDefault();drop.classList.add('over');};drop.ondragleave=()=>drop.classList.remove('over');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('over');upload(role,[...e.dataTransfer.files]);};}
$('#view-preparation').onclick=()=>switchScope(current.sessions[0]?.id||'week').catch(e=>notice(e.message));$('#view-week').onclick=()=>switchScope('week').catch(e=>notice(e.message));$('#session-select').onchange=()=>{if($('#session-select').value)switchScope($('#session-select').value).catch(e=>notice(e.message));};
$('#add-session').onclick=()=>$('#session-dialog').showModal();$('#session-close').onclick=()=>$('#session-dialog').close();
$('#session-form').onsubmit=async e=>{e.preventDefault();try{const result=await post(endpoint('sessions'),{type:$('#session-type').value,title:$('#session-title').value,date:$('#session-date').value});current=result.project;$('#session-dialog').close();$('#session-title').value='';await switchScope(result.session.id);await refreshList();}catch(e){notice(e.message);}};
let weekActionId='';
function bindItemMenu(root){
 const trigger=root.querySelector('.item-trigger'),panel=root.querySelector('.item-popover');
 trigger.innerHTML='<svg class="app-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>';
 trigger.onclick=()=>{
  if(panel.matches(':popover-open')){panel.hidePopover();return;}
  panel.showPopover({source:trigger});
  const anchor=trigger.getBoundingClientRect(),size=panel.getBoundingClientRect(),gap=6;
  panel.style.left=Math.max(8,Math.min(anchor.right-size.width,innerWidth-size.width-8))+'px';
  panel.style.top=Math.max(8,anchor.bottom+size.height+gap<innerHeight-8?anchor.bottom+gap:anchor.top-size.height-gap)+'px';
 };
 panel.addEventListener('toggle',()=>trigger.setAttribute('aria-expanded',String(panel.matches(':popover-open'))));
 panel.addEventListener('click',event=>{if(event.target.closest('button,a')&&panel.matches(':popover-open'))panel.hidePopover();});
 return {root,panel};
}
function itemMenu(label){
 const root=document.createElement('div');
 root.className='item-actions';
 root.innerHTML='<button type="button" class="item-trigger" aria-expanded="false"></button><div class="item-popover" popover="auto"></div>';
 root.querySelector('button').setAttribute('aria-label',label);
 return bindItemMenu(root);
}
function menuAction(label,handler,danger=false){
 const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=handler;
 if(danger)button.className='danger-text';
 return button;
}
function closeItemMenus(event){
 if(event?.target instanceof Element&&event.target.closest('.item-popover'))return;
 for(const panel of document.querySelectorAll('.item-popover:popover-open'))panel.hidePopover();
}
document.addEventListener('scroll',closeItemMenus,true);
window.addEventListener('resize',()=>closeItemMenus());

let materialDeleteTarget;
async function openMaterialDelete(sourceId){
 if(busy||!current)return;
 const id=current.id;
 try{
  const summary=await api(endpoint('material-delete-plan')+'?source='+encodeURIComponent(sourceId));
  if(current?.id!==id)return;
  materialDeleteTarget={id,sourceId};
  $('#delete-material-name').textContent=summary.name;
  $('#delete-material-scope').textContent='将清理这份材料的解析、缓存、翻译和解读。'+(summary.sharedOriginal?'原件仍有其他材料引用，会保留原件。':'本地原件也会一并删除。');
  $('#delete-material-error').textContent='';
  $('#delete-material-dialog').showModal();
  $('#delete-material-cancel').focus();
 }catch(e){notice(e.message);}
}
$('#delete-material-cancel').onclick=()=>$('#delete-material-dialog').close();
$('#delete-material-confirm').onclick=async()=>{
 if(busy||!materialDeleteTarget)return;
 const {id,sourceId}=materialDeleteTarget,url='/api/projects/'+encodeURIComponent(id);
 const confirmButton=$('#delete-material-confirm'),cancelButton=$('#delete-material-cancel'),dialog=$('#delete-material-dialog');
 busy=true;confirmButton.disabled=true;cancelButton.disabled=true;confirmButton.textContent='正在删除…';
 try{
  const next=await post(url+'/material-delete',{sourceId,confirm:true});
  dialog.close();
  if(current?.id===id){
   if(reader.context()?.file.id===sourceId)reader.reset();
   if(referenceReader.sourceId()===sourceId)referenceReader.reset();
   if(askSourceId===sourceId){askSourceId='';askPage=0;}
   current=next;outputKey='';render();await loadDoc();
  }
  await refreshList();
  notice('材料及其专属数据已删除。');
 }catch(e){
  if(current?.id===id){try{current=await api(url);render();}catch{}}
  $('#delete-material-error').textContent=e.message;
  if(!dialog.open)notice(e.message);
 }finally{
  busy=false;confirmButton.disabled=false;cancelButton.disabled=false;confirmButton.textContent='永久删除材料';render();
 }
};
$('#delete-material-dialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});

async function openWeekRename(id){if(busy)return notice('当前请求尚未完成，请稍后操作。');const p=projects.find(p=>p.id===id)||current;if(!p)return;weekActionId=id;$('#rename-week-name').value=p.name;$('#rename-week-dialog').showModal();$('#rename-week-name').focus();}
async function openWeekDelete(id){if(busy)return notice('当前请求尚未完成，请稍后操作。');try{const summary=await api('/api/projects/'+encodeURIComponent(id)+'/week-delete-plan');weekActionId=id;$('#delete-week-summary').textContent=`${summary.name}：${summary.sessions} 节课堂、${summary.materials} 份教学材料、${summary.subtitles} 份字幕、${summary.recordings} 份录音。`;$('#delete-week-dialog').showModal();}catch(e){notice(e.message);}}
$('#rename-week-cancel').onclick=()=>$('#rename-week-dialog').close();$('#delete-week-cancel').onclick=()=>$('#delete-week-dialog').close();
$('#rename-week-form').onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;try{const p=await post('/api/projects/'+encodeURIComponent(weekActionId)+'/week-rename',{name:$('#rename-week-name').value});if(current?.id===p.id){current=p;outputKey='';render();await loadDoc();}$('#rename-week-dialog').close();await refreshList();notice('整周课程名称已更新。');}catch(e){notice(e.message);}finally{busy=false;render();}};
$('#delete-week-confirm').onclick=async()=>{if(busy)return;busy=true;$('#delete-week-confirm').disabled=true;const id=weekActionId,selected=current?.id===id;if(selected){transcript.reset();reader.reset();}try{await post('/api/projects/'+encodeURIComponent(id)+'/week-delete',{confirm:true});localStorage.removeItem('classroom-reader:'+id);if(selected){transcript.reset();reader.reset();current=null;outputKey='';viewScope='preparation';surface='overview';$('#chat').replaceChildren();$('#doc').replaceChildren();$('#bb').value='';localStorage.removeItem('classroom-project');}$('#delete-week-dialog').close();await refreshList();if(selected){busy=false;if(projects.length)await select(projects[0].id);else render();}notice('整周课程及全部本地数据已删除。');}catch(e){$('#delete-week-dialog').close();if(selected){try{current=await api('/api/projects/'+encodeURIComponent(id));}catch{}}await refreshList().catch(()=>{});notice(e.message);}finally{busy=false;$('#delete-week-confirm').disabled=false;render();}};
$('#to-session-upload').onclick=()=>{surfaceState.overview={scope:viewScope};changeSurface('overview').catch(e=>notice(e.message));};
let renameTarget='';function openSessionRename(id){const session=current.sessions.find(s=>s.id===id);if(!session)return;renameTarget=id;$('#rename-title').value=session.title;$('#rename-dialog').showModal();$('#rename-title').focus();};
$('#rename-cancel').onclick=()=>$('#rename-dialog').close();$('#rename-form').onsubmit=async e=>{e.preventDefault();try{current=await post(endpoint('session-rename'),{sessionId:renameTarget,title:$('#rename-title').value});$('#rename-dialog').close();outputKey='';render();await loadDoc();notice('课堂名称已更新。');}catch(e){notice(e.message);}};
let deleteTarget='';async function openSessionDelete(id){try{deleteTarget=id;const summary=await api(endpoint('session-delete-plan')+'?session='+encodeURIComponent(deleteTarget));$('#delete-summary').textContent=`${summary.title}：${summary.subtitles} 份字幕、${summary.recordings} 份录音、${summary.versions?1:0} 组当前输出。`;$('#delete-dialog').showModal();}catch(e){notice(e.message);}};
$('#delete-cancel').onclick=()=>$('#delete-dialog').close();$('#delete-confirm').onclick=async()=>{if(busy)return;busy=true;$('#delete-confirm').disabled=true;transcript.reset();reader.reset();try{current=await post(endpoint('session-delete'),{sessionId:deleteTarget,confirm:true});$('#delete-dialog').close();askSessionId='';askScope='week';viewScope=current.sessions[0]?.id||'week';surfaceState.transcripts={scope:viewScope};outputKey='';notice('本节课及关联数据已删除。整周分析可重新生成。');await refreshList();await switchScope(viewScope);}catch(e){$('#delete-dialog').close();try{current=await api('/api/projects/'+encodeURIComponent(current.id));}catch{}notice(e.message);}finally{busy=false;$('#delete-confirm').disabled=false;render();}};
$('#process').onclick=async()=>{try{notice('');if($('#bb').value!==current.bbText)await saveBB();const mode=currentMode();current=await post(endpoint('process'),{mode,...(['session','analysis'].includes(mode)?{sessionId:viewScope}:{}),...(mode==='reference'?{sourceId:referenceReader.sourceId(),referenceProfileId:referenceReader.retryProfile()}:{}),...(mode==='week'?{sessionIds:current.sessions.filter(s=>s.generation&&weeklyChoice().has(s.id)).map(s=>s.id)}:{})});render();}catch(e){notice(e.message);}};
$('#ask-scope').onchange=()=>{askScope=$('#ask-scope').value;askManual=true;if(askScope==='session'&&!askSessionId&&current.sessions.length===1)askSessionId=current.sessions[0].id;renderChat();};
$('#ask-session').onchange=()=>{askSessionId=$('#ask-session').value;askManual=true;renderChat();};
$('#ask-kind').onchange=()=>{askKind=$('#ask-kind').value;askScope=askKind==='course'?'week':'file';askSourceId='';askManual=true;renderChat();};$('#ask-file').onchange=()=>{askSourceId=$('#ask-file').value;askPage=0;askManual=true;renderChat();};$('#ask-page').onchange=()=>{askPage=Math.max(0,Number($('#ask-page').value)-1||0);askManual=true;renderChat();};
$('#ask-form').onsubmit=async e=>{
 e.preventDefault();const question=$('#question').value;if(!question.trim()||!current)return;
 let chosen;try{chosen=askTarget();const reason=askUnavailable(chosen);if(reason)throw Error(reason);}catch(e){return notice(e.message);}
 const id=current.id,key=conversationKey(id,chosen),url=endpoint('ask');
 if(askPending.has(key))return;
 askPending.set(key,question);askErrors.delete(key);$('#question').value='';askDrafts.delete(key);renderChat();
 try{
  let result=await post(url,{question,...chosen});
  if(result.acpJobId||result.chatgptJobId){const panel=acpPanel();askAcpPanels.set(key,panel);shownMessages='';if(current?.id===id)renderChat();result=await observeAcpJob({api,post,id:result.acpJobId||result.chatgptJobId,host:panel,transport:result.chatgptJobId?'chatgpt':'acp'});}
  if(current?.id===id&&result.messages?.length&&!current.chat?.some(entry=>entry.requestId===result.messages[0].requestId)){
   current={...current,chat:[...(current.chat||[]),...result.messages]};
  }
 }catch(e){
  askErrors.set(key,e.message);
  if(shownConversation===key)saveDraft();
  if(!askDrafts.get(key)){askDrafts.set(key,question);if(shownConversation===key)$('#question').value=question;}
 }finally{
  askAcpPanels.delete(key);askPending.delete(key);if(current?.id===id)renderChat();
 }
};
initSettings({api,post,notice});
for(const id of JSON.parse(sessionStorage.getItem('classroom-acp-workflows')||'[]'))watchAcpWorkflow(id,{api,post,notice});
for(const id of JSON.parse(sessionStorage.getItem('classroom-chatgpt-workflows')||'[]'))watchAcpWorkflow(id,{api,post,notice,transport:'chatgpt'});

function projectStructure(project){
 return JSON.stringify({...project,files:project.files.map(({progress,...file})=>file)});
}
let polling=false;
setInterval(async()=>{
 if(!current||busy||polling)return;
 polling=true;const previous=current;
 try{
  const next=await api(`/api/projects/${encodeURIComponent(previous.id)}`);
  if(current!==previous||busy)return;
  if(JSON.stringify(previous)===JSON.stringify(next))return;
  current=next;
  if(projectStructure(previous)===projectStructure(next)){
   const files=new Map(next.files.map(file=>[file.id,file]));
   for(const row of document.querySelectorAll('[data-file-id]')){
    const progress=files.get(row.dataset.fileId)?.progress;
    row.querySelector('[data-file-progress]').textContent=progress?' · '+progress:'';
   }
   if(currentMode()==='reference')await referenceReader.sync();
   return;
  }
  render();await loadDoc();
  if(next.status!==previous.status)await refreshList();
 }catch(e){if(current?.id===previous.id)notice('暂时无法连接本地服务，请检查启动窗口。');}
 finally{polling=false;}
},2500);
try{await refreshList();const id=localStorage.getItem('classroom-project');if(projects.some(p=>p.id===id))await select(id);else if(projects.length)await select(projects[0].id);}catch(e){notice(e.message);}

$('#ppt-help-open').onclick=()=>$('#ppt-help').showModal();$('#ppt-help-close').onclick=()=>$('#ppt-help').close();

let aiResultsSource='';
async function showAIResults(f){
 try{
  const projectId=current.id,data=await api(endpoint('ai-partial')+'?source='+encodeURIComponent(f.id));if(current?.id!==projectId)return;
  current=await api('/api/projects/'+encodeURIComponent(projectId));if(current?.id!==projectId)return;aiResultsSource=f.id;
  $('#ai-results-title').textContent=data.source;
  $('#ai-results-summary').textContent=`已完成 ${data.completed}/${data.total} 页`+(data.missing.length?'；待完成页：'+data.missing.join('、'):'；全部页面已有结果。')+(data.requiresComplete?' PPT 全页完成后才发布新导读。':'');
  $('#ai-results-pages').replaceChildren();
  if(data.review){const summary=document.createElement('p');summary.textContent=data.review.status==='complete'?'整课检查已完成。':'页面已完成；整课检查仍有 '+data.review.issues.length+' 项待核对，不影响已完成页面。';$('#ai-results-pages').append(summary);}
  for(const record of data.reviewDiagnostics||[]){const item=document.createElement('details'),title=document.createElement('summary'),raw=document.createElement('pre');title.textContent='整课检查第 '+record.batch+' 批 · 待处理与诊断';raw.textContent=JSON.stringify(record,null,2);item.append(title,raw);$('#ai-results-pages').append(item);}
  for(let i=1;i<=data.total;i++){
   const page=data.pages.find(p=>p.page===i),pending=data.pending?.find(p=>p.page===i),item=document.createElement('details'),summary=document.createElement('summary');
   summary.textContent=`第 ${i} 页 · ${page?(page.inspection?.status||page.status):'待完成：'+(pending?.parts||['识别']).join('、')} · ${data.provenance[i-1]?.model||f.aiParse?.model||'保存结果'}`;
   const content=document.createElement('pre'),draft=pending?.draft;
   content.textContent=page?[
    ...(page.originalText||[]).map(b=>'[原文] '+b.text),...(page.blocks||[]).map(b=>'['+b.kind+'] '+b.text),
    ...(page.learning?.paragraphs||[]).map(b=>'[中文] '+b.chinese),
    ...(page.visualObservations||[]).map(b=>'[视觉观察] '+b.description),
    ...(page.analysis||[]).map(t=>'[分析] '+t),page.learning?.closeReading?'[本页解读] '+page.learning.closeReading:'',
    ...(page.uncertainties||[]).map(t=>'[疑点] '+t)
   ].filter(Boolean).join('\n\n'):draft?[
    ...draft.blocks.map(b=>'[原文] '+b.original+'\n[中文] '+(b.chinese||'待补译')),
    ...draft.visuals.map(v=>'[视觉观察] '+v.description),draft.explanation?'[解读] '+draft.explanation:'解读待补全',
    ...draft.uncertainties.map(t=>'[疑点] '+t)
   ].join('\n\n'):'等待恢复本页内容，已完成的其他页保留。';
   item.append(summary,content);
   if(pending?.diagnostic){const diagnostic=document.createElement('details'),title=document.createElement('summary'),raw=document.createElement('pre');title.textContent='最近失败返回（诊断）';raw.textContent=pending.diagnostic.stage+'\n'+pending.diagnostic.error+'\n\n'+pending.diagnostic.response;diagnostic.append(title,raw);item.append(diagnostic);}
   $('#ai-results-pages').append(item);
  }
  $('#ai-results-accept').hidden=data.requiresComplete||!data.missing.length;$('#ai-results-accept').disabled=current.files.some(f=>f.aiParse?.status==='running')||current.status==='running';$('#ai-results-dialog').showModal();
 }catch(e){notice(e.message);}
}
async function previewPptPage(){
 const context=reader.context();
 if(!current||!context){notice('请先选择一份课件和要试解析的页面。');return;}
 const {sourceId,pageIndex}=context.focus,dialog=$('#chatgpt-page-dialog');
 const result=$('#chatgpt-page-result'),status=$('#chatgpt-page-status'),panel=acpPanel();
 $('#chatgpt-page-label').textContent=context.file.name+' · 第 '+(pageIndex+1)+' 页';
 result.replaceChildren();status.replaceChildren(panel);dialog.showModal();
 try{
  const {id,transport}=await post(endpoint('ppt-page-preview'),{sourceId,pageIndex});
  const {page,warnings}=await observeAcpJob({api,post,id,host:panel,transport,showText:false});
  const add=(tag,text,lang)=>{const node=document.createElement(tag);node.textContent=text;if(lang)node.lang=lang;result.append(node);};
  add('h3','原文与翻译');
  if(!page.paragraphs.length)add('p','本页没有正文段落。');
  for(const paragraph of page.paragraphs){add('p',paragraph.english,'en');add('p',paragraph.chinese,'zh');}
  add('h3','本页细读');add('p',page.closeReading,'zh');
  if(warnings?.length){add('h3','需要核对');for(const warning of warnings)add('p',warning);}
 }catch(error){if(dialog.open)status.textContent=error.message;}
}
$('#chatgpt-page-close').onclick=()=>$('#chatgpt-page-dialog').close();
$('#ai-results-close').onclick=()=>$('#ai-results-dialog').close();
$('#ai-results-accept').onclick=async()=>{try{current=await post(endpoint('ai-partial-import'),{sourceId:aiResultsSource,confirm:true});$('#ai-results-dialog').close();notice('已明确收录部分结果，缺失页仍保留标记。');render();await loadDoc();}catch(e){notice(e.message);}};
