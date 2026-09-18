const SUPABASE_URL='https://yemppwfpabhcurazxsyk.supabase.co';
const SUPABASE_ANON_KEY='sb_publishable_n655g8Etm2OOWj6CEioHCA_91FoJZnb';
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);

const state={
  subjects:[], courses:[], sessions:[],
  settings:{start_date:'2026-09-17',offline_day:2,allow_weekends:true},
  month:new Date(2026,8,1), selectedSubject:'all', calendarView:(window.innerWidth<=700?'week':'month'), weekAnchor:new Date(2026,8,17),
  adminToken:localStorage.getItem('studyPlannerAdminToken')||'', viewerMode:false,
  timer:{id:1,status:'idle',session_id:null,course_id:null,started_at:null,accumulated_seconds:0},
  timerTicker:null, timerPollTick:0, dayOffs:new Set(), canUndo:false, undoLabel:'', timerRecovery:false
};
const $=id=>document.getElementById(id);
const pad=n=>String(n).padStart(2,'0');
const localDate=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseDate=s=>{if(!s)return new Date();const [y,m,d]=String(s).split('-').map(Number);return new Date(y,m-1,d)};
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
const colors=['#7d8cff','#48d5ae','#e7bd61','#ec7a8c','#5db6ea','#c28cff','#f08d53','#7ecf73','#db72b4','#8fb5ff'];
const subjectColor=id=>colors[Math.abs(Number(id||0))%colors.length];
const subjectName=id=>state.subjects.find(s=>Number(s.id)===Number(id))?.name||'—';
const courseById=id=>state.courses.find(c=>Number(c.id)===Number(id));
const sessionsForCourse=id=>state.sessions.filter(s=>Number(s.course_id)===Number(id));
const courseStatus=c=>{const ss=sessionsForCourse(c.id);return ss.length&&ss.every(x=>x.completed)?'done':ss.length?'active':'todo'};
const fmtLong=d=>d.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

const TIMER_BACKUP_KEY='studyPlannerTimerBackup';
const TIMER_RESET_UI_KEY='studyPlannerTimerResetV55';
function oneTimeTimerUiReset(){
  try{
    if(localStorage.getItem(TIMER_RESET_UI_KEY)!=='1'){
      localStorage.removeItem(TIMER_BACKUP_KEY);
      localStorage.setItem(TIMER_RESET_UI_KEY,'1');
    }
  }catch{}
}
const THEME_KEY='studyPlannerTheme';
function getThemePreference(){return localStorage.getItem(THEME_KEY)||'auto';}
function applyThemePreference(){
  const pref=getThemePreference();
  const dark=pref==='dark' || (pref==='auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme=dark?'dark':'light';
  const btn=$('themeToggle');
  if(btn){ btn.textContent=pref==='auto'?'🌓 Auto':(pref==='dark'?'☀️ Normal':'🌙 Night'); btn.title=pref==='auto'?'Mode automatique':(pref==='dark'?'Passer au mode normal':'Passer au mode nuit'); }
}
function cycleThemePreference(){
  const next={auto:'dark',dark:'light',light:'auto'}[getThemePreference()];
  localStorage.setItem(THEME_KEY,next); applyThemePreference();
}


function setSaveState(text,good=true){$('saveState').textContent=text;$('saveState').className=good?'synced':'unsynced'}
function isAdmin(){return Boolean(state.adminToken)}
function showApp(){ $('loginLanding').classList.add('hidden'); $('appRoot').classList.remove('hidden'); }
function showLanding(){ $('loginLanding').classList.remove('hidden'); $('appRoot').classList.add('hidden'); }
async function enterViewer(){ state.viewerMode=true; showApp(); await load(); render(); }
function adminGuard(){if(!isAdmin()){alert('Cette action est réservée à l’administrateur.');return false}return true}
function adminError(error){
  const msg=error?.message||String(error||'Erreur');
  if(/admin|token|session/i.test(msg)){state.adminToken='';localStorage.removeItem('studyPlannerAdminToken');renderAdminState();}
  alert(msg); setSaveState('● Erreur',false);
}


async function ensureAllCoursesHaveSession(){
  if(!state.courses?.length || !isAdmin()) return;
  const {data,error}=await sb.rpc('admin_ensure_course_coverage',{p_token:state.adminToken});
  if(error){console.warn('admin_ensure_course_coverage:',error.message);return;}
  if(data?.added) await load();
}

function readTimerBackup(){
  try{
    const raw=localStorage.getItem(TIMER_BACKUP_KEY);
    if(!raw) return null;
    const t=JSON.parse(raw);
    if(!t || !['running','paused'].includes(t.status) || !t.session_id) return null;
    return t;
  }catch{return null;}
}
function writeTimerBackup(t){
  if(!t || !['running','paused'].includes(t.status) || !t.session_id){localStorage.removeItem(TIMER_BACKUP_KEY);return;}
  localStorage.setItem(TIMER_BACKUP_KEY,JSON.stringify({
    session_id:t.session_id, course_id:t.course_id||null, status:t.status,
    started_at:t.started_at||null, accumulated_seconds:Math.max(0,Number(t.accumulated_seconds||0)),
    saved_at:new Date().toISOString()
  }));
}
function clearTimerBackup(){localStorage.removeItem(TIMER_BACKUP_KEY); state.timerRecovery=false;}
function reconcileTimer(serverTimer){
  const server=serverTimer||{id:1,status:'idle',session_id:null,course_id:null,started_at:null,accumulated_seconds:0};
  if(['running','paused'].includes(server.status)){
    state.timerRecovery=false; writeTimerBackup(server); return server;
  }
  const backup=readTimerBackup();
  if(backup){
    const s=state.sessions.find(x=>String(x.id)===String(backup.session_id));
    const age=backup.saved_at?Date.now()-Date.parse(backup.saved_at):0;
    if(s && !s.completed && age>=0 && age<72*3600*1000){
      state.timerRecovery=true;
      return {id:1,status:backup.status,session_id:backup.session_id,course_id:backup.course_id||s.course_id,started_at:backup.started_at||null,accumulated_seconds:Number(backup.accumulated_seconds||0)};
    }
    clearTimerBackup();
  }
  state.timerRecovery=false;
  return server;
}
async function load(){
 oneTimeTimerUiReset();
 const [a,b,c,d,t,o]=await Promise.all([
  sb.from('subjects').select('*').order('sort_order').order('name'),
  sb.from('courses_v2').select('*').order('global_order', {ascending:true, nullsFirst:false}).order('sort_order'),
  sb.from('study_sessions_v2').select('*').order('study_date'),
  sb.from('planner_settings').select('*').eq('id',1).single(),
  sb.from('study_timer_state').select('*').eq('id',1).single(),
  sb.from('planner_day_offs').select('off_date')
 ]);
 const err=a.error||b.error||c.error||d.error||t.error||o.error;
 if(err){console.error(err);setSaveState('● Erreur',false);return false}
 state.subjects=a.data||[]; state.courses=b.data||[]; state.sessions=c.data||[]; state.settings=d.data||state.settings;
 state.timer=reconcileTimer(t.data);
 state.dayOffs=new Set((o.data||[]).map(x=>String(x.off_date)));
 if(state.settings?.start_date && !sessionStorage.getItem('plannerMonthInitialized')){
   const start=parseDate(state.settings.start_date); state.month=new Date(start.getFullYear(),start.getMonth(),1); sessionStorage.setItem('plannerMonthInitialized','1');
 }
 return true;
}

function render(){renderAdminState();renderStudyTimer();renderMonthStrip();renderSubjects();renderCalendar();renderRightSidebar();}

function timerSeconds(){
  const t=state.timer||{};
  if(!['running','paused'].includes(t.status)) return 0;
  let sec=Number(t.accumulated_seconds||0);
  if(t.status==='running' && t.started_at){
    const started=Date.parse(t.started_at);
    if(Number.isFinite(started)) sec += Math.max(0,Math.floor((Date.now()-started)/1000));
  }
  return sec;
}
function fmtTimer(sec){
  sec=Math.max(0,Math.floor(sec||0));
  const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
function timerSession(){return state.sessions.find(s=>String(s.id)===String(state.timer?.session_id));}
function timerCourse(){const s=timerSession();return courseById(state.timer?.course_id||s?.course_id);}
function renderStudyTimer(){
  const t=state.timer||{}, s=timerSession(), c=timerCourse();
  const bar=$('studyTimerBar');
  if(!$('studyTimerTitle')) return;
  const active=t.status==='running'||t.status==='paused';
  // The timer bar is only part of the header while a timer is active or recoverable.
  // When a session is ended, it disappears completely from the header.
  bar?.classList.toggle('hidden', !(active || state.timerRecovery));
  $('studyTimerTitle').textContent=active&&c?c.title:'Aucun chronomètre en cours';
  $('studyTimerSub').textContent=active&&c&&s
    ? `${subjectName(c.subject_id)} · ${fmtLong(parseDate(s.study_date))} · ${t.status==='running'?'En cours':'En pause'}`
    : (isAdmin() ? (state.timerRecovery?'⚠️ Chrono récupérable depuis ce navigateur. Tu peux le terminer.':'L’administrateur peut démarrer une session d’étude.') : 'Aucune session chronométrée en cours.');
  $('studyTimerClock').textContent=fmtTimer(timerSeconds());
  $('studyTimerDot').className=`study-timer-dot ${t.status||'idle'}`;
  $('timerStartBtn')?.classList.toggle('hidden',!isAdmin()||active);
  $('timerPauseBtn')?.classList.toggle('hidden',!isAdmin()||t.status!=='running');
  $('timerResumeBtn')?.classList.toggle('hidden',!isAdmin()||t.status!=='paused');
  $('timerEndBtn')?.classList.toggle('hidden',!isAdmin()||!active);
}
function startTimerDialog(){
  if(!adminGuard()) return;
  if(['running','paused'].includes(state.timer?.status)){
    if(state.timer.status==='paused'){
      if(confirm('Un chronomètre est en pause. Reprendre celui-ci ?')) resumeTimer();
      return;
    }
    alert('Un chronomètre est déjà en cours. Termine ou mets en pause la session actuelle avant d’en démarrer une autre.');
    return;
  }
  const list=state.sessions
    .filter(s=>!s.completed)
    .sort((a,b)=>a.study_date.localeCompare(b.study_date)||String(courseById(a.course_id)?.title||'').localeCompare(String(courseById(b.course_id)?.title||'')));
  $('timerChoices').innerHTML=list.length?list.map(s=>{
    const c=courseById(s.course_id);
    const duplicateCount=state.sessions.filter(x=>Number(x.course_id)===Number(s.course_id)).length;
    return `<button type="button" class="timer-choice" onclick="startTimerForSession('${s.id}')"><span><span class="timer-choice-title">${esc(c?.title||'Cours')}</span><span class="timer-choice-meta">${esc(fmtLong(parseDate(s.study_date)))} · ${esc(subjectName(c?.subject_id)||'')} · ${duplicateCount>1?duplicateCount+' séances':''}</span></span><span>▶</span></button>`;
  }).join(''):'<div class="calendar-empty">Aucune séance à étudier. Ajoute d’abord une séance au calendrier.</div>';
  $('timerStartDialog').showModal();
}
async function startTimerForSession(sessionId){
  if(!adminGuard()) return;
  const session=state.sessions.find(s=>String(s.id)===String(sessionId));
  if(!session){alert('Séance introuvable.');return;}
  if(session.completed){alert('Cette séance est déjà terminée.');return;}
  if(['running','paused'].includes(state.timer?.status)){
    const same=String(state.timer?.session_id)===String(sessionId);
    if(same && state.timer.status==='paused'){ await resumeTimer(); return; }
    alert('Un autre chronomètre est déjà actif. Termine-le ou mets-le en pause avant de changer de séance.');
    return;
  }
  setSaveState('● Démarrage du chrono…',true);
  const {data,error}=await sb.rpc('admin_timer_start',{p_token:state.adminToken,p_session_id:sessionId});
  if(error){adminError(error);return;}
  if(data?.status){ state.timer={...state.timer,status:data.status,session_id:data.session_id||sessionId,course_id:data.course_id||session.course_id,started_at:data.started_at||new Date().toISOString(),accumulated_seconds:Number(data.accumulated_seconds||0)}; state.timerRecovery=false; writeTimerBackup(state.timer); }
  $('timerStartDialog')?.close();
  $('detailDialog')?.close();
  await load();
  render();
  ensureTimerTicker();
  setSaveState('● Chrono en cours',true);
}
async function pauseTimer(){
  if(!adminGuard()) return;
  const {data,error}=await sb.rpc('admin_timer_pause',{p_token:state.adminToken});
  if(error){adminError(error);return;}
  if(data?.status){ state.timer={...state.timer,status:data.status,started_at:null}; writeTimerBackup(state.timer); }
  renderStudyTimer();
  await load(); render(); setSaveState('● Chrono en pause',true);
}
async function resumeTimer(){
  if(!adminGuard()) return;
  const {data,error}=await sb.rpc('admin_timer_resume',{p_token:state.adminToken});
  if(error){adminError(error);return;}
  if(data?.status){ state.timer={...state.timer,status:data.status,started_at:new Date().toISOString()}; writeTimerBackup(state.timer); }
  renderStudyTimer();
  await load(); render(); ensureTimerTicker(); setSaveState('● Chrono en cours',true);
}
function openTimerEnd(){
  if(!adminGuard()) return;
  const c=timerCourse();
  if(!c || !['running','paused'].includes(state.timer?.status)){alert('Aucun chronomètre actif.');return;}
  $('timerEndSummary').textContent=`${c.title} · temps étudié : ${fmtTimer(timerSeconds())}`;
  $('timerPageNumber').value=''; $('timerEndNote').value=''; $('timerEndMessage').textContent='';
  $('timerEndDialog').showModal();
}
async function endTimer(e){
  e.preventDefault(); if(!adminGuard()) return;
  const pageRaw=$('timerPageNumber').value.trim();
  const page=pageRaw?Number(pageRaw):null;
  if(pageRaw && (!Number.isInteger(page)||page<1)){
    $('timerEndMessage').textContent='Indique un numéro de page valide ou laisse le champ vide.'; return;
  }
  const note=$('timerEndNote').value.trim()||null;
  const t=state.timer||{};
  const sessionId=t.session_id||null;
  const clientStartedAt=t.status==='running' ? (t.started_at||null) : null;
  const clientAccumulatedSeconds=Math.max(0,Number(t.accumulated_seconds||0));
  const {data,error}=await sb.rpc('admin_timer_end_safe',{
    p_token:state.adminToken,
    p_session_id:sessionId,
    p_page_number:page,
    p_note:note,
    p_client_started_at:clientStartedAt,
    p_client_accumulated_seconds:clientAccumulatedSeconds
  });
  if(error){$('timerEndMessage').textContent=error.message;return;}
  clearTimerBackup();
  $('timerEndDialog').close();
  await load(); render();
  const suffix=data?.recovered_from_client?' · synchronisé depuis le navigateur':'';
  setSaveState(`● Session enregistrée (${fmtTimer(Number(data?.studied_seconds||0))})${suffix}`,true);
}
async function refreshTimerOnly(){
  const {data,error}=await sb.from('study_timer_state').select('*').eq('id',1).single();
  if(!error){state.timer=reconcileTimer(data);renderStudyTimer();}
}
function ensureTimerTicker(){
  if(state.timerTicker) return;
  state.timerTicker=setInterval(()=>{
    renderStudyTimer();
    state.timerPollTick=(state.timerPollTick||0)+1;
    if(state.timerPollTick%5===0) refreshTimerOnly();
  },1000);
}


async function getPlannerSnapshot(){
 const {data,error}=await sb.rpc('admin_get_planner_snapshot',{p_token:state.adminToken});
 if(error) throw error;
 return data;
}
function updateUndoButton(){
 const b=$('undoBtn');
 if(!b)return;
 b.disabled=!isAdmin()||!state.canUndo;
 b.title=state.canUndo?`Annuler : ${state.undoLabel||'dernière modification'}`:'Aucune modification de planning à annuler';
 b.textContent=state.canUndo?'↶ Annuler':'↶ Annuler';
}
async function recordPlannerAction(label,before){
 try{
   const after=await getPlannerSnapshot();
   const {error}=await sb.rpc('admin_record_planner_action',{
     p_token:state.adminToken,
     p_label:label,
     p_before_state:before,
     p_after_state:after
   });
   if(error) throw error;
   state.canUndo=true; state.undoLabel=label; updateUndoButton();
 }catch(err){
   console.warn('Undo history:',err.message);
 }
}
async function refreshUndoState(){
 if(!isAdmin()){state.canUndo=false;state.undoLabel='';updateUndoButton();return;}
 const {data,error}=await sb.rpc('admin_undo_status',{p_token:state.adminToken});
 if(!error && data){state.canUndo=Boolean(data.can_undo);state.undoLabel=data.label||'';}
 else {state.canUndo=false;state.undoLabel='';}
 updateUndoButton();
}
async function undoLastPlannerAction(){
 if(!adminGuard()||!state.canUndo)return;
 if(!confirm(`Annuler : ${state.undoLabel||'dernière modification du planning'} ?\n\nLes séances, dates et Day Off concernés seront restaurés.`))return;
 const {data,error}=await sb.rpc('admin_undo_last_planner_action',{p_token:state.adminToken});
 if(error){adminError(error);return;}
 state.canUndo=false; state.undoLabel='';
 await load(); render();
}


async function restoreOriginalOrder(){
  if(!adminGuard())return;
  if(!confirm('Restaurer l’ordre initial Pr Saadi → Pr Mimouni → Pr Tahiri ?\n\nLes séances terminées seront conservées. Les séances non terminées seront replanifiées.'))return;
  let beforeSnapshot=null;
  try{beforeSnapshot=await getPlannerSnapshot();}catch(e){}
  const {data,error}=await sb.rpc('admin_restore_original_order',{p_token:state.adminToken});
  if(error){adminError(error);return;}
  await load();render();
  if(beforeSnapshot) await recordPlannerAction('Restaurer l’ordre initial des cours',beforeSnapshot);
}

function renderAdminState(){
 $('adminState').textContent=isAdmin()?'🛠 Mode administrateur':'👁 Lecture seule';
 $('adminState').className=isAdmin()?'admin-state':'viewer-state';
 $('adminBtn').classList.toggle('hidden',isAdmin());
 $('logoutBtn').classList.toggle('hidden',!isAdmin());
 $('changePasswordBtn').classList.toggle('hidden',!isAdmin());
 document.querySelectorAll('.admin-only').forEach(el=>el.classList.toggle('hidden',!isAdmin()));
 updateUndoButton();
}
function renderMonthStrip(){
 const y=state.month.getFullYear();
 $('monthStrip').innerHTML=Array.from({length:12},(_,m)=>{const d=new Date(y,m,1);const active=m===state.month.getMonth();return `<button class="month-pill ${active?'active':''}" onclick="goMonth(${m})"><span class="m-label">${d.toLocaleDateString('fr-FR',{month:'short'})}</span><span class="m-meta">${y}</span></button>`}).join('');
}
function goMonth(m){state.month=new Date(state.month.getFullYear(),m,1);render();}
function navMonth(delta){
 if(state.calendarView==='week'){
   const d=new Date(state.weekAnchor); d.setDate(d.getDate()+delta*7); state.weekAnchor=d;
   state.month=new Date(d.getFullYear(),d.getMonth(),1); render();
   return;
 }
 state.month=new Date(state.month.getFullYear(),state.month.getMonth()+delta,1);
 state.weekAnchor=new Date(state.month.getFullYear(),state.month.getMonth(),1);
 render();
}
function setCalendarView(view){
 state.calendarView=view;
 if(view==='week'){
   const base=new Date(state.weekAnchor||state.month||new Date());
   if(!state.weekAnchor || state.weekAnchor.getMonth()!==state.month.getMonth() || state.weekAnchor.getFullYear()!==state.month.getFullYear()) state.weekAnchor=new Date(state.month.getFullYear(),state.month.getMonth(),1);
 }
 renderCalendar();
}

function renderSubjects(){
 const counts={};
 state.courses.forEach(c=>counts[c.subject_id]=(counts[c.subject_id]||0)+1);
 const doneCounts={};
 state.courses.forEach(c=>{ if(courseStatus(c)==='done') doneCounts[c.subject_id]=(doneCounts[c.subject_id]||0)+1; });
 const subjectProgress=s=>counts[s.id] ? Math.round(((doneCounts[s.id]||0)/counts[s.id])*100) : 0;
 const allDone=state.courses.filter(c=>courseStatus(c)==='done').length;
 const allPct=state.courses.length ? Math.round(allDone/state.courses.length*100) : 0;
 const all=`<button class="subject-btn subject-all ${state.selectedSubject==='all'?'active':''}" onclick="selectSubject('all')">
   <span class="subject-dot" style="background:#8c96a8"></span>
   <span class="subject-main"><span class="subject-name">Toutes les matières</span><span class="subject-progress-row"><span class="subject-progress-track"><span class="subject-progress-fill" style="width:${allPct}%"></span></span><span class="subject-progress-pct">${allPct}%</span></span></span>
   <span class="subject-count">${state.courses.length}</span>
 </button>`;
 $('subjectList').innerHTML=all+state.subjects.map(s=>{
   const pct=subjectProgress(s);
   return `<button class="subject-btn ${String(state.selectedSubject)===String(s.id)?'active':''}" onclick="selectSubject('${s.id}')">
     <span class="subject-dot" style="background:${subjectColor(s.id)}"></span>
     <span class="subject-main">
       <span class="subject-name">${esc(s.name)}</span>
       <span class="subject-progress-row">
         <span class="subject-progress-track"><span class="subject-progress-fill" style="width:${pct}%;background:${subjectColor(s.id)}"></span></span>
         <span class="subject-progress-pct">${pct}%</span>
       </span>
     </span>
     <span class="subject-count">${counts[s.id]||0}</span>
   </button>`;
 }).join('');
}
function selectSubject(id){state.selectedSubject=id;render();}

function monthCells(){
 const y=state.month.getFullYear(),m=state.month.getMonth(),first=new Date(y,m,1),startDay=(first.getDay()+6)%7,daysInMonth=new Date(y,m+1,0).getDate(),total=Math.ceil((startDay+daysInMonth)/7)*7;
 return Array.from({length:total},(_,i)=>{const dayNum=i-startDay+1;const d=new Date(y,m,dayNum);return {d,inside:dayNum>=1&&dayNum<=daysInMonth};});
}



function localTodayIso(){
  const d=new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function upcomingSessions(limit=8){
  const today=localTodayIso();
  return state.sessions
    .filter(s=>!s.completed && String(s.study_date)>=today)
    .filter(s=>!state.dayOffs?.has(String(s.study_date)))
    .filter(s=>state.selectedSubject==='all'||Number(courseById(s.course_id)?.subject_id)===Number(state.selectedSubject))
    .sort((a,b)=>String(a.study_date).localeCompare(String(b.study_date)))
    .slice(0,limit);
}


async function toggleDayOff(date){
  if(!adminGuard()) return;
  let beforeSnapshot=null;
  try{beforeSnapshot=await getPlannerSnapshot();}catch(err){console.warn('Undo snapshot:',err.message)}
  const isOff=state.dayOffs?.has(String(date));
  const rpc=isOff?'admin_remove_day_off_shift':'admin_add_day_off_shift';
  const {data,error}=await sb.rpc(rpc,{p_token:state.adminToken,p_off_date:date});
  if(error){adminError(error);return;}
  await load();
  render();
  if(beforeSnapshot) await recordPlannerAction(isOff?'Annuler un Day Off':'Mettre un Day Off et décaler le planning',beforeSnapshot);
}
function addDayOffUI(){}
function weekCells(){
 const anchor=new Date(state.weekAnchor||new Date());
 const monday=new Date(anchor); monday.setDate(anchor.getDate()-((anchor.getDay()+6)%7));
 return Array.from({length:7},(_,i)=>{const d=new Date(monday);d.setDate(monday.getDate()+i);return {d,inside:d.getMonth()===state.month.getMonth()&&d.getFullYear()===state.month.getFullYear()};});
}
function calendarDayHtml(d,inside){
 const ds=localDate(d), weekDay=(d.getDay()+6)%7, weekend=weekDay>=5, todayClass=ds===localDate(new Date())?'today':'';
 const weekdayNames=['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
 const allDaySessions=state.sessions.filter(s=>s.study_date===ds).filter(s=>state.selectedSubject==='all'||Number(courseById(s.course_id)?.subject_id)===Number(state.selectedSubject));
 const pills=allDaySessions.map(s=>{const c=courseById(s.course_id);if(!c)return '';const done=s.completed?' done':'';const modeLabel=s.mode==='offline'?'OFFLINE':'ONLINE';const drive=c.drive_url?`<a class="pill-drive" href="${esc(c.drive_url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" title="Ouvrir le cours sur Google Drive">DRIVE</a>`:'';return `<div class="session-pill ${done}" style="--subject-color:${subjectColor(c.subject_id)}" onclick="event.stopPropagation();openSession('${s.id}')"><div class="pill-title">${esc(c.title)}</div><div class="pill-meta"><span class="mode-badge ${s.mode==='offline'?'offline-badge':'online-badge'}">${modeLabel}</span>${drive}${s.completed?'<span class="done-badge">✓</span>':''}</div></div>`}).join('');
 const isDayOff=state.dayOffs?.has(String(ds));
 const addButton=isAdmin()&&inside?`<button class="add-cell" type="button" aria-label="Ajouter un cours le ${esc(weekdayNames[d.getDay()])} ${d.getDate()}" title="Ajouter un cours" onclick="event.stopPropagation();openSessionForm('${ds}')">＋</button>`:'';
 return `<div data-date="${ds}" class="day-cell ${inside?'inside':'outside'} ${weekend?'weekend':''} ${isDayOff?'day-off-cell':''} ${todayClass} ${isAdmin()&&inside?'admin-clickable':''}" ${isAdmin()&&inside?`onclick="openSessionForm('${ds}')" title="Cliquer pour ajouter un cours à cette journée"`:''}>
   <div class="day-number"><span class="num">${d.getDate()}</span><span class="day-head-right"><span class="weekday-label">${weekdayNames[d.getDay()]}</span>${addButton}</span></div>
   <div class="day-sessions">${isDayOff?`<span class="day-off-badge-v38">DAY OFF</span>`:''}${pills||`<div class="calendar-empty">${isDayOff?'Aucun cours — journée off':'Aucune séance'}</div>`}</div>
 </div>`;
}
function renderCalendar(){
 const scheduledCourseCount=new Set(state.sessions.map(s=>String(s.course_id))).size;
 $('monthSubtitle').textContent=`${state.courses.length} cours · ${scheduledCourseCount} planifiés · ${state.sessions.length} séances`;
 const activeDate=state.calendarView==='week'?(state.weekAnchor||new Date()):state.month;
 $('monthTitle').textContent=state.calendarView==='week'
   ? (()=>{const cells=weekCells();const a=cells[0].d,b=cells[6].d;return a.getMonth()===b.getMonth()?`Semaine du ${a.getDate()} au ${b.getDate()} ${a.toLocaleDateString('fr-FR',{month:'long',year:'numeric'})}`:`Semaine du ${a.getDate()} ${a.toLocaleDateString('fr-FR',{month:'short'})} au ${b.getDate()} ${b.toLocaleDateString('fr-FR',{month:'short',year:'numeric'})}`})()
   : state.month.toLocaleDateString('fr-FR',{month:'long',year:'numeric'});
 const cells=state.calendarView==='week'?weekCells():monthCells();
 const grid=$('monthGrid');
 grid.classList.toggle('week-view',state.calendarView==='week');
 const calendarEl=document.querySelector('.calendar');
 if(calendarEl){ calendarEl.classList.toggle('week-horizontal',state.calendarView==='week'); }
 grid.innerHTML=cells.map(({d,inside})=>calendarDayHtml(d,inside)).join('');
 document.querySelectorAll('.calendar-view-toggle .view-btn').forEach(b=>b.classList.remove('active'));
 const activeBtn=$(state.calendarView==='week'?'weekViewBtn':'monthViewBtn'); if(activeBtn)activeBtn.classList.add('active');
 const prev=$('prevMonth'),next=$('nextMonth');
 if(prev)prev.title=state.calendarView==='week'?'Semaine précédente':'Mois précédent';
 if(next)next.title=state.calendarView==='week'?'Semaine suivante':'Mois suivant';
}

function renderRightSidebar(){
 const filtered=state.selectedSubject==='all'?state.courses:state.courses.filter(c=>Number(c.subject_id)===Number(state.selectedSubject));
 $('selectedSubjectTitle').textContent=state.selectedSubject==='all'?'Toutes les matières':subjectName(state.selectedSubject);
 $('focusCourses').textContent=filtered.length;
 $('focusActive').textContent=filtered.filter(c=>state.sessions.some(s=>Number(s.course_id)===Number(c.id))).length;
 $('focusDone').textContent=filtered.filter(c=>courseStatus(c)==='done').length;
 const today=localDate(new Date());
 const upcoming=upcomingSessions(8);
 $('upcomingCount').textContent=upcoming.length;
 $('upcomingList').innerHTML=upcoming.length?upcoming.map(s=>{const c=courseById(s.course_id);return `<div class="upcoming-item ${s.completed?'completed':''}" onclick="openSession('${s.id}')"><div class="up-date">${fmtLong(parseDate(s.study_date))}</div><div class="up-title">${esc(c?.title||'Cours')}</div><div class="up-subject">${esc(subjectName(c?.subject_id))} · ${s.mode}</div></div>`}).join(''):'<div class="calendar-empty">Aucune séance future.</div>';
}

function fillCourseSelect(selected){
 $('courseSelect').innerHTML=state.courses.map(c=>`<option value="${c.id}">${esc(c.title)} — ${esc(subjectName(c.subject_id))}</option>`).join('');
 if(selected!=null) $('courseSelect').value=String(selected);
}
function isoWeekMonday(d){const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());const i=(x.getDay()+6)%7;x.setDate(x.getDate()-i);return x}
function stableWeekHash(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function officialOfflineWeekday(dateObj){const monday=isoWeekMonday(dateObj);const prev=new Date(monday);prev.setDate(prev.getDate()-7);let day=stableWeekHash(localDate(monday))%5;const prevDay=stableWeekHash(localDate(prev))%5;if(day===prevDay) day=(day+1)%5;return day}
function officialOfflineName(dateObj){return ['Lundi','Mardi','Mercredi','Jeudi','Vendredi'][officialOfflineWeekday(dateObj)]}
function isOfflineDate(dateStr){const stored=state.sessions.find(s=>s.study_date===dateStr);if(stored)return stored.mode==='offline';const d=parseDate(dateStr),i=(d.getDay()+6)%7;return i===officialOfflineWeekday(d)}

function sessionHasCourse(courseId){
 return state.sessions.some(s=>Number(s.course_id)===Number(courseId));
}
function fillAvailableCourseSelect(selected){
 const all=state.courses.slice().sort((a,b)=>(Number(a.global_order||999999)-Number(b.global_order||999999))||(Number(a.sort_order||0)-Number(b.sort_order||0)));
 const select=$('courseSelect');
 select.innerHTML=all.length
   ? all.map(c=>{
       const count=state.sessions.filter(s=>Number(s.course_id)===Number(c.id)).length;
       const suffix=count>0?` · ${count} séance${count>1?'s':''} déjà planifiée${count>1?'s':''}`:'';
       return `<option value="${c.id}">${esc(c.title)} — ${esc(subjectName(c.subject_id))}${esc(suffix)}</option>`;
     }).join('')
   : '<option value="">Aucun cours existant</option>';
 $('availableCourseHint').classList.toggle('hidden',all.length===0);
 $('availableCourseHint').innerHTML=all.length
   ? 'Tous les cours sont sélectionnables. <strong>Un même cours peut être planifié 2, 3, 10 fois ou plus</strong>, y compris le même jour.'
   : 'Aucun cours existant. Crée un nouveau cours ci-dessous.';
 if(selected!=null) select.value=String(selected);
 return all;
}

function fillNewCourseSubjects(){
 $('newCourseSubject').innerHTML=state.subjects.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
 if(state.selectedSubject!=='all' && state.subjects.some(s=>String(s.id)===String(state.selectedSubject))) $('newCourseSubject').value=String(state.selectedSubject);
}
function toggleNewCourseMode(force){
 const box=$('newCourseBox');
 const enabled=typeof force==='boolean'?force:box.classList.contains('hidden');
 box.classList.toggle('hidden',!enabled);
 const btn=$('newCourseToggleBtn');
 if(btn){ btn.textContent=enabled?'✕ Fermer la création':'＋ Créer un nouveau cours'; }
 if(enabled){ fillNewCourseSubjects(); $('newCourseName').focus(); }
}
async function createNewCourseForDate(date){
 const name=$('newCourseName').value.trim();
 if(!name){$('sessionMessage').textContent='Indique le nom du nouveau cours.';return null;}
 const subjectId=Number($('newCourseSubject').value);
 if(!subjectId){$('sessionMessage').textContent='Choisis une matière.';return null;}
 const professor=$('newCourseProfessor').value.trim()||null;
 const max=Math.max(0,...state.courses.filter(c=>Number(c.subject_id)===subjectId).map(c=>Number(c.sort_order||0)));
 const {data,error}=await sb.rpc('admin_create_course',{
   p_token:state.adminToken,p_subject_id:subjectId,p_title:name,p_professor:professor,p_drive_url:null,p_sort_order:max+1
 });
 if(error){$('sessionMessage').textContent=error.message;return null;}
 const newId=Number(data);
 await load();
 return newId;
}

function openSessionForm(date){
 if(!adminGuard())return;
 const chosenDate=date||localDate(new Date());
 $('sessionDialogTitle').textContent='Ajouter un cours';
 $('sessionId').value='';
 $('sessionDate').value=chosenDate;
 $('modeSelect').value=isOfflineDate(chosenDate)?'offline':'online';
 $('plannedDays').value=1;
 $('notes').value='';
 $('completed').checked=false;
 $('sessionMessage').textContent='';
 const popupDayOff=state.dayOffs?.has(String(chosenDate));
 $('sessionDayOffAction').innerHTML=`<button type="button" class="${popupDayOff?'secondary':'danger'} dayoff-popup-btn" onclick="toggleDayOff('${chosenDate}'); $('sessionDialog').close();">${popupDayOff?'↩ Annuler le Day Off':'🏖 Mettre cette journée en Day Off et décaler les cours'}</button>`;
 fillAvailableCourseSelect();
 toggleNewCourseMode(false);
 $('newCourseName').value='';$('newCourseProfessor').value='';
 $('sessionDialog').showModal();
}
async function saveSession(e){
 e.preventDefault(); if(!adminGuard())return;
 const id=$('sessionId').value;
 let beforeSnapshot=null;
 try{beforeSnapshot=await getPlannerSnapshot();}catch(err){console.warn('Undo snapshot:',err.message)}
 let selectedCourseId=Number($('courseSelect').value||0);
 const newName=$('newCourseName').value.trim();
 if(!selectedCourseId && !newName){ $('sessionMessage').textContent='Choisis un cours ou crée un nouveau cours.'; return; }
 if(!id && newName){
   const createdId=await createNewCourseForDate($('sessionDate').value);
   if(!createdId){setSaveState('● Erreur',false);return;}
   selectedCourseId=createdId;
 }
 const payload={course_id:selectedCourseId,study_date:$('sessionDate').value,mode:$('modeSelect').value,notes:$('notes').value||null,planned_days:Number($('plannedDays').value||1),completed:$('completed').checked};
 setSaveState('● Enregistrement…',true);
 let result;
 if(id){
   const old=state.sessions.find(x=>String(x.id)===String(id));
   const daysChanged=old && Number(old.planned_days||1)!==Number(payload.planned_days||1);
   if(daysChanged){
     // Changing the duration of a course rebuilds the entire study plan from the start date.
     result=await sb.rpc('admin_resize_course_schedule',{
       p_token:state.adminToken,
       p_session_id:id,
       p_new_days:Math.max(1,Math.min(30,payload.planned_days)),
       p_duration_min:0,
       p_notes:payload.notes,
       p_completed:payload.completed
     });
   }else{
     result=await sb.rpc('admin_update_session',{p_token:state.adminToken,p_id:id,p_course_id:payload.course_id,p_study_date:payload.study_date,p_mode:payload.mode,p_duration_min:0,p_notes:payload.notes,p_planned_days:payload.planned_days,p_completed:payload.completed});
   }
 }
 else{
   const days=Math.max(1,Math.min(30,payload.planned_days));
   result=await sb.rpc('admin_create_session_series',{p_token:state.adminToken,p_course_id:payload.course_id,p_start_date:payload.study_date,p_mode:payload.mode,p_duration_min:0,p_notes:payload.notes,p_days:days,p_completed:payload.completed});
 }
 if(result.error){$('sessionMessage').textContent=result.error.message;setSaveState('● Erreur',false);return;}
 $('sessionDialog').close(); await load(); render(); setSaveState('● Synchronisé',true);
 if(beforeSnapshot) await recordPlannerAction(id?'Modifier la séance':'Ajouter une séance',beforeSnapshot);
}

function openSession(id){
 const s=state.sessions.find(x=>String(x.id)===String(id)); if(!s)return; const c=courseById(s.course_id); if(!c)return;
 $('detailContent').innerHTML=`<div class="eyebrow">SÉANCE</div><h3>${esc(c.title)}</h3><p class="muted">${esc(subjectName(c.subject_id))}${c.professor?' · '+esc(c.professor):''}</p>
 <div class="manage-row"><div>${s.mode==='offline'?'🏥':'💻'}</div><div><strong>${fmtLong(parseDate(s.study_date))}</strong><small>Temps chronométré : ${Math.max(0,Number(s.duration_min||0))} min · ${s.planned_days||1} jour(s) prévu(s) · ${s.completed?'Terminée':'À faire'}</small></div></div>
 ${c.drive_url?`<p><a class="drive-link" href="${esc(c.drive_url)}" target="_blank" rel="noopener">📂 Ouvrir le cours sur Google Drive</a></p>`:''}
 ${s.notes?`<p class="detail-notes">${esc(s.notes)}</p>`:''}`;
 const dayOffBtn=isAdmin()?`<button type="button" class="danger" onclick="toggleDayOff('${s.study_date}');$('detailDialog').close()">🏖 Mettre le ${fmtLong(parseDate(s.study_date))} en Day Off et décaler le planning</button>`:'';
 const sameDayNext=s.completed?`<button type="button" class="primary" onclick="startAnotherCourseToday('${s.id}')">＋ Commencer un autre cours aujourd’hui</button>`:'';
 const timerActive=state.timer?.session_id && String(state.timer.session_id)===String(s.id) && ['running','paused'].includes(state.timer.status);
 const timerOtherActive=state.timer?.session_id && !timerActive && ['running','paused'].includes(state.timer.status);
 const timerBtn=isAdmin()
   ? (timerActive
      ? `<button type="button" class="primary detail-timer-btn" onclick="openTimerEnd()">⏱ Chrono sur ce cours — ${state.timer.status==='running'?'en cours':'en pause'}</button>`
      : `<button type="button" class="primary detail-timer-btn" onclick="startTimerForSession('${s.id}')" ${timerOtherActive?'disabled title="Un autre chrono est déjà en cours"':''}>▶ Démarrer le chrono sur ce cours</button>`)
   : '';
 $('detailActions').innerHTML=isAdmin()?`${timerBtn}${dayOffBtn}${sameDayNext}<button type="button" class="primary" onclick="editCourseFromSession('${s.id}')">Modifier le cours</button><button type="button" class="secondary" onclick="editSession('${s.id}')">Modifier la séance</button><button type="button" class="danger" onclick="deleteSession('${s.id}')">Supprimer la séance</button><button type="button" class="secondary" data-close="detailDialog">Fermer</button>`:`<button type="button" class="secondary" data-close="detailDialog">Fermer</button>`;
 $('detailDialog').showModal();
}
function startAnotherCourseToday(id){
 if(!adminGuard())return;
 const s=state.sessions.find(x=>String(x.id)===String(id));
 if(!s)return;
 const currentCourseId=Number(s.course_id);
 $('detailDialog').close();
 openSessionForm(s.study_date);
 $('sessionDialogTitle').textContent='Commencer un autre cours aujourd’hui';
 fillCourseSelect();
 const firstOther=state.courses.find(c=>Number(c.id)!==currentCourseId);
 if(firstOther) $('courseSelect').value=String(firstOther.id);
 $('sessionDate').value=s.study_date;
 $('plannedDays').value=1;
 
 $('notes').value='';
 $('completed').checked=false;
 $('sessionMessage').textContent='Choisissez n’importe quel cours, quelle que soit la matière.';
}
function editCourseFromSession(id){ const s=state.sessions.find(x=>String(x.id)===String(id)); if(!s)return; const c=courseById(s.course_id); $('detailDialog').close(); openEdit(c); }
function editSession(id){const s=state.sessions.find(x=>String(x.id)===String(id));if(!s)return;$('detailDialog').close();openSessionForm(s.study_date);$('sessionDialogTitle').textContent='Modifier la séance';$('sessionId').value=s.id;fillCourseSelect(s.course_id);$('sessionDate').value=s.study_date;$('modeSelect').value=s.mode;$('plannedDays').value=s.planned_days||1;$('notes').value=s.notes||'';$('completed').checked=Boolean(s.completed);}
async function deleteSession(id){
 if(!adminGuard())return;
 if(!confirm('Supprimer cette séance ?'))return;
 let beforeSnapshot=null; try{beforeSnapshot=await getPlannerSnapshot();}catch(err){console.warn('Undo snapshot:',err.message)}
 const {error}=await sb.rpc('admin_delete_session',{p_token:state.adminToken,p_id:id});
 if(error){adminError(error);return}
 $('detailDialog').close(); await load(); render();
 if(beforeSnapshot) await recordPlannerAction('Supprimer une séance',beforeSnapshot);
}

function renderManageList(){
 const filter=$('manageSubjectFilter').value||'all';
 const list=state.courses
   .filter(c=>filter==='all'||String(c.subject_id)===String(filter))
   .slice()
   .sort((a,b)=>(Number(a.global_order||999999)-Number(b.global_order||999999))||(Number(a.id)-Number(b.id)));
 const header=`<div class="manage-global-note">Ordre global de planification : les boutons ↑ ↓ déplacent un cours devant ou derrière un autre professeur. Tu peux donc organiser librement : Saadi → Mimouni → Saadi → Tahiri → Saadi…</div>`;
 $('manageCoursesList').innerHTML=header+(list.length?list.map(c=>`<div class="manage-row global-course-row"><div class="manage-order">${c.global_order??'—'}</div><div class="course-main"><strong>${esc(c.title)}</strong><small>${esc(subjectName(c.subject_id))} · ${c.professor?esc(c.professor):'—'} ${c.drive_url?` · <a class="inline-drive" href="${esc(c.drive_url)}" target="_blank" rel="noopener noreferrer">🔗 Ouvrir Drive</a>`:''}</small></div><div class="manage-actions"><button class="secondary" title="Déplacer avant le cours précédent, même s'il appartient à un autre professeur" onclick="moveCourse(${c.id},-1)">↑</button><button class="secondary" title="Déplacer après le cours suivant, même s'il appartient à un autre professeur" onclick="moveCourse(${c.id},1)">↓</button><button class="secondary" onclick="editCourse(${c.id})">Modifier</button><button class="danger" onclick="deleteCourse(${c.id})">Supprimer</button></div></div>`).join(''):'<div class="calendar-empty">Aucun cours.</div>');
}
function openManage(){if(!adminGuard())return;$('manageSubjectFilter').innerHTML='<option value="all">Toutes les matières</option>'+state.subjects.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');renderManageList();$('manageDialog').showModal();}
async function moveCourse(id,dir){
 if(!adminGuard())return;
 let beforeSnapshot=null;
 try{beforeSnapshot=await getPlannerSnapshot();}catch(e){}
 const {error}=await sb.rpc('admin_move_course',{p_token:state.adminToken,p_course_id:id,p_direction:dir});
 if(error){adminError(error);return}
 const rebuild=await sb.rpc('admin_rebuild_schedule_by_global_order',{p_token:state.adminToken});
 if(rebuild.error){adminError(rebuild.error);return}
 await load();render();
 if($('manageDialog').open)renderManageList();
 if(beforeSnapshot) await recordPlannerAction('Réordonner les cours',beforeSnapshot);
}
function openEdit(c){
 if(!adminGuard())return;
 $('editCourseId').value=c?.id||'';$('editCourseTitle').textContent=c?'Modifier le cours':'Ajouter un cours';$('editSubject').innerHTML=state.subjects.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');$('editSubject').value=String(c?.subject_id||state.subjects[0]?.id||'');$('editCourseName').value=c?.title||'';$('editProfessor').value=c?.professor||'';$('editDriveUrl').value=c?.drive_url||'';$('editCourseDialog').showModal();
}
function editCourse(id){openEdit(courseById(id));}
async function saveCourse(e){
 e.preventDefault();if(!adminGuard())return;const id=$('editCourseId').value,name=$('editCourseName').value.trim(),subject_id=Number($('editSubject').value),professor=$('editProfessor').value.trim()||null,drive_url=$('editDriveUrl').value.trim()||null;if(!name)return;
 let result;if(id){result=await sb.rpc('admin_update_course',{p_token:state.adminToken,p_id:Number(id),p_subject_id:subject_id,p_title:name,p_professor:professor,p_drive_url:drive_url});}
 else{const max=Math.max(0,...state.courses.filter(c=>Number(c.subject_id)===subject_id).map(c=>Number(c.sort_order||0)));result=await sb.rpc('admin_create_course',{p_token:state.adminToken,p_subject_id:subject_id,p_title:name,p_professor:professor,p_drive_url:drive_url,p_sort_order:max+1});}
 if(result.error){adminError(result.error);return}$('editCourseDialog').close();await load();render();if($('manageDialog').open)renderManageList();
}
async function deleteCourse(id){if(!adminGuard())return;if(!confirm('Supprimer ce cours et toutes ses séances ?'))return;const {error}=await sb.rpc('admin_delete_course',{p_token:state.adminToken,p_id:Number(id)});if(error){adminError(error);return}await load();render();renderManageList();}

async function saveSubject(e){e.preventDefault();if(!adminGuard())return;const name=$('subjectName').value.trim();if(!name)return;const max=Math.max(0,...state.subjects.map(s=>Number(s.sort_order||0)));const {error}=await sb.rpc('admin_create_subject',{p_token:state.adminToken,p_name:name,p_sort_order:max+1});if(error){adminError(error);return}$('subjectDialog').close();$('subjectName').value='';await load();render();}
async function deleteSubject(id){if(!adminGuard())return;if(!confirm('Supprimer cette matière ?'))return;const {error}=await sb.rpc('admin_delete_subject',{p_token:state.adminToken,p_id:Number(id)});if(error){adminError(error);return}await load();render();if($('manageDialog').open)renderManageList();}

async function saveSettings(e){
 e.preventDefault();if(!adminGuard())return;const start_date=$('startDate').value||'2026-09-17',offline_day=0;const {error}=await sb.rpc('admin_save_settings',{p_token:state.adminToken,p_start_date:start_date,p_offline_day:offline_day});if(error){$('settingsMessage').textContent=error.message;return}state.settings.start_date=start_date;state.settings.offline_day=offline_day;state.month=new Date(parseDate(start_date).getFullYear(),parseDate(start_date).getMonth(),1);$('settingsDialog').close();render();}


async function seedInitialSchedule(){
  if(!adminGuard()) return;
  // Only seed automatically when there are no sessions yet.
  if(state.sessions.length>0) return;
  const {data,error}=await sb.rpc('admin_seed_initial_schedule',{p_token:state.adminToken});
  if(error){
    console.warn('Initial schedule not created:', error.message);
    return;
  }
  if(data?.created) {
    await load();
    render();
  }
}
async function doAdminLogin(username,password,messageEl){
 messageEl.textContent='';
 const {data,error}=await sb.rpc('admin_login',{p_username:username,p_password:password});
 if(error){messageEl.textContent=error.message;return false}
 if(!data?.ok){messageEl.textContent='Identifiants incorrects.';return false}
 state.adminToken=data.token; state.viewerMode=false; localStorage.setItem('studyPlannerAdminToken',data.token);
 showApp(); await load(); await seedInitialSchedule(); await ensureAllCoursesHaveSession(); await load(); render(); await refreshUndoState(); return true;
}
async function loginAdmin(e){
 e.preventDefault();
 const username=$('adminUsername').value.trim(),password=$('adminPassword').value;
 const ok=await doAdminLogin(username,password,$('adminMessage'));
 if(ok){$('adminDialog').close();$('adminPassword').value='';$('landingPassword').value='';}
}
function logoutAdmin(){state.adminToken='';state.viewerMode=false;state.canUndo=false;state.undoLabel='';localStorage.removeItem('studyPlannerAdminToken');showLanding();}
async function changePassword(e){e.preventDefault();if(!adminGuard())return;const p1=$('newAdminPassword').value,p2=$('newAdminPassword2').value;if(p1!==p2){$('passwordMessage').textContent='Les deux mots de passe ne correspondent pas.';return}const {error}=await sb.rpc('admin_change_password',{p_token:state.adminToken,p_new_password:p1});if(error){$('passwordMessage').textContent=error.message;return}$('passwordMessage').textContent='Mot de passe modifié.';setTimeout(()=>$('passwordDialog').close(),500);$('newAdminPassword').value='';$('newAdminPassword2').value='';}

function wireDialogs(){
 document.querySelectorAll('[data-close]').forEach(btn=>btn.addEventListener('click',()=>$(btn.dataset.close)?.close()));
 $('adminForm').addEventListener('submit',loginAdmin);
 $('landingLoginForm').addEventListener('submit',async(e)=>{e.preventDefault();await doAdminLogin($('landingUsername').value.trim(),$('landingPassword').value,$('landingMessage'));});
 $('viewerBtn').addEventListener('click',enterViewer);
 $('passwordForm').addEventListener('submit',changePassword);
 $('sessionForm').addEventListener('submit',saveSession);
 $('subjectForm').addEventListener('submit',saveSubject);
 $('editCourseForm').addEventListener('submit',saveCourse);
 $('settingsForm').addEventListener('submit',saveSettings);
 $('timerEndForm').addEventListener('submit',endTimer);
}




$('prevMonth').onclick=()=>navMonth(-1);$('nextMonth').onclick=()=>navMonth(1);$('monthViewBtn').onclick=()=>setCalendarView('month');$('weekViewBtn').onclick=()=>setCalendarView('week');$('undoBtn').onclick=undoLastPlannerAction;$('todayBtn').onclick=()=>{const d=new Date();state.month=new Date(d.getFullYear(),d.getMonth(),1);render()};$('themeToggle').onclick=cycleThemePreference;$('adminBtn').onclick=()=>$('adminDialog').showModal();$('logoutBtn').onclick=logoutAdmin;$('changePasswordBtn').onclick=()=>$('passwordDialog').showModal();$('quickAddBtn').onclick=()=>openSessionForm();$('addSubjectBtn').onclick=()=>{if(adminGuard())$('subjectDialog').showModal()};$('manageCoursesBtn').onclick=openManage;$('restoreOrderBtn').onclick=restoreOriginalOrder;$('settingsBtn').onclick=()=>{if(!adminGuard())return;$('startDate').value=state.settings.start_date||'2026-09-17';const el=$('offlineDay');if(el)el.value='0';$('settingsDialog').showModal()};$('manageSubjectFilter').onchange=renderManageList;$('addCourseBtn').onclick=()=>openEdit();

(async()=>{
  wireDialogs();
  applyThemePreference();
  ensureTimerTicker();
  if(window.matchMedia){
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{
      if(getThemePreference()==='auto') applyThemePreference();
    });
  }
  // Always start on the login landing page. Admin must explicitly sign in.
  state.viewerMode=false;
  showLanding();
})();

setInterval(()=>{
  if(document.body && !document.body.classList.contains('hidden')){
    renderRightSidebar();
  }
},60000);

setInterval(()=>{ if(!document.hidden) renderRightSidebar(); },60000);
