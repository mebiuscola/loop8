// The only module that talks to the backend. Every call here is listed in docs/API.md.

export type TaskStatus='running'|'complete'|'partial'|'error'|string;
export interface Task{status:TaskStatus;stage?:string;error?:string;started?:string;finished?:string;warnings?:unknown[];}
export interface SourceFile{id:string;name:string;sessionId?:string;role:'bb'|'ppt'|'reading'|'srt'|'audio'|string;parseStatus?:string;progress?:string;}
export interface SessionAudio{fileId:string;srtId:string|null;srtHash:string|null;offsetMs:number;}
export interface AnalysisMeta{generation?:string;generated?:string;materialRevision?:number;scriptGeneration?:string;outputRevision?:number;centralQuestion?:string;citationIssues?:unknown[];}
export interface Session{id:string;type:'Lecture'|'Seminar'|'Other'|string;title:string;date?:string;revision:number;srtId?:string;generation?:string;generated?:string;materialRevision?:number;outputRevision?:number;analysis?:AnalysisMeta;artifactStatus?:{script?:string;deepDive?:string};analysisError?:string;audio?:SessionAudio;}
export interface TranscriptParagraph{id:string;chapter:string;speaker:'Lecturer'|'Student'|'Unclear speaker';startMs:number;endMs:number;cueIds:number[];english:string;chinese:string;corrections:string[];}
export interface TranscriptAudio extends SessionAudio{name:string;url:string;matched:boolean;}
export type Transcript={available:false;message:string}|{available:true;sessionId:string;srtId:string;paragraphs:TranscriptParagraph[];contentAudit?:{segmentIndex:number;issues:string[]}[];legacy:boolean;audio:TranscriptAudio|null};
export interface ChatMessage{role:'user'|'assistant';text:string;scope:string;focus:unknown;contextLabel?:string;at:string;requestId?:string;}
export interface ProjectSummary{id:string;name:string;status?:string;stage?:string;error?:string;tasks?:Record<string,Task>;}
export interface SessionInput{id:string;revision:number;generation?:string|null;}
export interface Weekly{generation?:string;generated?:string;materialRevision?:number;selectedSessionIds?:string[];availableSessionIds?:string[];knownSessionIds?:string[];sessionInputs?:SessionInput[];pendingSessionInputs?:SessionInput[];analysis?:AnalysisMeta;}
export interface Project extends ProjectSummary{materialRevision?:number;weekly?:Weekly|null;files:SourceFile[];sessions:Session[];chat?:ChatMessage[];job?:{mode:string;sessionId?:string;sourceId?:string};}
export interface InteractiveJob{id:string;status:string;stage?:string;message?:string;}
export interface ReaderParagraph{english:string;chinese:string;}
export interface ReaderPage{sourceId:string;pageIndex:number;pageType?:string;paragraphs:ReaderParagraph[];closeReading:string;learningStale?:boolean;inspection?:{status?:string};}
export interface CoursewareReader{sourceId:string;source:string;sourceHash:string;previewIssue?:string;generated:boolean;stale:boolean;sourceChanged?:boolean;learningStale?:boolean;nativePageCount?:number;pages:ReaderPage[];review?:{status?:string;issues?:unknown[]}|null;}
export interface ReferenceParagraph{key:string;pageIndex:number|null;printedPage?:string|null;kind:string;english:string;chinese:string;status:'complete'|'pending'|'blocked'|string;}
export interface ReferenceReader{sourceId:string;source:string;pdf:boolean;generated:boolean;stale:boolean;needsPublish?:boolean;paragraphs:ReferenceParagraph[];summary:{total:number;completed:number;blocked:number};taskStatus?:string;sourceWarnings?:{missingPages?:number[];uncertaintyCount?:number};}
export type Provider='api'|'antigravity-acp'|'chatgpt-plan';
export interface ModelProfile{id:string;name:string;provider?:Provider;baseUrl?:string;model:string;apiKey?:string;hasApiKey?:boolean;clearApiKey?:boolean;contextChars?:number;maxOutputTokens?:number;outputTokenField?:string;visionEnabled?:boolean;acpEntry?:'cli'|'standalone';acpExecutable?:string;acpThinking?:string;}
export interface Settings{acpBundled:string;modelProfiles:ModelProfile[];modelRoutes:Record<string,string>;defaultProfileId:string;fallbackProfileId:string;fallbackEnabled:boolean;acpPaths:Record<string,string>;
 hasMineruToken:boolean;mineruLanguage:string;uploadConcurrency:number;previewEngine:string;browserPath:string;libreOfficePath:string;
 contextConcurrency:number;parseConcurrency:number;compactPptImages:boolean;chunkChars:number;structuredOutput:boolean;contextChars:number;maxOutputTokens:number;outputTokenField:string;visionEnabled:boolean;}
export type SettingsSave={section:'model';profile:ModelProfile;acpPaths?:Record<string,string>}|{section:'delete-model';profileId:string}|{section:'models';defaultProfileId:string}
 |{section:'routes';modelRoutes:Record<string,string>;fallbackProfileId:string;fallbackEnabled:boolean}|{section:'mineru'|'preview'|'advanced';[key:string]:unknown};
export interface TestJob{id:string;status:string;stage?:string;message?:string;transport?:'acp'|'chatgpt'|'api';}
export interface InteractiveJobView extends InteractiveJob{phaseStarted?:number;authorizationUrl?:string;text?:string;modelLabel?:string;permission?:{id:string;title:string;details?:string;options:{optionId:string;name:string;kind:string}[]}|null;result?:{message?:string;models?:{modelId:string;name?:string}[];currentModel?:string;[k:string]:unknown};}
export interface ChatgptStatus{connected:boolean;email:string;pending:boolean;permissionDeclined:boolean;error:string;}
export type ProcessMode='preparation'|'reference'|'session'|'analysis'|'week';
export type AskResult={messages:ChatMessage[]}|{chatgptJobId:string}|{acpJobId:string};

export class ApiError extends Error{constructor(message:string,public status:number){super(message);}}

async function request<T>(path:string,init?:RequestInit):Promise<T>{
 let response:Response;
 try{response=await fetch(path,init);}
 catch{throw new ApiError('无法连接本地服务。请确认 Classroom 窗口仍在运行。',0);}
 const text=await response.text();
 let data:any=null;
 try{data=text?JSON.parse(text):null;}catch{/* non-JSON error body */}
 if(!response.ok)throw new ApiError(data?.error||'请求失败（'+response.status+'）。',response.status);
 return data as T;
}
const post=<T>(path:string,body:unknown)=>request<T>(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const project=(id:string)=>'/api/projects/'+encodeURIComponent(id);

export const api={
 listProjects:()=>request<ProjectSummary[]|{projects:ProjectSummary[]}>('/api/projects').then(r=>Array.isArray(r)?r:r.projects),
 getProject:(id:string)=>request<Project>(project(id)),
 createProject:(name:string)=>post<Project>('/api/projects',{name}),
 reader:(id:string,sourceId:string)=>request<CoursewareReader>(project(id)+'/reader?source='+encodeURIComponent(sourceId)),
 pageImageUrl:(id:string,sourceId:string,pageIndex:number,hash:string)=>project(id)+'/page-image?source='+encodeURIComponent(sourceId)+'&page='+(pageIndex+1)+'&hash='+encodeURIComponent(hash),
 referenceReader:(id:string,sourceId:string)=>request<ReferenceReader>(project(id)+'/reference-reader?source='+encodeURIComponent(sourceId)),
 referenceFileUrl:(id:string,sourceId:string)=>project(id)+'/reference-file?source='+encodeURIComponent(sourceId),
 /** Starts a background generation; the task then shows up in project.tasks. */
 process:(id:string,mode:ProcessMode,ref?:string)=>post<unknown>(project(id)+'/process',{mode,...(ref?(mode==='session'||mode==='analysis'?{sessionId:ref}:{sourceId:ref}):{})}),
 /** Weekly Deep Dive over the chosen classes (only classes that have a transcript). */
 processWeek:(id:string,sessionIds:string[])=>post<unknown>(project(id)+'/process',{mode:'week',sessionIds}),
 /** A generated Markdown document (Deep Dive, transcript) as text. */
 outputText:async(id:string,name:string,scope:string)=>{
  let response:Response;
  try{response=await fetch(project(id)+'/output?name='+encodeURIComponent(name)+'&scope='+encodeURIComponent(scope));}
  catch{throw new ApiError('无法连接本地服务。请确认 Classroom 窗口仍在运行。',0);}
  const text=await response.text();
  if(!response.ok){let message='';try{message=JSON.parse(text).error;}catch{/* not JSON */}throw new ApiError(message||'读取失败（'+response.status+'）。',response.status);}
  return text;
 },

 // Classes (docs/API.md §3).
 transcript:(id:string,sessionId:string)=>request<Transcript>(project(id)+'/transcript?session='+encodeURIComponent(sessionId)),
 uploadSrt:(id:string,sessionId:string,file:File)=>request<Project>(project(id)+'/upload',{method:'POST',headers:{'X-File-Name':encodeURIComponent(file.name),'X-File-Role':'srt','X-Session-Id':sessionId},body:file}),
 /** Recordings can be large, so this one reports upload progress (0–1). */
 uploadAudio:(id:string,sessionId:string,file:File,onProgress?:(fraction:number)=>void)=>new Promise<Project>((resolve,reject)=>{
  const xhr=new XMLHttpRequest();
  xhr.open('POST',project(id)+'/audio-upload');
  xhr.setRequestHeader('X-File-Name',encodeURIComponent(file.name));xhr.setRequestHeader('X-Session-Id',sessionId);
  xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress?.(e.loaded/e.total);};
  xhr.onload=()=>{let data:any=null;try{data=JSON.parse(xhr.responseText);}catch{/* non-JSON */}xhr.status>=200&&xhr.status<300?resolve(data):reject(new ApiError(data?.error||'上传失败（'+xhr.status+'）。',xhr.status));};
  xhr.onerror=()=>reject(new ApiError('无法连接本地服务。请确认 Classroom 窗口仍在运行。',0));
  xhr.send(file);
 }),
 audioBinding:(id:string,sessionId:string,change:{offsetMs:number}|{bindCurrent:true})=>post<Project>(project(id)+'/audio-binding',{sessionId,...change}),
 outputUrl:(id:string,name:string,scope:string)=>project(id)+'/output?name='+encodeURIComponent(name)+'&scope='+encodeURIComponent(scope)+'&download=1',
 sourceUrl:(id:string,sourceId:string)=>project(id)+'/source?id='+encodeURIComponent(sourceId),
 ask:(id:string,question:string,scope:string,focus:unknown=null)=>post<AskResult>(project(id)+'/ask',{question,scope,focus}),
 cancelAiParse:(id:string,sourceId:string)=>post<unknown>(project(id)+'/ai-parse-cancel',{sourceId}),
 job:(kind:'acp'|'chatgpt',jobId:string)=>request<InteractiveJobView>('/api/'+kind+'/jobs/'+encodeURIComponent(jobId)),
 cancelJob:(kind:'acp'|'chatgpt',jobId:string)=>post<unknown>('/api/'+kind+'/jobs/'+encodeURIComponent(jobId)+'/cancel',{}),
 answerPermission:(kind:'acp'|'chatgpt',jobId:string,permissionId:string,optionId:string|null)=>post<unknown>('/api/'+kind+'/jobs/'+encodeURIComponent(jobId)+'/permission',{permissionId,optionId}),

 // Settings (docs/API.md §8). Keys and tokens are write-only: the editor only reports hasApiKey / hasMineruToken.
 settings:()=>request<Settings>('/api/settings/editor'),
 saveSettings:(payload:SettingsSave)=>post<Settings>('/api/settings/editor',payload),
 modelTest:(kind:'ai'|'text'|'json'|'vision'|'inspect'|'login',profile:ModelProfile)=>post<TestJob>('/api/settings/model-test',{kind,profile}),
 settingsTest:(kind:string,settings:Record<string,unknown>)=>post<TestJob>('/api/settings/test',{kind,settings}),
 testJob:(jobId:string)=>request<TestJob>('/api/settings/test/'+encodeURIComponent(jobId)),
 cancelTest:(jobId:string)=>post<unknown>('/api/settings/test/'+encodeURIComponent(jobId)+'/cancel',{}),
 acpLogout:(profileId:string)=>post<{message?:string}>('/api/settings/acp-logout',{profileId,confirm:true}),
 chatgptStatus:()=>request<ChatgptStatus>('/api/chatgpt/status'),
 chatgptLogin:(reconsent=false)=>post<{authorizationUrl:string}>('/api/chatgpt/login',{reconsent}),
 chatgptDisconnect:()=>post<unknown>('/api/chatgpt/disconnect',{}),
 chatgptModels:()=>request<{models:{modelId:string;name:string}[]}>('/api/chatgpt/models'),
};
