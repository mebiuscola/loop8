import {createHash} from 'node:crypto';
import {validateAcpProfile} from './acp-client.mjs';
export const MODEL_TASKS={pptPreview:'单页 PPT 试解析',pptRecognition:'课件识别',pptTranslation:'课件翻译',pptExplanation:'课件解读',referenceTranslation:'参考文献翻译',classroom:'课堂重建',transcriptTranslation:'讲稿翻译',deepDive:'本节 Deep Dive',weeklyDeepDive:'整周 Deep Dive',qa:'Ask 问答',context:'材料背景整理',pdfRecognition:'文献 AI 补救'};
export function acpPathsForSettings(settings){
 const paths={};
 const profiles=settings.modelProfiles||[];
 for(const profile of [...profiles.filter(p=>p.id===settings.defaultProfileId),...profiles]){
  if(profile.provider==='antigravity-acp'&&profile.acpExecutable)paths[profile.acpEntry]??=profile.acpExecutable;
 }
 return {...paths,...settings.acpPaths};
}

export function withAcpPath(settings,profile){
 if(profile.provider!=='antigravity-acp')return profile;
 return {...profile,acpExecutable:settings.acpPaths?.[profile.acpEntry]??profile.acpExecutable};
}

export function setAcpPaths(settings,paths){
 if(!paths||typeof paths!=='object'||Array.isArray(paths))throw Error('ACP 路径设置无效。');
 for(const [entry,acpExecutable] of Object.entries(paths)){
  if(!['cli','standalone'].includes(entry)||typeof acpExecutable!=='string')throw Error('ACP 路径设置无效。');
  if(acpExecutable)validateAcpProfile({acpEntry:entry,acpExecutable});
 }
 settings.acpPaths={...settings.acpPaths,...paths};
 settings.modelProfiles=settings.modelProfiles.map(profile=>withAcpPath(settings,profile));
}

export function resolveModel(s,task){
 if(!Object.hasOwn(MODEL_TASKS,task))throw Error('未知模型功能：'+task);
 if(task==='pptPreview'&&!s.modelRoutes?.pptPreview)return resolveModel(s,'pptRecognition');
 const routes=s.modelRoutes||{},id=s.modelRoutingVersion===2?(routes[task]||s.defaultProfileId):routes[task]||(task==='weeklyDeepDive'?routes.deepDive:['pptTranslation','pptExplanation'].includes(task)?routes.pptRecognition:''),savedProfile=(s.modelProfiles||[]).find(p=>p.id===id),profile=savedProfile&&withAcpPath(s,withConnectionKey(s,savedProfile));
 const base={...s};delete base.modelProfiles;delete base.modelRoutes;
 base.provider='api';
 if(task==='pptPreview'&&!profile)return {...base,model:'',apiKey:'',baseUrl:''};
 if(s.modelRoutingVersion===2){if(!profile)return {...base,model:'',apiKey:'',baseUrl:''};for(const k of ['provider','baseUrl','model','apiKey','maxOutputTokens','contextChars','outputTokenField','visionEnabled','acpExecutable','acpEntry','acpThinking'])if(profile[k]!==undefined)base[k]=profile[k];base.provider=profile.provider||'api';base.model=profile.model||'';base.apiKey=profile.apiKey||'';base.baseUrl=profile.baseUrl||'';base.profileId=profile.id;if(base.provider!=='api'){delete base.apiKey;delete base.baseUrl;}return base;}
 if(profile){for(const k of ['provider','baseUrl','model','apiKey','maxOutputTokens','contextChars','outputTokenField','visionEnabled','acpExecutable','acpEntry','acpThinking'])if(profile[k]!==undefined&&profile[k]!=='')base[k]=profile[k];base.profileId=profile.id;if(base.provider!=='api'){delete base.apiKey;delete base.baseUrl;}}
 else if(['pptRecognition','pptTranslation','pptExplanation','pdfRecognition'].includes(task)){base.baseUrl=s.parseBaseUrl||s.baseUrl;base.model=s.parseModel||s.model;base.apiKey=s.parseApiKey||s.apiKey;}
 return base;
}
export const modelIdentity=s=>createHash('sha256').update(JSON.stringify((s.provider==='chatgpt-plan'?['provider','profileId','model','contextChars','visionEnabled']:s.provider==='antigravity-acp'?['provider','acpExecutable','acpEntry','acpThinking','baseUrl','model','apiKey','maxOutputTokens','contextChars','outputTokenField','visionEnabled']:['baseUrl','model','apiKey','maxOutputTokens','contextChars','outputTokenField','visionEnabled']).map(k=>s[k]))).digest('hex');
// API models that share an address and key form one connection (connectionId). Each model is still
// its own profile, so routes, caches and model identity are unchanged; a profile without a
// connectionId is a connection with one model (all settings saved before this existed).
export const connectionOf=p=>p.connectionId||p.id;
/** Fields that belong to the connection and are kept the same on all of its models. */
export const CONNECTION_FIELDS=['baseUrl','outputTokenField','name'];
const isApi=p=>!p.provider||p.provider==='api';
export function mergeModelProfiles(saved,input){
 if(!Object.hasOwn(input,'modelProfiles'))return saved.modelProfiles||[];
 if(!Array.isArray(input.modelProfiles)||input.modelProfiles.length>30)throw Error('模型连接最多 30 个。');
 return input.modelProfiles.map(p=>{const old=(saved.modelProfiles||[]).find(q=>q.id===p.id);
  // A model added to an existing connection uses the connection's saved key.
  const shared=isApi(p)&&p.connectionId?(saved.modelProfiles||[]).find(q=>isApi(q)&&connectionOf(q)===p.connectionId&&q.apiKey)?.apiKey:'';
  return {...p,apiKey:(p.provider&&p.provider!=='api')||p.clearApiKey?'':p.apiKey||old?.apiKey||shared||'',hasApiKey:undefined,clearApiKey:undefined};});
}
export function validateModelRouting(s){
 if(!Array.isArray(s.modelProfiles)||!s.modelRoutes||typeof s.modelRoutes!=='object'||Array.isArray(s.modelRoutes))throw Error('功能模型设置格式无效。');
 const ids=new Set();for(const p of s.modelProfiles){if(!p||!/^[-\w]{1,80}$/.test(p.id)||ids.has(p.id))throw Error('模型连接编号无效或重复。');ids.add(p.id);if(p.provider&&!['api','antigravity-acp','chatgpt-plan'].includes(p.provider))throw Error('未知模型连接方式。');for(const k of p.provider&&p.provider!=='api'?['name','model']:['name','baseUrl','model','apiKey'])if(typeof p[k]!=='string')throw Error('模型连接字段不完整。');if(p.visionEnabled!==undefined&&typeof p.visionEnabled!=='boolean')throw Error('visionEnabled must be boolean');if(p.connectionId!==undefined&&(!isApi(p)||typeof p.connectionId!=='string'||!/^[-\w]{1,80}$/.test(p.connectionId)))throw Error('API 连接编号无效。');if(p.provider==='antigravity-acp')validateAcpProfile(p);else if(p.provider!=='chatgpt-plan'){const u=new URL(p.baseUrl);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('模型地址必须为 HTTP(S)，不能包含凭据。');}for(const [k,min,max] of [['contextChars',20000,2000000],['maxOutputTokens',1000,100000]])if(p[k]!==undefined&&(!Number.isInteger(p[k])||p[k]<min||p[k]>max))throw Error('模型额度超出支持范围。');if(p.outputTokenField&&!['max_tokens','max_completion_tokens'].includes(p.outputTokenField))throw Error('输出参数无效。');}
 for(const [task,id] of Object.entries(s.modelRoutes))if(!Object.hasOwn(MODEL_TASKS,task)||typeof id!=='string'||id&&!ids.has(id))throw Error('功能分配引用了无效模型连接。');
 for(const key of ['defaultProfileId','fallbackProfileId'])if(s[key]!==undefined&&(typeof s[key]!=='string'||s[key]&&!ids.has(s[key])))throw Error('默认或备用模型引用无效。');
}
// Explicit migration for the new settings editor. Legacy API clients retain
// their existing settings contract until the new editor is saved.
export function migrateModelSettings(s){
 if(s.modelRoutingVersion===2)return structuredClone(s);
 const out=structuredClone(s);out.modelProfiles??=[];out.modelRoutes={};
 const add=(prefix,name,actual)=>{let id=prefix;while(out.modelProfiles.some(p=>p.id===id))id+='-new';out.modelProfiles.push({id,name,provider:'api',baseUrl:actual.baseUrl||s.baseUrl,model:actual.model||'',apiKey:actual.apiKey||'',contextChars:actual.contextChars,maxOutputTokens:actual.maxOutputTokens,outputTokenField:actual.outputTokenField,visionEnabled:actual.visionEnabled});return id;};
 const def=s.model?add('legacy-default','原默认模型',s):'';out.defaultProfileId=def;let vision='';
 for(const task of Object.keys(MODEL_TASKS)){if(task==='pptPreview'&&!s.modelRoutes?.pptPreview){out.modelRoutes[task]='';continue;}const actual=resolveModel(s,task);let id=actual.profileId||def;if(!actual.profileId&&['pptRecognition','pptTranslation','pptExplanation','pdfRecognition'].includes(task)&&(s.parseModel||s.parseApiKey||s.parseBaseUrl)){vision||=add('legacy-vision','原视觉解析模型',actual);id=vision;}out.modelRoutes[task]=id===def?'':id||'';}
 // Materialize the former per-profile default-key inheritance once.
 for(const p of out.modelProfiles)if((!p.provider||p.provider==='api')&&!p.apiKey)p.apiKey=s.apiKey||'';
 out.fallbackProfileId=s.fallbackModel?add('legacy-fallback','原文献备用模型',{...s,baseUrl:s.fallbackBaseUrl||s.parseBaseUrl||s.baseUrl,model:s.fallbackModel,apiKey:s.fallbackApiKey||s.parseApiKey||s.apiKey}):'';
 out.modelRoutingVersion=2;return out;
}
/**
 * After one model of a connection is saved, its connection fields (address, output parameter,
 * name of the connection and, when given or cleared, the key) are applied to the other models.
 */
export function shareConnection(profiles,saved,changed){
 if(!isApi(saved))return profiles;
 const key=connectionOf(saved);
 return profiles.map(q=>{
  if(q.id===saved.id||!isApi(q)||connectionOf(q)!==key)return q;
  const next={...q};for(const k of CONNECTION_FIELDS)if(saved[k]!==undefined)next[k]=saved[k];
  if(changed.apiKey||changed.clearApiKey)next.apiKey=saved.apiKey;
  return next;
 });
}
// A model saved without its own key (for example added to a connection while an older server was
// running) uses its connection's key, so it works without being saved again.
export function withConnectionKey(s,p){
 if(!p||!isApi(p)||p.apiKey||!p.connectionId)return p;
 const key=(s.modelProfiles||[]).find(q=>isApi(q)&&connectionOf(q)===p.connectionId&&q.apiKey)?.apiKey;
 return key?{...p,apiKey:key}:p;
}
export const publicProfiles=s=>(s.modelProfiles||[]).map(p=>withConnectionKey(s,p)).map(({apiKey,...p})=>({...p,hasApiKey:!!apiKey}));
export function taskForStage(mode,name){if(name.startsWith('构建课程上下文'))return 'context';if(mode==='session')return name.startsWith('生成双语讲稿')?'transcriptTranslation':'classroom';if(mode==='analysis')return 'deepDive';if(mode==='week')return 'weeklyDeepDive';if(mode==='reference')return 'referenceTranslation';return /翻译|补译/.test(name)?'pptTranslation':'pptExplanation';}
