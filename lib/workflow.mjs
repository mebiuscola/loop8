// Shared freshness rules used by the server; web/src/lib/classroom.ts and deepdive.ts mirror them. A session generation always
// identifies its transcript; regenerating analysis never changes that token.
export function scriptState(p,s){
 const available=!!s?.generation;
 return {available,stale:available&&(s.materialRevision!==p.materialRevision||s.outputRevision!==s.revision)};
}
export function analysisState(p,s){
 const available=!!s?.analysis?.generation||!!s?.generation&&(!s.artifactStatus||s.artifactStatus.deepDive==='complete');
 const a=s?.analysis;
 return {available,stale:available&&(scriptState(p,s).stale||(a?.generation? a.materialRevision!==p.materialRevision||a.scriptGeneration!==s.generation||a.outputRevision!==s.revision:false))};
}
export function weeklyState(p){
 const a=p.weekly,available=!!a?.generation;if(!available)return {available:false,stale:false};
 if(a.materialRevision!==p.materialRevision)return {available,stale:true};
 if(!a.selectedSessionIds)return {available,stale:p.sessions.some(s=>s.generation&&scriptState(p,s).stale)||JSON.stringify(a.sessionInputs||[])!==JSON.stringify(p.sessions.map(s=>({id:s.id,revision:s.revision,generation:s.generation||null})))};
 const changed=(a.sessionInputs||[]).some(old=>{const s=p.sessions.find(s=>s.id===old.id);return !s||scriptState(p,s).stale||s.generation!==old.generation||s.revision!==old.revision;});
 const newlyReady=p.sessions.some(s=>s.generation&&!(a.availableSessionIds||[]).includes(s.id));
 const newSession=a.knownSessionIds&&p.sessions.some(s=>!a.knownSessionIds.includes(s.id));
 const pendingChanged=(a.pendingSessionInputs||[]).some(old=>{const s=p.sessions.find(s=>s.id===old.id);return !s||s.revision!==old.revision;});
 return {available,stale:!!(changed||newlyReady||newSession||pendingChanged)};
}
export const taskKey=(mode,sessionId)=>mode==='session'?'script:'+sessionId:mode==='analysis'?'analysis:'+sessionId:mode==='reference'?'reference:'+sessionId:mode;
