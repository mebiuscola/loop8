// The only module that talks to the backend. Every call here is listed in docs/API.md.

export type TaskStatus='running'|'complete'|'partial'|'error'|string;
export interface Task{status:TaskStatus;stage?:string;error?:string;started?:string;finished?:string;warnings?:unknown[];}
export interface SourceFile{id:string;name:string;role:'bb'|'ppt'|'reading'|'srt'|'audio'|string;parseStatus?:string;progress?:string;}
export interface Session{id:string;type:string;title:string;}
export interface ChatMessage{role:'user'|'assistant';text:string;scope:string;focus:unknown;contextLabel?:string;at:string;requestId?:string;}
export interface ProjectSummary{id:string;name:string;status?:string;stage?:string;error?:string;tasks?:Record<string,Task>;}
export interface Project extends ProjectSummary{files:SourceFile[];sessions:Session[];chat?:ChatMessage[];job?:{mode:string;sessionId?:string;sourceId?:string};}
export interface InteractiveJob{id:string;status:string;stage?:string;message?:string;}
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
 ask:(id:string,question:string,scope:string,focus:unknown=null)=>post<AskResult>(project(id)+'/ask',{question,scope,focus}),
 cancelAiParse:(id:string,sourceId:string)=>post<unknown>(project(id)+'/ai-parse-cancel',{sourceId}),
 job:(kind:'acp'|'chatgpt',jobId:string)=>request<InteractiveJob>('/api/'+kind+'/jobs/'+encodeURIComponent(jobId)),
 cancelJob:(kind:'acp'|'chatgpt',jobId:string)=>post<unknown>('/api/'+kind+'/jobs/'+encodeURIComponent(jobId)+'/cancel',{}),
};
