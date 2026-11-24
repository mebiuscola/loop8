// Shared freshness rules used by the server; web/src/lib/classroom.ts and deepdive.ts mirror them. A session generation always
// identifies its transcript; regenerating analysis never changes that token.
//
// 2026-11-24: a lecture script follows only its own subtitles (they are the only source of what was
// said; materials only help correct terms). Deep Dives follow the materials they read, by the
// fingerprints recorded when they were made (lib/material-inputs.mjs); results made before that
// keep the older rule (any material change of the week).

/**
 * The materials whose content changed since `saved` (fingerprints recorded with a result), or null when
 * they cannot be compared (nothing recorded, or the week's fingerprints are not current).
 * Each change: {id, name, change: 'added' | 'removed' | 'changed'}.
 */
export function materialChanges(p,saved){
 const now=p?.materialInputs;
 if(!saved||!now?.sources||now.revision!==p.materialRevision)return null;
 const changes=[];
 for(const [id,v] of Object.entries(now.sources)){const old=saved[id];if(!old)changes.push({id,name:v.name,change:'added'});else if(old.hash!==v.hash)changes.push({id,name:v.name,change:'changed'});}
 for(const [id,old] of Object.entries(saved))if(!now.sources[id])changes.push({id,name:old.name,change:'removed'});
 return changes;
}
/** Whether the materials of a result changed: by its fingerprints, or for older results by the week's counter. */
export function materialsStale(p,value){
 const changes=materialChanges(p,value?.materialInputs);
 return changes?changes.length>0:value?.materialRevision!==p.materialRevision;
}
export function scriptState(p,s){
 const available=!!s?.generation;
 return {available,stale:available&&s.outputRevision!==s.revision};
}
export function analysisState(p,s){
 const available=!!s?.analysis?.generation||!!s?.generation&&(!s.artifactStatus||s.artifactStatus.deepDive==='complete');
 const a=s?.analysis;
 return {available,stale:available&&(scriptState(p,s).stale||(a?.generation?materialsStale(p,a)||a.scriptGeneration!==s.generation||a.outputRevision!==s.revision:materialsStale(p,s)))};
}
export function weeklyState(p){
 const a=p.weekly,available=!!a?.generation;if(!available)return {available:false,stale:false};
 if(materialsStale(p,a))return {available,stale:true};
 if(!a.selectedSessionIds)return {available,stale:p.sessions.some(s=>s.generation&&scriptState(p,s).stale)||JSON.stringify(a.sessionInputs||[])!==JSON.stringify(p.sessions.map(s=>({id:s.id,revision:s.revision,generation:s.generation||null})))};
 const changed=(a.sessionInputs||[]).some(old=>{const s=p.sessions.find(s=>s.id===old.id);return !s||scriptState(p,s).stale||s.generation!==old.generation||s.revision!==old.revision;});
 const newlyReady=p.sessions.some(s=>s.generation&&!(a.availableSessionIds||[]).includes(s.id));
 const newSession=a.knownSessionIds&&p.sessions.some(s=>!a.knownSessionIds.includes(s.id));
 const pendingChanged=(a.pendingSessionInputs||[]).some(old=>{const s=p.sessions.find(s=>s.id===old.id);return !s||s.revision!==old.revision;});
 return {available,stale:!!(changed||newlyReady||newSession||pendingChanged)};
}
export const taskKey=(mode,sessionId)=>mode==='session'?'script:'+sessionId:mode==='analysis'?'analysis:'+sessionId:mode==='reference'?'reference:'+sessionId:mode;
