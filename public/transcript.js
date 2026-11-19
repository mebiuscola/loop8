export function createTranscriptReader({api,post,endpoint,escape,notice,onProject}){
 const host=document.querySelector('#transcript-reader');let key='',data=null,audio=null,active=-1,stopAt=null,pending=null,follow=true,autoScrollUntil=0,token=0;
 const time=n=>{if(!Number.isFinite(n))return '00:00';n=Math.max(0,Math.floor(n));return (n>=3600?String(Math.floor(n/3600)).padStart(2,'0')+':':'')+String(Math.floor(n%3600/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');};
 const q=s=>host.querySelector(s);
 const playbackPositions=new Map();
 function reset(){
  token++;
  if(audio){
   if(key)playbackPositions.set(key,{time:pending??audio.currentTime,rate:audio.playbackRate,follow});
   audio.onloadedmetadata=audio.ontimeupdate=audio.onerror=null;
   audio.pause();audio.removeAttribute('src');audio.load();
  }
  audio=null;key='';data=null;active=-1;stopAt=null;pending=null;host.replaceChildren();host.hidden=true;
 }
 function show(value){host.hidden=!value;if(!value)reset();}
 function scrollActive(){const el=q('[data-p="'+active+'"]');if(el){autoScrollUntil=Date.now()+1000;el.scrollIntoView({behavior:'smooth',block:'center'});}}
 async function seek(index,only=false){if(!audio||!data?.audio?.matched)return;const p=data.paragraphs[index],offset=data.audio.offsetMs/1000,t=p.startMs/1000+offset,end=p.endMs/1000+offset;if(t<0||Number.isFinite(audio.duration)&&t>=audio.duration){notice('该段时间超出录音范围，请检查录音与字幕及时间偏移。');return;}stopAt=only?end:null;pending=t;try{if(audio.readyState){audio.currentTime=t;pending=null;}await audio.play();}catch{notice('无法播放这份录音。请检查格式，或点击播放器的播放按钮。');}}
 async function load(project,session,version=''){
  const next=project.id+session.id+(version||session.generation)+JSON.stringify(session.audio);if(key===next){host.hidden=false;return true;}reset();const mine=token;host.hidden=false;
  const result=await api(endpoint('transcript')+'?session='+encodeURIComponent(session.id)+(version?'&version='+encodeURIComponent(version):''));if(mine!==token)return false;
  if(!result.available){host.innerHTML='<p class="hint">'+escape(result.message)+'</p>';return false;}
  key=next;data=result;let speaker='Lecturer',chapter='',chapterAt=-Infinity;
  host.innerHTML='<div class="transcript-intro"><span>英文原段 · 中文对照</span><small>时间来自字幕，按段落定位</small></div><div class="transcript-pages">'+data.paragraphs.map((p,i)=>{let heading='';if(p.chapter&&p.chapter!==chapter&&(chapter===''||p.startMs-chapterAt>=180000)){heading='<h2>'+escape(p.chapter)+'</h2>';chapter=p.chapter;chapterAt=p.startMs;}const label=p.speaker!==speaker?'<div class="transcript-speaker">'+escape({Lecturer:'老师',Student:'学生','Unclear speaker':'发言人不明'}[p.speaker])+'</div>':'';speaker=p.speaker;return heading+'<section class="transcript-paragraph" data-p="'+i+'"><div class="paragraph-meta"><button class="timestamp" data-seek="'+i+'" '+(!data.audio?.matched?'disabled':'')+' aria-label="播放 '+time(p.startMs/1000)+'">▶ '+time(p.startMs/1000)+'</button>'+label+'</div><p class="transcript-en">'+escape(p.english).replaceAll('\n','<br>')+'</p><p class="transcript-zh">'+escape(p.chinese).replaceAll('\n','<br>')+'</p><details class="transcript-source"><summary>来源详情</summary><small>SRT '+time(p.startMs/1000)+' → '+time(p.endMs/1000)+' · cues '+p.cueIds[0]+'–'+p.cueIds.at(-1)+' · '+escape(p.speaker)+'</small>'+(p.corrections.length?'<p>ASR 修正：'+escape(p.corrections.join('; '))+'</p>':'')+(data.audio?.matched?'<button data-only="'+i+'">只听这一段</button>':'')+'</details></section>';}).join('')+'</div><div class="lesson-player"></div>';
  for(const issue of data.contentAudit||[]){const row=host.querySelector('[data-p=\"'+issue.segmentIndex+'\"] .transcript-source');if(row){const note=document.createElement('p');note.textContent='\u5185\u5bb9\u5f85\u6838\u5bf9\uff1a'+issue.issues.join('\uff1b');row.append(note);row.querySelector('summary').textContent+=' \u00b7 \u5f85\u6838\u5bf9';}}
  host.querySelectorAll('[data-seek]').forEach(b=>b.onclick=()=>seek(+b.dataset.seek));host.querySelectorAll('[data-only]').forEach(b=>b.onclick=()=>seek(+b.dataset.only,true));
  const player=q('.lesson-player');if(!data.audio){player.innerHTML='<p class="hint">上传本节课录音后，可点击段落时间戳播放。</p>';return true;}
  player.innerHTML='<div class="audio-heading"><b>'+escape(data.audio.name)+'</b><small class="audio-state" role="status"></small></div><div class="audio-binding" '+(data.audio.matched?'hidden':'')+'><p>录音与此讲稿的字幕版本未关联。请确认录音对应当前字幕，再关联；历史讲稿请切回当前版本。</p><button class="rebind">确认关联当前字幕</button></div><audio preload="metadata" controls></audio><div class="audio-tools"><button class="back">−10 秒</button><button class="forward">＋10 秒</button><label>速度 <select class="audio-speed" aria-label="播放速度"><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label><label class="check"><input type="checkbox" class="audio-follow" checked> 跟随讲稿</label><button class="return-active">回到当前段</button><details><summary>时间校准</summary><label>录音时间 = 字幕时间 ＋ <input class="audio-offset" type="number" step="0.1" min="-86400" max="86400" value="'+data.audio.offsetMs/1000+'"> 秒</label><button class="save-offset">保存偏移</button><small>适用于开头时差；中途剪辑需重新对齐字幕。</small></details></div>';
  const saved=playbackPositions.get(key);
  audio=q('audio');follow=saved?.follow??true;active=-1;
  q('.audio-follow').checked=follow;
  if(saved){
   audio.defaultPlaybackRate=audio.playbackRate=saved.rate;
   q('.audio-speed').value=String(saved.rate);
   if(Number.isFinite(saved.time))pending=saved.time;
  }
  audio.onloadedmetadata=()=>{const end=data.paragraphs.at(-1).endMs/1000+data.audio.offsetMs/1000;q('.audio-state').textContent=Number.isFinite(audio.duration)&&end>audio.duration+3?'字幕末段超出录音长度，请核对文件或校准时间。':'录音保存在本机';if(pending!==null){audio.currentTime=Math.max(0,Math.min(audio.duration||Infinity,pending));pending=null;}};
  audio.onerror=()=>q('.audio-state').textContent='浏览器无法播放此录音编码，可换成 MP3 或 WAV。';
  audio.ontimeupdate=()=>{if(stopAt!==null&&audio.currentTime>=stopAt){audio.pause();stopAt=null;}if(!data.audio.matched)return;const ms=audio.currentTime*1000-data.audio.offsetMs;let index=-1;for(let i=data.paragraphs.length-1;i>=0;i--){const p=data.paragraphs[i];if(ms>=p.startMs&&ms<p.endMs){index=i;break;}}if(index===active)return;q('[data-p="'+active+'"]')?.classList.remove('playing');active=index;q('[data-p="'+active+'"]')?.classList.add('playing');if(follow&&active>=0&&!audio.paused)scrollActive();};
  q('.back').onclick=()=>{stopAt=null;audio.currentTime=Math.max(0,audio.currentTime-10);};q('.forward').onclick=()=>{stopAt=null;audio.currentTime=Math.min(Number.isFinite(audio.duration)?audio.duration:Infinity,audio.currentTime+10);};q('.audio-speed').onchange=e=>audio.playbackRate=+e.target.value;
  q('.audio-follow').onchange=e=>follow=e.target.checked;q('.return-active').onclick=()=>{follow=true;q('.audio-follow').checked=true;scrollActive();};
  async function binding(value){try{const p=await post(endpoint('audio-binding'),{sessionId:session.id,...value});onProject(p);await load(p,p.sessions.find(s=>s.id===session.id),version);notice('录音时间关联已保存。');}catch(e){notice(e.message);}}
  q('.rebind').onclick=()=>binding({bindCurrent:true});q('.save-offset').onclick=()=>{const input=q('.audio-offset');if(!input.reportValidity())return;binding({offsetMs:Number(input.value)*1000});};
  audio.src=data.audio.url;
  return true;
 }
 // User scroll pauses following, while programmatic scroll retains it.
 addEventListener('wheel',()=>{if(!host.hidden&&Date.now()>autoScrollUntil&&follow&&q('.audio-follow')){follow=false;q('.audio-follow').checked=false;}},{passive:true});
 addEventListener('touchmove',()=>{if(!host.hidden&&follow&&q('.audio-follow')){follow=false;q('.audio-follow').checked=false;}},{passive:true});
 return {load,reset,show};
}
