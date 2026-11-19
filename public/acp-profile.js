import {acpPanel,observeAcpJob} from './acp.js';
const metadata=new Map();
export function renderAcpProfile({row,p,api,draft,refresh,remove}){
 const el=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
 function field(key,label,type,value=p[key]||''){const wrap=el('label',label),input=el('input');input.dataset.field=key;input.type=type;input.value=value;wrap.append(input);row.append(wrap);return input;}
 function select(key,label,choices,value){const wrap=el('label',label),input=el('select');input.dataset.field=key;for(const [v,t] of choices){const o=el('option',t);o.value=v;input.append(o);}input.value=value||'';wrap.append(input);row.append(wrap);return input;}
 const provider=el('input');provider.type='hidden';provider.dataset.field='provider';provider.value='antigravity-acp';row.append(provider);
 field('name','名称','text').required=true;
 const entry=select('acpEntry','官方入口',[['cli','Antigravity CLI · agy acp'],['standalone','独立 ACP · agy_acp_server.exe']],p.acpEntry||'cli');
 const executable=field('acpExecutable','官方程序完整路径','text');const updatePlaceholder=()=>executable.placeholder=entry.value==='standalone'?'C:\\…\\agy_acp_server.exe':'C:\\…\\agy.exe';entry.onchange=updatePlaceholder;updatePlaceholder();executable.required=true;
 const layout=el('p','独立版请完整解压官方 ZIP，agy_acp_server.exe 与同版本 localharness_external.exe 放在同一文件夹；无需重命名或安装 CLI。');layout.className='hint profile-help';row.append(layout);
 const meta=metadata.get(p.id),models=meta?.models||[],choices=[['','先读取模型列表…'],...models.map(m=>[m.modelId,m.name||m.modelId])];if(p.model&&!models.some(m=>m.modelId===p.model))choices.push([p.model,p.model+'（待验证）']);
 const model=select('model','账号可用模型',choices,p.model);model.required=true;model.onchange=()=>connect('inspect');
 if(meta?.thinking)select('acpThinking','Thinking',[['','运行时默认'],...meta.thinking.options.map(o=>[o.value,o.name])],p.acpThinking);
 const chars=field('contextChars','上下文字符额度','number',p.contextChars||180000);chars.min=20000;chars.max=2000000;
 const imageLabel=el('label');imageLabel.className='check';const image=el('input');image.type='checkbox';image.dataset.field='visionEnabled';image.checked=p.visionEnabled!==false;imageLabel.append(image,document.createTextNode('允许图片输入'));row.append(imageLabel);
 const help=el('p','使用官方个人账号登录，不填写 API Key。ACP 目前仅用于交互式 Ask 和能力测试，不排队、不自动重试。剩余额度、额外积分及计费开关需到 Antigravity 检查；此处无法确认。');help.className='hint profile-help';row.append(help);
 if(meta){const info=el('p','运行时：'+(meta.agent?.name||'未报告名称')+' · 图片输入：'+(meta.imageInput?'已声明，需测试':'未声明')+' · 模型：'+models.length);info.className='hint profile-help';row.append(info);}
 const actions=el('div'),status=el('small'),panel=acpPanel();actions.className='profile-actions';status.className='profile-test-status';status.setAttribute('role','status');const buttons=[];
 const post=(url,body)=>api(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 async function connect(action){for(const b of buttons)b.disabled=true;status.textContent='正在连接官方 ACP…';try{
  const job=await post('/api/acp/connect',{action,profileId:p.id,settings:draft()}),result=await observeAcpJob({api,post,id:job.id,host:panel});
  if(['inspect','login'].includes(action)){metadata.set(p.id,result);refresh(p.id,result.currentModel);}
  else status.textContent=result.message;
 }catch(e){status.textContent=e.message;}finally{for(const b of buttons)b.disabled=false;}}
 for(const [label,action] of [['读取模型列表','inspect'],['个人账号登录','login'],['测试文字 / JSON','text'],['测试图片','vision']]){const b=el('button',label);b.type='button';b.onclick=()=>connect(action);actions.append(b);buttons.push(b);}
 const del=el('button','删除连接');del.type='button';del.onclick=remove;buttons.push(del);actions.append(del);row.append(actions,status,panel);
}
