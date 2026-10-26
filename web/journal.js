const $ = id => document.getElementById(id);
const LOCAL_API = 'http://127.0.0.1:43127';
const CACHE_KEY = 'ridian.snapshot.v1';
const TOKEN_KEY = 'ridian.connection.v1';
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const shift = (date, n) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate()+n); return localDate(d); };
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(+new Date(`${value}T12:00:00`)) && localDate(new Date(`${value}T12:00:00`)) === value;
function storageGet(storage, key) { try { return storage.getItem(key); } catch { return null; } }
function storageSet(storage, key, value) { try { if (value === null) storage.removeItem(key); else storage.setItem(key,value); } catch {} }
let token = storageGet(sessionStorage, TOKEN_KEY) || '';
const fragment = new URLSearchParams(location.hash.slice(1));
if (fragment.has('key')) { token = fragment.get('key'); storageSet(sessionStorage,TOKEN_KEY,token); history.replaceState(null,'',location.pathname+location.search); }
let data = { version: 1, tasks: [], today: localDate() }, mode = 'disconnected', year = new Date().getFullYear(), selected = localDate(), loading = false, digest = '', toastTimer;
const dateOptions = { month:'long', day:'numeric' };
function validSnapshot(value) {
  return value && value.version === 1 && Array.isArray(value.tasks) && value.tasks.length <= 100000 && value.tasks.every(t => typeof t.id === 'string' && typeof t.title === 'string' && t.title.length <= 240 && validDate(t.date) && (!t.completedDate || validDate(t.completedDate)) && (!t.completedAt || (typeof t.completedAt === 'string' && !Number.isNaN(Date.parse(t.completedAt)))));
}
function notice(message = '') { $('notice').hidden = !message; $('notice').textContent = message; }
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => $('toast').hidden = true, 2600); }
function stateLabel(label, live = false) { $('connection-state').replaceChildren(); const dot=document.createElement('i'); $('connection-state').append(dot,document.createTextNode(label)); $('connection-state').classList.toggle('live',live); }
function counts() { const map = new Map(); for (const t of data.tasks) if (t.completedAt && t.completedDate) map.set(t.completedDate,(map.get(t.completedDate)||0)+1); return map; }
function render() {
  const today = data.today || localDate();
  const stamp = new Date(`${today}T12:00:00`);
  $('stamp-month').textContent = stamp.toLocaleDateString('zh-CN',{ month:'long' });
  $('stamp-day').textContent = stamp.getDate();
  $('stamp-weekday').textContent = stamp.toLocaleDateString('zh-CN',{ weekday:'long' });
  $('year-label').textContent = year;
  $('next-year').disabled = year >= Number(today.slice(0,4));
  $('date-picker').value = selected; $('date-picker').max = today;
  $('next-day').disabled = selected >= today;
  const map = counts();
  const first = `${year}-01-01`, last = `${year}-12-31`;
  const offset = (new Date(`${first}T12:00:00`).getDay()+6)%7;
  const cells = Math.ceil((Math.round((new Date(`${last}T12:00:00`)-new Date(`${first}T12:00:00`))/86400000)+1+offset)/7)*7;
  const columns = cells/7;
  $('heatmap').style.gridTemplateColumns = `repeat(${columns},1fr)`;
  $('month-labels').style.gridTemplateColumns = `repeat(${columns},1fr)`;
  const heat=document.createDocumentFragment(), labels=document.createDocumentFragment();
  let total = 0, activeDays = 0, streak = 0, longest = 0;
  for (let i=0; i<cells; i++) {
    const date = shift(first,i-offset);
    if (date<first || date>last) { const blank=document.createElement('span'); blank.className='padding-day'; heat.append(blank); continue; }
    const d = new Date(`${date}T12:00:00`);
    if (d.getDate()===1) { const label=document.createElement('span'); label.textContent=`${d.getMonth()+1}月`; label.style.gridColumn=String(Math.floor(i/7)+1); labels.append(label); }
    const count = map.get(date)||0;
    total += count; if(count) {activeDays++; streak++; longest=Math.max(longest,streak);} else streak=0;
    const level = count===0?0:count===1?1:count<=3?2:count<=5?3:4;
    const button=document.createElement('button'); button.type='button'; button.className=`level-${level}${selected===date?' selected':''}${date>today?' future':''}`;
    button.disabled = date>today; button.dataset.date=date; button.setAttribute('aria-label',`${date}，完成 ${count} 件`); button.setAttribute('aria-pressed',selected===date); button.title=`${date} · ${count ? `完成 ${count} 件事` : '暂无完成记录'}`;
    button.onclick=()=>{selected=date;render();}; heat.append(button);
  }
  $('heatmap').replaceChildren(heat); $('month-labels').replaceChildren(labels);
  $('year-summary').replaceChildren();
  if (total) {
    for (const [index, part] of [`${total} 件完成`,' · ',`${activeDays} 个有进展的日子`,' · ',`最长连续 ${longest} 天`].entries()) { const node=document.createElement(index%2?'span':'strong'); node.textContent=part; $('year-summary').append(node); }
  } else $('year-summary').textContent = '还没有完成记录，今天就是一个好的开始。';
  renderDay(today);
}
function renderDay(today) {
  const date = new Date(`${selected}T12:00:00`);
  $('selected-title').textContent = date.toLocaleDateString('zh-CN',dateOptions);
  $('selected-subtitle').textContent = `${date.toLocaleDateString('zh-CN',{weekday:'long'})}${selected===today?' · 今天':''}`;
  const tasks = data.tasks.filter(t => t.completedDate===selected || t.date===selected || (selected===today && !t.completedAt && t.date<today));
  tasks.sort((a,b)=>Number(!a.completedAt)-Number(!b.completedAt) || (a.completedAt||a.createdAt||'').localeCompare(b.completedAt||b.createdAt||''));
  const list=document.createDocumentFragment();
  for (const task of tasks) {
    const row=document.createElement('li'); row.className=`day-task${task.completedAt?' done':''}`;
    const symbol=document.createElement('span'); symbol.className='task-symbol'; symbol.setAttribute('aria-label',task.completedAt?'已完成':'待完成');
    if (task.completedAt) symbol.innerHTML='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>';
    const content=document.createElement('div'); content.className='day-task-content';
    const title=document.createElement('div'); title.className='day-task-title'; title.textContent=task.title;
    if(task.priority && task.priority!=='normal'){const flag=document.createElement('i');flag.className=`priority-mark ${task.priority}`;flag.title=task.priority==='high'?'优先做':'慢慢来';title.append(flag);}
    content.append(title);
    const bits=[];
    if(task.completedDate && task.completedDate!==selected) bits.push(`${task.completedDate} 完成`);
    if(task.date<selected) bits.push(`从 ${new Date(`${task.date}T12:00:00`).toLocaleDateString('zh-CN',dateOptions)} 接着做`);
    if(task.strategyId) bits.push('按计划生成');
    if(bits.length){const meta=document.createElement('div');meta.className='day-task-meta';meta.textContent=bits.join(' · ');content.append(meta);}
    const time=document.createElement('span');time.className='task-time';time.textContent=task.completedAt?new Date(task.completedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',timeZone:data.timezone||undefined}):'待完成';
    row.append(symbol,content,time);list.append(row);
  }
  $('day-tasks').replaceChildren(list); $('day-empty').hidden=tasks.length>0;
  const done=tasks.filter(t=>t.completedDate===selected).length;
  $('day-footnote').textContent = tasks.length ? (done ? `这一天，完成了 ${done} 件小事。` : '事情还在路上，按自己的节奏来。') : '';
}
async function connect(manual=false) {
  if(loading || mode==='demo' || mode==='import') return;
  if(!token) { if(manual) toast('请从桌面日点的菜单打开记录页，或在「数据与连接」中粘贴密钥。'); $('connection-panel').hidden=false; stateLabel('等待连接桌面'); return; }
  loading=true;
  try {
    const res=await fetch(`${LOCAL_API}/api/v1/history`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(5000)});
    if(!res.ok) throw new Error(res.status===401?'连接密钥已失效，请从日点菜单重新打开记录页。':'本机接口暂时无法读取。');
    const next=await res.json(); if(!validSnapshot(next)) throw new Error('记录格式无法识别。');
    const nextDigest=JSON.stringify([next.tasks,next.today]);
    data=next;mode='live';storageSet(localStorage,CACHE_KEY,JSON.stringify(data));
    $('connection-panel').hidden=true;notice();stateLabel('已连接本机',true);
    if(nextDigest!==digest){digest=nextDigest;render();}
  } catch(e) {
    if(data.tasks.length || storageGet(localStorage,CACHE_KEY)){mode='offline';stateLabel('离线快照');notice(`显示最近保存的记录${data.exportedAt?` · ${new Date(data.exportedAt).toLocaleString('zh-CN')}`:''}。打开桌面日点后会自动更新。`);$('connection-panel').hidden=true;}
    else {mode='disconnected';stateLabel('桌面未连接');$('connection-panel').hidden=false;if(manual)notice(e.name==='TypeError'?'请保持日点运行，并允许浏览器访问本地网络。也可以从日点菜单打开本地记录页。':e.message);}
  } finally {loading=false;}
}
function demoData(){
  const today=localDate();const tasks=[];const titles=['读完一章书','整理今天的想法','出门走走','复习昨天的内容','把桌面收拾干净','完成一段专注工作','给自己留一点时间'];
  for(let i=89;i>=0;i--){const date=shift(today,-i);const n=(i*17+3)%7;for(let j=0;j<n;j++)tasks.push({id:`demo-${i}-${j}`,title:titles[(i+j)%titles.length],date,priority:j===0&&i%3===0?'high':'normal',createdAt:`${date}T08:00:00+08:00`,completedAt:`${date}T${String(10+j).padStart(2,'0')}:20:00+08:00`,completedDate:date});}
  return {version:1,today,tasks,timezone:'Asia/Shanghai',exportedAt:new Date().toISOString()};
}
$('demo').onclick=()=>{data=demoData();mode='demo';year=Number(data.today.slice(0,4));selected=data.today;$('connection-panel').hidden=true;notice('这是示例记录，未写入你的清单。点击「重新连接桌面」即可退出示例。');stateLabel('示例预览');$('retry').textContent='重新连接桌面';$('connection-panel').hidden=false;$('demo').hidden=true;render();};
$('retry').onclick=()=>{if(mode==='demo'||mode==='import'){mode='disconnected';data={version:1,tasks:[],today:localDate()};digest='';$('demo').hidden=false;notice();render();}connect(true);};
$('previous-year').onclick=()=>{year--;render();};$('next-year').onclick=()=>{year++;render();};
function selectDate(date){if(!validDate(date)||date>(data.today||localDate()))return;selected=date;year=Number(date.slice(0,4));render();}
$('previous-day').onclick=()=>selectDate(shift(selected,-1));$('next-day').onclick=()=>selectDate(shift(selected,1));$('date-picker').onchange=e=>selectDate(e.target.value);$('back-today').onclick=()=>selectDate(data.today||localDate());
$('export').onclick=()=>{const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`日点${mode==='demo'?'-示例':''}-${data.today||localDate()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('import').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>10*1024*1024)throw new Error('备份文件不能超过 10 MB。');const next=JSON.parse(await file.text());if(!validSnapshot(next))throw new Error('这不是有效的日点备份。');data={...next,today:localDate()};mode='import';selected=data.today;year=Number(selected.slice(0,4));stateLabel('备份预览');notice('正在查看导入的备份，本机清单不会被覆盖。');$('connection-panel').hidden=false;$('retry').textContent='重新连接桌面';render();}catch(err){toast(err.message);}e.target.value='';};
$('disconnect').onclick=()=>{token='';storageSet(sessionStorage,TOKEN_KEY,null);storageSet(localStorage,CACHE_KEY,null);data={version:1,tasks:[],today:localDate()};mode='disconnected';digest='';notice();render();connect();};
$('connect-form').onsubmit=e=>{e.preventDefault();let value=$('connection-key').value.trim();try{const config=JSON.parse(value);value=config.token||config.readToken||value;}catch{}token=value;storageSet(sessionStorage,TOKEN_KEY,token);$('connection-key').value='';mode='disconnected';digest='';connect(true);};
try{const cached=JSON.parse(storageGet(localStorage,CACHE_KEY)||'null');if(validSnapshot(cached)){data=cached;mode='offline';}}catch{}
render();connect();setInterval(()=>{if(!document.hidden)connect();},8000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)connect();});
