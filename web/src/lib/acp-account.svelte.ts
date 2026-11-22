// The Antigravity sign-in state lives here, not in the settings card, so a sign-in that is
// under way (and its Google link) survives switching settings pages or leaving the page.
import {JobRun} from './jobs.svelte';

export type AcpStatus='unknown'|'checking'|'ok'|'needLogin'|'error';

/**
 * What an ACP error says about the sign-in. The backend's wording (lib/acp-client.mjs):
 * "需要官方登录…" means signed out; "已认证；…无需因此重复登录" means signed in but the
 * model list timed out; other failures (start-up, timeouts) say nothing certain.
 */
export function acpErrorStatus(message:string):AcpStatus{
 if(/已认证|无需因此重复登录/.test(message))return 'ok';
 if(/需要官方登录|请在官方 Google 登录页面完成授权/.test(message))return 'needLogin';
 return 'error';
}

class AcpAccount{
 job=new JobRun();     // sign-in and model listing started by the user
 quiet=new JobRun();   // the silent check when the page opens
 status=$state<AcpStatus>('unknown');
 problem=$state('');
 get busy(){return this.job.state.running||this.quiet.state.running;}
}

export const acpAccount=new AcpAccount();
