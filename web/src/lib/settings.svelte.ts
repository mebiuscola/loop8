// State and saving for the settings page. Storage format is unchanged (docs/API.md §8):
// Antigravity and ChatGPT models are still model profiles, but the page creates them
// automatically when one is chosen, so the user thinks in accounts, not connections.
import {api,ApiError,type Settings,type ModelProfile,type SettingsSave} from './api';

export type AccountKind='acp'|'chatgpt';
export interface AccountModel{modelId:string;name?:string;}
export const NEW_PREFIX='new:';            // value of a model not yet saved as a profile: "new:acp:<modelId>"
export const TASKS:[string,[string,string][]][]=[
 ['课件',[['pptRecognition','课件识别'],['pptTranslation','课件翻译'],['pptExplanation','课件解读'],['pptPreview','单页 PPT 试解析']]],
 ['参考文献',[['referenceTranslation','参考文献翻译'],['pdfRecognition','文献 AI 补救']]],
 ['课堂',[['classroom','课堂重建'],['transcriptTranslation','讲稿翻译']]],
 ['分析与提问',[['deepDive','本节 Deep Dive'],['weeklyDeepDive','整周 Deep Dive'],['context','材料背景整理'],['qa','提问（Ask）']]],
];

const CACHE='classroom.next.accountModels';
const readCache=():Record<AccountKind,AccountModel[]>=>{try{return {acp:[],chatgpt:[],...JSON.parse(localStorage.getItem(CACHE)||'{}')};}catch{return {acp:[],chatgpt:[]};}};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const comparable=({apiKey:_k,clearApiKey:_c,hasApiKey:_h,...rest}:ModelProfile)=>rest;
const slug=(s:string)=>s.replace(/[^\w-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60)||'model';

/** The API connection a model belongs to (docs/API.md: connectionId, or its own id). */
export const connectionOf=(p:ModelProfile)=>p.connectionId||p.id;
/** Fields of an API connection, kept the same on all of its models. */
export const CONNECTION_FIELDS=['name','baseUrl','outputTokenField','apiKey','clearApiKey'] as const;
export function providerOf(p:ModelProfile):AccountKind|'api'{return p.provider==='antigravity-acp'?'acp':p.provider==='chatgpt-plan'?'chatgpt':'api';}

export class SettingsModel{
 saved=$state<Settings|null>(null);
 loadError=$state('');
 profiles=$state<ModelProfile[]>([]);
 accountModels=$state<Record<AccountKind,AccountModel[]>>(readCache());
 acpPath=$state('');                       // draft of the ACP program path ('' = use the detected one)
 assign=$state({defaultId:'',modelRoutes:{} as Record<string,string>,fallbackProfileId:'',fallbackEnabled:false});
 mineru=$state<Record<string,any>>({});
 preview=$state<Record<string,any>>({});
 advanced=$state<Record<string,any>>({});
 saving=$state(false);
 error=$state('');
 message=$state('');

 async load(){try{this.adopt(await api.settings(),false);}catch(e){this.loadError=(e as Error).message;}}

 withDefaults(p:ModelProfile):ModelProfile{
  const s=this.saved!;
  return {contextChars:s.contextChars,maxOutputTokens:s.maxOutputTokens,outputTokenField:s.outputTokenField,visionEnabled:s.visionEnabled,...$state.snapshot(p),apiKey:'',clearApiKey:false};
 }
 adopt(s:Settings,keepUnsaved=true){
  const unsaved=keepUnsaved?this.profiles.filter(p=>!s.modelProfiles.some(x=>x.id===p.id)):[];
  this.saved=s;
  this.profiles=[...s.modelProfiles.map(p=>this.withDefaults(p)),...unsaved];
  this.acpPath='';
  this.assign={defaultId:s.defaultProfileId,modelRoutes:{...s.modelRoutes},fallbackProfileId:s.fallbackProfileId,fallbackEnabled:s.fallbackEnabled};
  this.mineru={mineruToken:'',clearMineruToken:false,mineruLanguage:s.mineruLanguage,uploadConcurrency:s.uploadConcurrency};
  this.preview={previewEngine:s.previewEngine,browserPath:s.browserPath,libreOfficePath:s.libreOfficePath};
  this.advanced={contextConcurrency:s.contextConcurrency,parseConcurrency:s.parseConcurrency,chunkChars:s.chunkChars,compactPptImages:s.compactPptImages,structuredOutput:s.structuredOutput};
 }

 // ---- Antigravity program ----
 /** Program the account uses: the typed path, else the saved one, else the bundled server. */
 get acpExecutable(){const s=this.saved;if(!s)return '';return this.acpPath||s.acpPaths.standalone||s.acpPaths.cli||s.acpBundled||'';}
 get acpEntry():'cli'|'standalone'{return /(^|\\)agy\.exe$/i.test(this.acpExecutable)?'cli':'standalone';}
 get acpSource(){const s=this.saved;if(!s)return '';if(this.acpPath)return '手动指定（未保存）';if(s.acpPaths.standalone||s.acpPaths.cli)return this.acpExecutable===s.acpBundled?'随包自带':'手动指定';return s.acpBundled?'随包自带':'';}
 /** A connection object used to sign in / read models; not saved. */
 accountProbe(kind:AccountKind):ModelProfile{
  const existing=this.profiles.find(p=>providerOf(p)===kind);
  if(kind==='acp')return {...(existing?$state.snapshot(existing) as ModelProfile:{id:'antigravity-account',name:'Antigravity',model:''}),provider:'antigravity-acp',acpEntry:this.acpEntry,acpExecutable:this.acpExecutable};
  return existing?$state.snapshot(existing) as ModelProfile:{id:'chatgpt-account',name:'ChatGPT',provider:'chatgpt-plan',model:''};
 }
 setAccountModels(kind:AccountKind,models:AccountModel[]){
  this.accountModels={...this.accountModels,[kind]:models};
  try{localStorage.setItem(CACHE,JSON.stringify(this.accountModels));}catch{/* private mode */}
 }

 // ---- model choices for the assignment table ----
 options(){
  const groups:{label:string;items:[string,string][]}[]=[];
  const saved=this.saved;if(!saved)return groups;
  const ofKind=(k:AccountKind|'api')=>saved.modelProfiles.filter(p=>providerOf(p)===k);
  groups.push({label:'API 连接',items:ofKind('api').map(p=>[p.id,p.name+' · '+p.model])});
  for(const [kind,label] of [['acp','Antigravity 账号'],['chatgpt','ChatGPT 订阅']] as [AccountKind,string][]){
   const items:[string,string][]=ofKind(kind).map(p=>[p.id,this.accountModels[kind].find(m=>m.modelId===p.model)?.name||p.model]);
   for(const m of this.accountModels[kind])if(!ofKind(kind).some(p=>p.model===m.modelId))items.push([NEW_PREFIX+kind+':'+m.modelId,m.name||m.modelId]);
   groups.push({label,items});
  }
  return groups.filter(g=>g.items.length);
 }
 labelOf(value:string){
  if(!value)return '';
  if(value.startsWith(NEW_PREFIX)){const [,kind,...rest]=value.split(':');const id=rest.join(':');return (kind==='acp'?'Antigravity · ':'ChatGPT · ')+(this.accountModels[kind as AccountKind].find(m=>m.modelId===id)?.name||id);}
  const p=this.saved?.modelProfiles.find(x=>x.id===value);if(!p)return '';
  const kind=providerOf(p);return kind==='api'?(this.saved!.modelProfiles.filter(x=>providerOf(x)==='api'&&connectionOf(x)===connectionOf(p)).length>1?p.name+' · '+p.model:p.name):(kind==='acp'?'Antigravity · ':'ChatGPT · ')+(this.accountModels[kind].find(m=>m.modelId===p.model)?.name||p.model);
 }
 /** What a task actually uses after defaults. */
 actual(task:string):string{
  const v=this.assign.modelRoutes[task];
  if(v)return this.labelOf(v);
  if(task==='pptPreview')return this.actual('pptRecognition');
  return this.labelOf(this.assign.defaultId)||'未选择模型';
 }

 // ---- unsaved changes ----
 profileDirty(p:ModelProfile){
  const base=this.saved?.modelProfiles.find(x=>x.id===p.id);if(!base)return true;
  return !!p.apiKey||!!p.clearApiKey||!same(comparable(p),comparable(this.withDefaults(base)));
 }
 get servicesDirty(){
  const s=this.saved;if(!s)return false;
  return this.profiles.some(p=>this.profileDirty(p))||!!this.acpPath||this.mineruDirty;
 }
 get mineruDirty(){const s=this.saved!,m=this.mineru;return !!m.mineruToken||!!m.clearMineruToken||m.mineruLanguage!==s.mineruLanguage||Number(m.uploadConcurrency)!==s.uploadConcurrency;}
 get assignDirty(){const s=this.saved;if(!s)return false;return !same(this.assign,{defaultId:s.defaultProfileId,modelRoutes:s.modelRoutes,fallbackProfileId:s.fallbackProfileId,fallbackEnabled:s.fallbackEnabled});}
 get previewDirty(){const s=this.saved;return !!s&&!same(this.preview,{previewEngine:s.previewEngine,browserPath:s.browserPath,libreOfficePath:s.libreOfficePath});}
 get advancedDirty(){const s=this.saved;return !!s&&!same(this.advanced,{contextConcurrency:s.contextConcurrency,parseConcurrency:s.parseConcurrency,chunkChars:s.chunkChars,compactPptImages:s.compactPptImages,structuredOutput:s.structuredOutput});}

 // ---- saving ----
 private async send(payload:SettingsSave){const next=await api.saveSettings(payload);this.saved=next;return next;}
 private acpPaths(){return {[this.acpEntry]:this.acpExecutable};}
 private async saveProfile(p:ModelProfile){
  const out=$state.snapshot(p) as ModelProfile;
  if(!out.apiKey)delete out.apiKey;
  if(out.provider==='antigravity-acp'){out.acpEntry=this.acpEntry;out.acpExecutable=this.acpExecutable;return this.send({section:'model',profile:out,acpPaths:this.acpPaths()});}
  return this.send({section:'model',profile:out});
 }
 /** Turns "new:acp:<model>" into a saved profile and returns its id. */
 private async materialize(value:string):Promise<string>{
  if(!value.startsWith(NEW_PREFIX))return value;
  const [,kind,...rest]=value.split(':');const modelId=rest.join(':');
  const existing=this.saved!.modelProfiles.find(p=>providerOf(p)===kind&&p.model===modelId);if(existing)return existing.id;
  const name=(kind==='acp'?'Antigravity · ':'ChatGPT · ')+(this.accountModels[kind as AccountKind].find(m=>m.modelId===modelId)?.name||modelId);
  let id=(kind==='acp'?'acp-':'chatgpt-')+slug(modelId);while(this.saved!.modelProfiles.some(p=>p.id===id))id+='-2';
  const profile:ModelProfile=kind==='acp'
   ?{id,name,provider:'antigravity-acp',model:modelId,acpEntry:this.acpEntry,acpExecutable:this.acpExecutable,contextChars:180000,visionEnabled:true}
   :{id,name,provider:'chatgpt-plan',model:modelId,contextChars:180000,visionEnabled:true};
  await this.saveProfile(profile);
  return id;
 }

 /** After one page is saved, take the new saved values without losing other pages' unsaved changes. */
 private settle(section:'services'|'assign'|'preview'|'advanced'){
  const services=section==='services';
  const profiles=services?[]:this.profiles.filter(p=>this.profileDirty(p)).map(p=>$state.snapshot(p) as ModelProfile);
  const acpPath=services?'':this.acpPath,mineru=services?null:$state.snapshot(this.mineru);
  const assign=section==='assign'?null:$state.snapshot(this.assign);
  const preview=section==='preview'?null:$state.snapshot(this.preview);
  const advanced=section==='advanced'?null:$state.snapshot(this.advanced);
  this.adopt(this.saved!);
  for(const p of profiles){const i=this.profiles.findIndex(x=>x.id===p.id);if(i>=0)this.profiles[i]=p;else this.profiles.push(p);}
  this.acpPath=acpPath;
  if(mineru)this.mineru=mineru;
  if(assign)this.assign=assign;
  if(preview)this.preview=preview;
  if(advanced)this.advanced=advanced;
 }

 async save(section:'services'|'assign'|'preview'|'advanced'){
  if(!this.saved)return;
  this.saving=true;this.error='';this.message='';
  try{
   if(section==='services'){
    // A changed ACP program applies to every Antigravity model.
    for(const p of this.profiles)if(this.profileDirty(p)||(this.acpPath&&providerOf(p)==='acp'))await this.saveProfile(p);
    if(this.mineruDirty){const m=$state.snapshot(this.mineru);if(!m.mineruToken)delete m.mineruToken;if(!m.clearMineruToken)delete m.clearMineruToken;m.uploadConcurrency=Number(m.uploadConcurrency);await this.send({section:'mineru',...m});}
   }else if(section==='assign'){
    const a=$state.snapshot(this.assign);
    const routes:Record<string,string>={};for(const [task,v] of Object.entries(a.modelRoutes))routes[task]=await this.materialize(v);
    const defaultId=await this.materialize(a.defaultId),fallback=await this.materialize(a.fallbackProfileId);
    if(defaultId!==this.saved.defaultProfileId)await this.send({section:'models',defaultProfileId:defaultId});
    await this.send({section:'routes',modelRoutes:routes,fallbackProfileId:fallback,fallbackEnabled:a.fallbackEnabled});
   }else if(section==='preview')await this.send({section:'preview',...$state.snapshot(this.preview)});
   else await this.send({section:'advanced',...Object.fromEntries(Object.entries($state.snapshot(this.advanced)).map(([k,v])=>[k,typeof v==='string'&&/^\d+$/.test(v)?Number(v):v]))});
   this.settle(section);this.message='已保存。';
  }catch(e){
   this.error=readable(e instanceof ApiError?e.message:(e as Error).message);
   // Keep what did get saved, without losing the remaining drafts.
   try{this.saved=await api.settings();}catch{/* keep previous */}
  }finally{this.saving=false;}
 }

 /** API connections in order, each with its models (unsaved ones last). */
 get connections(){
  const out:{id:string;models:ModelProfile[]}[]=[];
  for(const p of this.profiles.filter(x=>providerOf(x)==='api')){
   const id=connectionOf(p),group=out.find(c=>c.id===id);
   if(group)group.models.push(p);else out.push({id,models:[p]});
  }
  return out;
 }
 /** Sets a connection field on every model of the connection. */
 setConnection(id:string,key:typeof CONNECTION_FIELDS[number],value:string|boolean){
  for(const p of this.profiles)if(providerOf(p)==='api'&&connectionOf(p)===id)(p as any)[key]=value;
 }
 /** A new model on an existing connection: same address, name and key (the key is filled in by the server). */
 addModel(id:string){
  const first=this.profiles.find(p=>providerOf(p)==='api'&&connectionOf(p)===id);if(!first)return '';
  const p:ModelProfile={id:crypto.randomUUID(),connectionId:id,name:first.name,provider:'api',baseUrl:first.baseUrl,model:'',apiKey:first.apiKey||'',hasApiKey:first.hasApiKey,
   contextChars:first.contextChars,maxOutputTokens:first.maxOutputTokens,outputTokenField:first.outputTokenField,visionEnabled:true};
  this.profiles=[...this.profiles,p];return p.id;
 }
 /** Removes a whole API connection with all of its models. */
 async removeConnection(id:string){
  this.error='';
  const models=this.profiles.filter(p=>providerOf(p)==='api'&&connectionOf(p)===id);
  if(!models.some(p=>this.saved?.modelProfiles.some(x=>x.id===p.id))){this.profiles=this.profiles.filter(p=>!models.includes(p));return;}
  this.saving=true;
  try{const next=await api.saveSettings({section:'delete-connection',connectionId:id});this.profiles=this.profiles.filter(p=>!models.includes(p));this.adopt(next);}
  catch(e){this.error=(e as Error).message;}
  finally{this.saving=false;}
 }

 async remove(id:string){
  this.error='';
  if(!this.saved?.modelProfiles.some(p=>p.id===id)){this.profiles=this.profiles.filter(p=>p.id!==id);return;}
  this.saving=true;
  try{const next=await api.saveSettings({section:'delete-model',profileId:id});this.profiles=this.profiles.filter(p=>p.id!==id);this.adopt(next);}
  catch(e){this.error=(e as Error).message;}
  finally{this.saving=false;}
 }

 addApi(){
  const p:ModelProfile={id:crypto.randomUUID(),name:'新的 API 连接',provider:'api',baseUrl:'https://api.openai.com/v1',model:'',apiKey:'',contextChars:180000,maxOutputTokens:12000,outputTokenField:'max_completion_tokens',visionEnabled:true};
  this.profiles=[...this.profiles,p];return p.id;
 }
 /** Where a profile is used, for the removal warning. */
 usage(id:string){
  const s=this.saved;if(!s)return [];
  const names:string[]=[];if(s.defaultProfileId===id)names.push('默认模型');
  for(const [,tasks] of TASKS)for(const [task,label] of tasks)if(s.modelRoutes[task]===id)names.push(label);
  if(s.fallbackProfileId===id)names.push('备用模型');
  return names;
 }
}

const LABELS:Record<string,string>={chunkChars:'分段字符数',contextConcurrency:'材料背景整理并发数',parseConcurrency:'材料解析并发数',uploadConcurrency:'同时上传解析的文件数',contextChars:'上下文字符额度',maxOutputTokens:'输出 Token 上限'};
/** Backend validation messages name internal keys; show the labels the user sees. */
export function readable(message:string){return message.replace(/\b[a-zA-Z]+\b/g,k=>LABELS[k]?'"'+LABELS[k]+'"':k);}
