// Follows a settings test or an ACP / ChatGPT interaction until it ends.
import {api,type TestJob,type InteractiveJobView} from './api';

export interface JobState{
 running:boolean;stage:string;message:string;failed:boolean;
 loginUrl:string;permission:InteractiveJobView['permission'];text:string;
 cancel:()=>void;answer:(optionId:string|null)=>void;
}

const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));

/** Only an https Google sign-in page without embedded credentials is offered as a link. */
export function safeGoogleLogin(url?:string){
 if(!url)return '';
 try{const u=new URL(url);return u.protocol==='https:'&&u.hostname==='accounts.google.com'&&!u.username&&!u.password?url:'';}catch{return '';}
}

export class JobRun{
 state=$state<JobState>({running:false,stage:'',message:'',failed:false,loginUrl:'',permission:null,text:'',cancel:()=>{},answer:()=>{}});
 private stopped=false;

 /** Starts `start()` and follows the job; resolves with the job result (or throws). */
 async run(start:()=>Promise<TestJob>):Promise<InteractiveJobView['result']|TestJob>{
  this.stopped=false;
  this.state={...this.state,running:true,stage:'正在开始…',message:'',failed:false,loginUrl:'',permission:null,text:''};
  try{
   const job=await start();
   // 'api' tests (and MinerU tests) are polled through /api/settings/test; ACP, ChatGPT and
   // single-slide trial parsing ('preview') have their own interactive job endpoints.
   const transport=job.transport==='acp'||job.transport==='chatgpt'||job.transport==='preview'?job.transport:undefined;
   this.state.cancel=()=>{this.stopped=true;(transport?api.cancelJob(transport,job.id):api.cancelTest(job.id)).catch(()=>{});this.state.stage='正在停止…';};
   if(transport)this.state.answer=optionId=>{const p=this.state.permission;if(p)api.answerPermission(transport,job.id,p.id,optionId).catch(e=>this.state.message=e.message);};
   for(;;){
    const view:InteractiveJobView|TestJob=transport?await api.job(transport,job.id):await api.testJob(job.id);
    const v=view as InteractiveJobView;
    this.state.stage=(v.stage||'')+(v.modelLabel&&!(v.stage||'').includes(v.modelLabel)?' · '+v.modelLabel:'');
    this.state.loginUrl=safeGoogleLogin(v.authorizationUrl);
    this.state.permission=v.permission||null;
    this.state.text=v.text||'';
    if(view.status!=='running'){
     if(view.status!=='success')throw new Error(view.message||(view.status==='cancelled'?'已停止。':'测试没有完成。'));
     this.state.message=transport?(v.result?.message||'已完成'):(view.message||'已完成');
     this.state.failed=false;
     return transport?v.result:view;
    }
    await pause(this.stopped?300:700);
   }
  }catch(e){
   this.state.message=(e as Error).message;this.state.failed=true;throw e;
  }finally{
   this.state.running=false;this.state.loginUrl='';this.state.permission=null;
  }
 }
}
