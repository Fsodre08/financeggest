/* FinanceGest v2 — app.js */

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

let currentUser = null;
let userRole    = null;
let userPerms   = {};
let currentMaqId = null;
let editingMaqId = null;
let finModalType = null;

let cache = { pagar:[], receber:[], maquinas:[], docs:[], horas:[], categorias:[], usuarios:[], permissoes:[], envios:[], config:{} };

// ─── UTILS ────────────────────────────────────────────────────
const fmt   = v => 'R$ ' + Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const today = () => new Date().toISOString().slice(0,10);
const in30  = () => { const d=new Date(); d.setDate(d.getDate()+30); return d.toISOString().slice(0,10); };
const isAdmin = () => userRole === 'admin';

function canDo(perm){ return isAdmin() || !!userPerms[perm]; }

function showMsg(id, msg, type='ok'){
  const el=document.getElementById(id);
  if(!el) return;
  el.className='alert alert-'+(type==='ok'?'ok':type==='err'?'err':'info');
  el.textContent=msg;
  el.style.display=msg?'block':'none';
  if(msg && type==='ok') setTimeout(()=>{ el.style.display='none'; },3000);
}

function dl(content,name,type){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); }

// ─── AUTH ─────────────────────────────────────────────────────
async function doLogin(){
  const email=document.getElementById('login-email').value.trim();
  const pass=document.getElementById('login-pass').value;
  const err=document.getElementById('auth-err');
  err.style.display='none';
  const btn=document.getElementById('login-btn');
  btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
  const {error}=await sb.auth.signInWithPassword({email,password:pass});
  btn.disabled=false; btn.innerHTML='Entrar';
  if(error){ err.textContent='E-mail ou senha incorretos.'; err.style.display='block'; }
}

async function doLogout(){
  await sb.auth.signOut();
  try { localStorage.clear(); sessionStorage.clear(); } catch(e){}
  window.location.replace(window.location.pathname);
}

// Carrega branding antes de mostrar login
(async()=>{
  try {
    const {data}=await sb.from('configuracoes').select('chave,valor');
    if(data){
      data.forEach(r=>{ cache.config[r.chave]=r.valor; });
      const nome=cache.config['empresa_nome']||'';
      const logo=cache.config['empresa_logo']||'';
      if(nome){ document.title=nome; const el=document.getElementById('auth-logo-name'); if(el) el.textContent=nome; }
      if(logo){ const el=document.getElementById('auth-logo-img'); if(el){ el.src=logo; el.style.display='block'; } }
    }
  } catch(e){}
})();

let _bootedOnce=false;
sb.auth.onAuthStateChange(async(event,session)=>{
  if(session?.user){
    if(_bootedOnce) return;
    _bootedOnce=true;
    currentUser=session.user;
    await loadUserRole(); await loadPerms(); bootApp();
  } else {
    _bootedOnce=false;
    document.getElementById('auth-screen').style.display='flex';
    document.getElementById('app-screen').style.display='none';
  }
});

async function loadUserRole(){
  const {data}=await sb.from('user_roles').select('role').eq('user_id',currentUser.id).single();
  userRole=data?.role||'operador';
}

async function loadPerms(){
  if(isAdmin()){ userPerms={ver_financeiro:true,editar_financeiro:true,ver_maquinas:true,editar_maquinas:true,registrar_horimetro:true,ver_relatorios:true}; return; }
  const {data}=await sb.from('permissoes').select('*').eq('user_id',currentUser.id).single();
  userPerms=data||{ver_financeiro:false,editar_financeiro:false,ver_maquinas:true,editar_maquinas:false,registrar_horimetro:true,ver_relatorios:false};
}

function bootApp(){
  document.getElementById('auth-screen').style.display='none';
  document.getElementById('app-screen').style.display='flex';

  // nav visibility
  const showFin=canDo('ver_financeiro');
  document.getElementById('nav-pagar').style.display=showFin?'':'none';
  document.getElementById('nav-receber').style.display=showFin?'':'none';
  document.getElementById('nav-fluxo').style.display=showFin?'':'none';
  document.getElementById('nav-maquinas').style.display=canDo('ver_maquinas')?'':'none';
  document.getElementById('nav-medicao').style.display=isAdmin()?'flex':'none';
  document.getElementById('nav-config').style.display=isAdmin()?'flex':'none';

  document.getElementById('dash-fin-metrics').style.display=showFin?'':'none';
  document.getElementById('dash-charts').style.display=showFin?'':'none';

  document.getElementById('user-email-display').textContent=currentUser.email;
  document.getElementById('user-role-display').innerHTML=`<span class="user-role ${isAdmin()?'role-admin':'role-operador'}">${isAdmin()?'Admin':'Operador'}</span>`;

  document.getElementById('mc-email').textContent=currentUser.email;
  document.getElementById('mc-role').textContent=isAdmin()?'Admin':'Operador';
  document.getElementById('mc-since').textContent=new Date(currentUser.created_at).toLocaleDateString('pt-BR');

  loadAll();
}

// ─── LOAD ALL ─────────────────────────────────────────────────
async function loadAll(){
  await loadConfig();

  const loads=[sb.from('maquinas').select('*').order('marca')];
  if(canDo('ver_financeiro')){
    loads.push(sb.from('contas_pagar').select('*').order('vencimento'));
    loads.push(sb.from('contas_receber').select('*').order('vencimento'));
  }
  loads.push(sb.from('categorias').select('*').eq('ativo',true).order('nome'));

  const results=await Promise.all(loads);
  let i=0;
  cache.maquinas=results[i++].data||[];
  if(canDo('ver_financeiro')){ cache.pagar=results[i++].data||[]; cache.receber=results[i++].data||[]; }
  cache.categorias=results[i++].data||[];

  populateCatSelect();

  const ids=cache.maquinas.map(m=>m.id);
  if(ids.length){
    const [dRes,hRes]=await Promise.all([
      sb.from('documentos').select('*').in('maquina_id',ids),
      sb.from('horimetro').select('*').in('maquina_id',ids).order('data',{ascending:false})
    ]);
    cache.docs=dRes.data||[];
    cache.horas=hRes.data||[];
  }

  if(isAdmin()){
    const [uRes,pRes,eRes]=await Promise.all([
      sb.from('usuarios_view').select('user_id, email, role'),
      sb.from('permissoes').select('*'),
      sb.from('envios_contador').select('*').order('created_at',{ascending:false}).limit(10)
    ]);
    cache.usuarios=uRes.data||[];
    cache.permissoes=pRes.data||[];
    cache.envios=eRes.data||[];
  }

  updateDashboard();
  renderMaquinas();
}

async function loadConfig(){
  const {data}=await sb.from('configuracoes').select('chave,valor');
  cache.config={};
  (data||[]).forEach(r=>{ cache.config[r.chave]=r.valor; });
  applyBranding();
}

function applyBranding(){
  const nome=cache.config['empresa_nome']||'MXP Máquinas e Equipamentos';
  const logo=cache.config['empresa_logo']||'';
  document.title=nome;

  // sidebar e login
  const sNome=document.getElementById('sidebar-empresa-nome');
  if(sNome) sNome.textContent=nome;
  const aNome=document.getElementById('auth-logo-name');
  if(aNome) aNome.textContent=nome;

  // logo em todos os lugares
  const sImg=document.getElementById('sidebar-logo-img');
  const aImg=document.getElementById('auth-logo-img');
  const prevImg=document.getElementById('logo-preview-img');
  const placeholder=document.getElementById('logo-placeholder');

  if(logo){
    if(sImg){ sImg.src=logo; sImg.style.display='block'; }
    if(aImg){ aImg.src=logo; aImg.style.display='block'; }
    if(prevImg){ prevImg.src=logo; prevImg.style.display='block'; }
    if(placeholder) placeholder.style.display='none';
  } else {
    if(sImg){ sImg.src=''; sImg.style.display='none'; }
    if(aImg){ aImg.src=''; aImg.style.display='none'; }
    if(prevImg){ prevImg.src=''; prevImg.style.display='none'; }
    if(placeholder) placeholder.style.display='';
  }

  // campos do formulário de config
  const nInput=document.getElementById('cfg-empresa-nome');
  if(nInput) nInput.value=nome;
  const cNome=document.getElementById('cfg-contador-nome');
  if(cNome){
    cNome.value=cache.config['contador_nome']||'';
    const cEmail=document.getElementById('cfg-contador-email');
    if(cEmail) cEmail.value=cache.config['contador_email']||'';
    const cObs=document.getElementById('cfg-contador-obs');
    if(cObs) cObs.value=cache.config['contador_obs']||'';
  }
}

// ─── NAV ──────────────────────────────────────────────────────
let chartFluxo, chartCat, chartFluxoDetail;

function showPage(id, el, skipActive){
  document.querySelectorAll('.page').forEach(p=>{ p.classList.remove('active'); p.style.display=''; });
  if(!skipActive){ document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active')); if(el) el.classList.add('active'); }
  const pg=document.getElementById('page-'+id);
  if(pg){ pg.classList.add('active'); pg.style.display='block'; }
  if(id==='dashboard') updateDashboard();
  if(id==='fluxo') renderFluxo();
  if(id==='pagar') renderPagar();
  if(id==='receber') renderReceber();
  if(id==='maquinas') renderMaquinas();
  if(id==='config') loadConfigPage();
  if(id==='medicao') initMedicao();
}

function switchTab(id, el){
  document.querySelectorAll('.stab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.stab-content').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-'+id).classList.add('active');
}

function closeModal(id){ document.getElementById('modal-'+id).classList.remove('open'); }

// ─── CATEGORIAS ───────────────────────────────────────────────
function populateCatSelect(){
  const sel=document.getElementById('ff-cat');
  if(!sel) return;
  const type=finModalType;
  const opts=cache.categorias.filter(c=>c.tipo==='ambos'||(type&&c.tipo===type));
  sel.innerHTML=opts.length?opts.map(c=>`<option>${c.nome}</option>`).join(''):'<option>Outros</option>';
}

// ─── FINANCIAL MODAL ──────────────────────────────────────────
function openModal(type){
  finModalType=type;
  document.getElementById('modal-fin-title').textContent=type==='pagar'?'Nova conta a pagar':'Nova conta a receber';
  document.getElementById('ff-part-label').textContent=type==='pagar'?'Fornecedor':'Cliente';
  document.getElementById('ff-venc').value=today();
  ['ff-desc','ff-part','ff-valor'].forEach(id=>document.getElementById(id).value='');
  populateCatSelect();
  document.getElementById('modal-fin').classList.add('open');
}

async function saveFinItem(){
  const desc=document.getElementById('ff-desc').value.trim();
  const valor=parseFloat(document.getElementById('ff-valor').value)||0;
  const venc=document.getElementById('ff-venc').value;
  const part=document.getElementById('ff-part').value.trim();
  const cat=document.getElementById('ff-cat').value;
  if(!desc||!valor||!venc){ alert('Preencha descrição, valor e vencimento.'); return; }
  const btn=document.getElementById('btn-save-fin'); btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
  const status=venc<today()?'vencido':'pendente';
  const table=finModalType==='pagar'?'contas_pagar':'contas_receber';
  const {data,error}=await sb.from(table).insert({descricao:desc,valor,vencimento:venc,contraparte:part,categoria:cat,status}).select().single();
  btn.disabled=false; btn.innerHTML='Salvar';
  if(error){ alert('Erro: '+error.message); return; }
  if(finModalType==='pagar') cache.pagar.push(data); else cache.receber.push(data);
  closeModal('fin');
  if(finModalType==='pagar') renderPagar(); else renderReceber();
  updateDashboard();
}

async function toggleStatus(type,id){
  const arr=type==='pagar'?cache.pagar:cache.receber;
  const item=arr.find(x=>x.id===id); if(!item) return;
  const ns=type==='pagar'?(item.status==='pago'?'pendente':'pago'):(item.status==='recebido'?'pendente':'recebido');
  await sb.from(type==='pagar'?'contas_pagar':'contas_receber').update({status:ns}).eq('id',id);
  item.status=ns;
  if(type==='pagar') renderPagar(); else renderReceber();
  updateDashboard();
}

async function deleteFinItem(type,id){
  if(!confirm('Excluir?')) return;
  await sb.from(type==='pagar'?'contas_pagar':'contas_receber').delete().eq('id',id);
  if(type==='pagar') cache.pagar=cache.pagar.filter(x=>x.id!==id); else cache.receber=cache.receber.filter(x=>x.id!==id);
  if(type==='pagar') renderPagar(); else renderReceber();
  updateDashboard();
}

function statusBadge(s){
  const m={pago:'badge-ok',recebido:'badge-ok',pendente:'badge-warn',vencido:'badge-err'};
  const l={pago:'Pago',recebido:'Recebido',pendente:'Pendente',vencido:'Vencido'};
  return `<span class="badge ${m[s]||'badge-warn'}">${l[s]||s}</span>`;
}

function renderPagar(){
  const q=document.getElementById('search-pagar').value.toLowerCase();
  const f=document.getElementById('filter-pagar').value;
  const rows=cache.pagar.filter(x=>(!q||(x.descricao+x.contraparte).toLowerCase().includes(q))&&(!f||x.status===f)).sort((a,b)=>a.vencimento.localeCompare(b.vencimento));
  const canEdit=canDo('editar_financeiro');
  const tb=document.getElementById('tbody-pagar');
  document.getElementById('btn-nova-pagar').style.display=canEdit?'':'none';
  if(!rows.length){ tb.innerHTML=`<tr><td colspan="6"><div class="empty">Nenhuma conta encontrada</div></td></tr>`; return; }
  tb.innerHTML=rows.map(x=>`<tr>
    <td style="padding:10px 1.25rem;"><strong style="font-weight:500;">${x.descricao}</strong><br><span class="tag">${x.categoria}</span></td>
    <td style="color:var(--txt2);">${x.contraparte||'—'}</td>
    <td style="color:var(--txt2);">${x.vencimento}</td>
    <td class="neg"><strong style="font-weight:500;">${fmt(x.valor)}</strong></td>
    <td>${statusBadge(x.status)}</td>
    <td style="padding-right:1.25rem;white-space:nowrap;">${canEdit?`
      <button class="btn btn-sm" onclick="toggleStatus('pagar','${x.id}')">${x.status==='pago'?'Reabrir':'Marcar pago'}</button>
      <button class="btn btn-danger btn-sm" style="margin-left:4px;" onclick="deleteFinItem('pagar','${x.id}')">✕</button>`:''}
    </td></tr>`).join('');
}

function renderReceber(){
  const q=document.getElementById('search-receber').value.toLowerCase();
  const f=document.getElementById('filter-receber').value;
  const rows=cache.receber.filter(x=>(!q||(x.descricao+x.contraparte).toLowerCase().includes(q))&&(!f||x.status===f)).sort((a,b)=>a.vencimento.localeCompare(b.vencimento));
  const canEdit=canDo('editar_financeiro');
  const tb=document.getElementById('tbody-receber');
  document.getElementById('btn-nova-receber').style.display=canEdit?'':'none';
  if(!rows.length){ tb.innerHTML=`<tr><td colspan="6"><div class="empty">Nenhuma conta encontrada</div></td></tr>`; return; }
  tb.innerHTML=rows.map(x=>`<tr>
    <td style="padding:10px 1.25rem;"><strong style="font-weight:500;">${x.descricao}</strong><br><span class="tag">${x.categoria}</span></td>
    <td style="color:var(--txt2);">${x.contraparte||'—'}</td>
    <td style="color:var(--txt2);">${x.vencimento}</td>
    <td class="pos"><strong style="font-weight:500;">${fmt(x.valor)}</strong></td>
    <td>${statusBadge(x.status)}</td>
    <td style="padding-right:1.25rem;white-space:nowrap;">${canEdit?`
      <button class="btn btn-sm" onclick="toggleStatus('receber','${x.id}')">${x.status==='recebido'?'Reabrir':'Marcar recebido'}</button>
      <button class="btn btn-danger btn-sm" style="margin-left:4px;" onclick="deleteFinItem('receber','${x.id}')">✕</button>`:''}
    </td></tr>`).join('');
}

// ─── DASHBOARD ────────────────────────────────────────────────
function getMonthLabel(o){ const d=new Date(); d.setMonth(d.getMonth()+o); return d.toLocaleString('pt-BR',{month:'short',year:'2-digit'}); }
function itemsInMonth(arr,o){ const d=new Date(); d.setMonth(d.getMonth()+o); const ym=d.toISOString().slice(0,7); return arr.filter(x=>(x.vencimento||'').slice(0,7)===ym); }

function updateDashboard(){
  if(canDo('ver_financeiro')){
    const t=today(),d30=in30();
    const p30=cache.pagar.filter(x=>x.status!=='pago'&&x.vencimento>=t&&x.vencimento<=d30);
    const r30=cache.receber.filter(x=>x.status!=='recebido'&&x.vencimento>=t&&x.vencimento<=d30);
    const saldo=cache.receber.filter(x=>x.status==='recebido').reduce((s,x)=>s+Number(x.valor),0)-cache.pagar.filter(x=>x.status==='pago').reduce((s,x)=>s+Number(x.valor),0);
    document.getElementById('m-saldo').textContent=fmt(saldo);
    document.getElementById('m-saldo').className='metric-value '+(saldo>=0?'pos':'neg');
    document.getElementById('m-receber').textContent=fmt(r30.reduce((s,x)=>s+Number(x.valor),0));
    document.getElementById('m-pagar').textContent=fmt(p30.reduce((s,x)=>s+Number(x.valor),0));
    document.getElementById('m-receber-qt').textContent=r30.length+' lançamento'+(r30.length!==1?'s':'');
    document.getElementById('m-pagar-qt').textContent=p30.length+' lançamento'+(p30.length!==1?'s':'');
    buildChartFluxo(); buildChartCat();
  }
  document.getElementById('m-maq').textContent=cache.maquinas.length;
  const docsWarn=cache.docs.filter(x=>x.vencimento&&x.vencimento>=today()&&x.vencimento<=in30()).length;
  document.getElementById('m-docs').textContent=docsWarn;
  document.getElementById('m-frota').textContent=fmt(cache.maquinas.reduce((s,m)=>s+calcValorAtual(m),0));

  const t=today(),d7=new Date(); d7.setDate(d7.getDate()+7); const d7s=d7.toISOString().slice(0,10);
  let prox=[];
  if(canDo('ver_financeiro')) prox=[...cache.pagar.filter(x=>x.status!=='pago'&&x.vencimento>=t&&x.vencimento<=d7s).map(x=>({...x,tipo:'pagar'})),...cache.receber.filter(x=>x.status!=='recebido'&&x.vencimento>=t&&x.vencimento<=d7s).map(x=>({...x,tipo:'receber'}))];
  prox=[...prox,...cache.docs.filter(x=>x.vencimento&&x.vencimento>=t&&x.vencimento<=d7s).map(x=>({...x,tipo:'documento',descricao:x.tipo+' — '+maqNome(x.maquina_id),valor:0}))];
  prox.sort((a,b)=>(a.vencimento||'').localeCompare(b.vencimento||''));
  const vList=document.getElementById('vencimentos-list');
  if(!prox.length){ vList.innerHTML='<div class="empty">Nenhum vencimento nos próximos 7 dias</div>'; return; }
  vList.innerHTML=`<table><thead><tr><th style="padding:8px 0 8px;">Descrição</th><th>Tipo</th><th>Vencimento</th><th>Valor</th></tr></thead><tbody>`+
    prox.map(x=>`<tr><td>${x.descricao}</td><td><span class="badge ${x.tipo==='receber'?'badge-ok':x.tipo==='documento'?'badge-warn':'badge-err'}">${x.tipo==='pagar'?'Pagar':x.tipo==='receber'?'Receber':'Documento'}</span></td><td style="color:var(--txt2);">${x.vencimento}</td><td class="${x.tipo==='receber'?'pos':x.tipo==='pagar'?'neg':''}">${x.valor?fmt(x.valor):'—'}</td></tr>`).join('')+`</tbody></table>`;
}

function maqNome(id){ const m=cache.maquinas.find(x=>x.id===id); return m?`${m.marca} ${m.modelo}`:''; }

function buildChartFluxo(){
  const labels=[-5,-4,-3,-2,-1,0].map(getMonthLabel);
  const entradas=[-5,-4,-3,-2,-1,0].map(i=>itemsInMonth(cache.receber,i).reduce((s,x)=>s+Number(x.valor),0));
  const saidas=[-5,-4,-3,-2,-1,0].map(i=>itemsInMonth(cache.pagar,i).reduce((s,x)=>s+Number(x.valor),0));
  if(chartFluxo) chartFluxo.destroy();
  chartFluxo=new Chart(document.getElementById('chartFluxo'),{type:'bar',data:{labels,datasets:[{label:'Entradas',data:entradas,backgroundColor:'#1D9E75',borderRadius:4},{label:'Saídas',data:saidas,backgroundColor:'#D85A30',borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false}},y:{grid:{color:'rgba(128,128,128,0.1)'},ticks:{callback:v=>'R$'+Number(v).toLocaleString('pt-BR')}}}}});
}

function buildChartCat(){
  const catMap={};
  [...cache.pagar,...cache.receber].forEach(x=>{catMap[x.categoria]=(catMap[x.categoria]||0)+Number(x.valor);});
  const cats=Object.keys(catMap),vals=cats.map(c=>catMap[c]);
  const colors=['#1D9E75','#378ADD','#D85A30','#BA7517','#D4537E','#7F77DD','#888780'];
  if(chartCat) chartCat.destroy();
  if(!cats.length){ chartCat=new Chart(document.getElementById('chartCat'),{type:'doughnut',data:{labels:['Sem dados'],datasets:[{data:[1],backgroundColor:['#ccc']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}}}); return; }
  chartCat=new Chart(document.getElementById('chartCat'),{type:'doughnut',data:{labels:cats,datasets:[{data:vals,backgroundColor:colors.slice(0,cats.length),borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'65%',plugins:{legend:{position:'right',labels:{font:{size:11},boxWidth:10,padding:8}}}}});
}

// ─── FLUXO ────────────────────────────────────────────────────
function renderFluxo(){
  const e=cache.receber.reduce((s,x)=>s+Number(x.valor),0),s=cache.pagar.reduce((s,x)=>s+Number(x.valor),0),r=e-s;
  document.getElementById('fc-entrada').textContent=fmt(e);
  document.getElementById('fc-saida').textContent=fmt(s);
  document.getElementById('fc-resultado').textContent=fmt(r);
  document.getElementById('fc-resultado').className='metric-value '+(r>=0?'pos':'neg');
  const labels=[-5,-4,-3,-2,-1,0,1,2].map(getMonthLabel);
  const entradas=[-5,-4,-3,-2,-1,0,1,2].map(i=>itemsInMonth(cache.receber,i).reduce((s,x)=>s+Number(x.valor),0));
  const saidas=[-5,-4,-3,-2,-1,0,1,2].map(i=>itemsInMonth(cache.pagar,i).reduce((s,x)=>s+Number(x.valor),0));
  if(chartFluxoDetail) chartFluxoDetail.destroy();
  chartFluxoDetail=new Chart(document.getElementById('chartFluxoDetail'),{type:'line',data:{labels,datasets:[{label:'Entradas',data:entradas,borderColor:'#1D9E75',backgroundColor:'rgba(29,158,117,0.1)',fill:true,tension:0.4,pointRadius:4},{label:'Saídas',data:saidas,borderColor:'#D85A30',backgroundColor:'rgba(216,90,48,0.08)',fill:true,tension:0.4,pointRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:12},boxWidth:12}}},scales:{x:{grid:{display:false}},y:{grid:{color:'rgba(128,128,128,0.1)'},ticks:{callback:v=>'R$'+Number(v).toLocaleString('pt-BR')}}}}});
  const all=[...cache.receber.map(x=>({...x,tipo:'entrada'})),...cache.pagar.map(x=>({...x,tipo:'saida'}))].sort((a,b)=>(b.vencimento||'').localeCompare(a.vencimento||''));
  const tb=document.getElementById('tbody-extrato');
  if(!all.length){ tb.innerHTML=`<tr><td colspan="4"><div class="empty">Sem lançamentos</div></td></tr>`; return; }
  tb.innerHTML=all.slice(0,30).map(x=>`<tr><td style="color:var(--txt2);">${x.vencimento}</td><td>${x.descricao}</td><td><span class="badge ${x.tipo==='entrada'?'badge-ok':'badge-err'}">${x.tipo==='entrada'?'Entrada':'Saída'}</span></td><td class="${x.tipo==='entrada'?'pos':'neg'}">${x.tipo==='entrada'?'+':'-'}${fmt(x.valor)}</td></tr>`).join('');
}

function exportCSV(){
  const rows=[['Tipo','Descrição','Contraparte','Categoria','Vencimento','Valor','Status']];
  cache.pagar.forEach(x=>rows.push(['Pagar',x.descricao,x.contraparte||'',x.categoria,x.vencimento,x.valor,x.status]));
  cache.receber.forEach(x=>rows.push(['Receber',x.descricao,x.contraparte||'',x.categoria,x.vencimento,x.valor,x.status]));
  dl('\uFEFF'+rows.map(r=>r.map(c=>`"${c}"`).join(';')).join('\n'),'financeiro_'+today()+'.csv','text/csv');
}

function exportTxt(){
  const e=cache.receber.reduce((s,x)=>s+Number(x.valor),0),s=cache.pagar.reduce((s,x)=>s+Number(x.valor),0);
  const empresa=cache.config['empresa_nome']||'';
  const txt=`RELATÓRIO FINANCEIRO${empresa?' — '+empresa:''}\n${new Date().toLocaleDateString('pt-BR')}\n${'='.repeat(52)}\n\nCONTAS A RECEBER\n${'-'.repeat(40)}\n`+
    cache.receber.map(x=>`${x.vencimento}  ${(x.descricao||'').padEnd(28)} R$ ${Number(x.valor).toFixed(2).padStart(12)}  [${x.status}]`).join('\n')+
    `\n\nCONTAS A PAGAR\n${'-'.repeat(40)}\n`+
    cache.pagar.map(x=>`${x.vencimento}  ${(x.descricao||'').padEnd(28)} R$ ${Number(x.valor).toFixed(2).padStart(12)}  [${x.status}]`).join('\n')+
    `\n\n${'='.repeat(52)}\nTotal entradas: R$ ${e.toFixed(2)}\nTotal saídas:   R$ ${s.toFixed(2)}\nResultado:      R$ ${(e-s).toFixed(2)}\n`;
  dl(txt,'relatorio_'+today()+'.txt','text/plain');
}

// ─── DEPRECIAÇÃO ──────────────────────────────────────────────
function calcValorAtual(m){
  if(!m.valor_compra||!m.data_aquisicao) return 0;
  const anos=(Date.now()-new Date(m.data_aquisicao).getTime())/(1000*60*60*24*365.25);
  const dep=Math.min(anos/(m.vida_util||10),1)*(Number(m.valor_compra)-(m.valor_residual||0));
  return Math.max(Number(m.valor_compra)-dep,m.valor_residual||0);
}
function calcDepPct(m){
  if(!m.valor_compra||!m.data_aquisicao) return 0;
  const anos=(Date.now()-new Date(m.data_aquisicao).getTime())/(1000*60*60*24*365.25);
  return Math.min(anos/(m.vida_util||10)*100,100);
}

// ─── MÁQUINAS ─────────────────────────────────────────────────
function latestHoras(id){ const r=cache.horas.filter(h=>h.maquina_id===id).sort((a,b)=>b.data.localeCompare(a.data)); return r.length?r[0].leitura:null; }

function renderMaquinas(){
  const q=(document.getElementById('search-maq')||{}).value?.toLowerCase()||'';
  const rows=cache.maquinas.filter(m=>!q||(m.marca+m.modelo+(m.placa||'')).toLowerCase().includes(q));
  const grid=document.getElementById('maquinas-grid');
  const canEdit=canDo('editar_maquinas');
  document.getElementById('btn-nova-maq').style.display=canEdit?'':'none';
  if(!rows.length){ grid.innerHTML='<div class="empty">Nenhuma máquina cadastrada</div>'; return; }
  grid.innerHTML=rows.map(m=>{
    const h=latestHoras(m.id)||m.horimetro_inicial||0,dep=calcDepPct(m);
    const dv=cache.docs.filter(d=>d.maquina_id===m.id&&d.vencimento&&d.vencimento<today()).length;
    return `<div class="machine-card" onclick="openMaqDetalhe('${m.id}')">
      <div class="machine-header"><div><div class="machine-name">${m.marca} ${m.modelo}</div><div class="machine-sub">${m.tipo||''} · ${m.ano||''} · ${m.placa||''}</div></div>
      ${dv?`<span class="badge badge-err">${dv} doc${dv>1?'s':''} vencido${dv>1?'s':''}</span>`:'<span class="badge badge-ok">OK</span>'}</div>
      <div class="machine-stats">
        <div class="machine-stat"><div class="machine-stat-label">Horímetro</div><div class="machine-stat-val">${Number(h).toLocaleString('pt-BR')} h</div></div>
        <div class="machine-stat"><div class="machine-stat-label">Valor atual</div><div class="machine-stat-val">${m.valor_compra?fmt(calcValorAtual(m)):'—'}</div></div>
      </div>
      ${m.valor_compra?`<div style="margin-top:10px;"><div style="font-size:11px;color:var(--txt2);margin-bottom:4px;">Depreciação: ${dep.toFixed(0)}%</div><div class="progress-bar"><div class="progress-fill" style="width:${dep.toFixed(0)}%;background:${dep>80?'#D85A30':dep>50?'#BA7517':'#1D9E75'};"></div></div></div>`:''}
    </div>`;
  }).join('');
}

function openMaqDetalhe(id){
  currentMaqId=id;
  const m=cache.maquinas.find(x=>x.id===id); if(!m) return;
  document.getElementById('maq-detalhe-title').textContent=`${m.marca} ${m.modelo}`;
  const canEdit=canDo('editar_maquinas');
  document.getElementById('maq-detalhe-actions').innerHTML=canEdit?`<button class="btn" onclick="openMaqModal('${id}')">✎ Editar</button><button class="btn btn-danger" onclick="deleteMaquina('${id}')">Excluir</button>`:'';
  document.getElementById('btn-add-doc').style.display=canEdit?'':'none';
  const h=latestHoras(id)||m.horimetro_inicial||0;
  document.getElementById('maq-info-geral').innerHTML=`<table><tbody>
    <tr><td style="color:var(--txt2);padding:7px 0;width:140px;">Tipo</td><td style="padding:7px 0;">${m.tipo||'—'}</td></tr>
    <tr><td style="color:var(--txt2);padding:7px 0;">Placa / Série</td><td style="padding:7px 0;">${m.placa||'—'}</td></tr>
    <tr><td style="color:var(--txt2);padding:7px 0;">Ano</td><td style="padding:7px 0;">${m.ano||'—'}</td></tr>
    <tr><td style="color:var(--txt2);padding:7px 0;">Horímetro atual</td><td style="padding:7px 0;font-weight:500;">${Number(h).toLocaleString('pt-BR')} h</td></tr>
    <tr><td style="color:var(--txt2);padding:7px 0;">Data aquisição</td><td style="padding:7px 0;">${m.data_aquisicao||'—'}</td></tr>
    ${m.obs?`<tr><td style="color:var(--txt2);padding:7px 0;">Obs.</td><td style="padding:7px 0;color:var(--txt2);">${m.obs}</td></tr>`:''}
  </tbody></table>`;
  if(m.valor_compra){
    const dep=calcDepPct(m),va=calcValorAtual(m),anos=(Date.now()-new Date(m.data_aquisicao).getTime())/(1000*60*60*24*365.25);
    document.getElementById('maq-depreciacao').innerHTML=`<table><tbody>
      <tr><td style="color:var(--txt2);padding:7px 0;width:140px;">Valor de compra</td><td style="padding:7px 0;">${fmt(m.valor_compra)}</td></tr>
      <tr><td style="color:var(--txt2);padding:7px 0;">Valor atual</td><td style="padding:7px 0;font-weight:500;" class="pos">${fmt(va)}</td></tr>
      <tr><td style="color:var(--txt2);padding:7px 0;">Depreciado</td><td style="padding:7px 0;" class="neg">${fmt(Number(m.valor_compra)-va)}</td></tr>
      <tr><td style="color:var(--txt2);padding:7px 0;">Vida útil</td><td style="padding:7px 0;">${m.vida_util||10} anos</td></tr>
    </tbody></table>
    <div style="margin-top:12px;"><div style="display:flex;justify-content:space-between;font-size:12px;color:var(--txt2);margin-bottom:4px;"><span>Depreciação</span><span>${dep.toFixed(1)}%</span></div>
    <div class="progress-bar" style="height:8px;"><div class="progress-fill" style="width:${dep.toFixed(0)}%;background:${dep>80?'#D85A30':dep>50?'#BA7517':'#1D9E75'};"></div></div>
    <div style="font-size:11px;color:var(--txt2);margin-top:4px;">${anos.toFixed(1)} anos em uso</div></div>`;
  } else { document.getElementById('maq-depreciacao').innerHTML='<div style="color:var(--txt2);font-size:13px;">Sem dados de valor de compra.</div>'; }
  renderDocsList(id); renderHorasList(id);
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-maq-detalhe').classList.add('active');
}

function renderDocsList(id){
  const docs=cache.docs.filter(d=>d.maquina_id===id).sort((a,b)=>(a.vencimento||'').localeCompare(b.vencimento||''));
  const canEdit=canDo('editar_maquinas');
  const el=document.getElementById('maq-docs-list');
  if(!docs.length){ el.innerHTML='<div style="color:var(--txt2);font-size:13px;padding:8px 0;">Nenhum documento cadastrado.</div>'; return; }
  el.innerHTML=docs.map(d=>{
    const exp=d.vencimento&&d.vencimento<today(),warn=d.vencimento&&!exp&&d.vencimento<in30();
    return `<div class="doc-row">
      <div><strong style="font-weight:500;">${d.tipo}</strong>${d.numero?` <span class="tag">${d.numero}</span>`:''}</div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:12px;color:var(--txt2);">${d.vencimento||'—'}</span>
        <span class="badge ${exp?'badge-err':warn?'badge-warn':'badge-ok'}">${exp?'Vencido':warn?'Vence em breve':'Válido'}</span>
        ${canEdit?`<button class="btn btn-danger btn-sm" onclick="deleteDoc('${d.id}')">✕</button>`:''}
      </div></div>`;
  }).join('');
}

function renderHorasList(id){
  const horas=cache.horas.filter(h=>h.maquina_id===id).sort((a,b)=>b.data.localeCompare(a.data)).slice(0,10);
  const el=document.getElementById('maq-horas-list');
  if(!horas.length){ el.innerHTML='<div style="color:var(--txt2);font-size:13px;padding:8px 0;">Nenhum registro.</div>'; return; }
  el.innerHTML=`<table><thead><tr><th>Data</th><th>Leitura (h)</th><th>Observação</th><th></th></tr></thead><tbody>`+
    horas.map(h=>`<tr><td style="color:var(--txt2);">${h.data}</td><td><strong style="font-weight:500;">${Number(h.leitura).toLocaleString('pt-BR')}</strong></td><td style="color:var(--txt2);">${h.obs||'—'}</td><td><button class="btn btn-danger btn-sm" onclick="deleteHora('${h.id}')">✕</button></td></tr>`).join('')+`</tbody></table>`;
}

function openMaqModal(id){
  editingMaqId=id||null;
  const m=id?cache.maquinas.find(x=>x.id===id):null;
  document.getElementById('modal-maq-title').textContent=m?'Editar máquina':'Nova máquina';
  document.getElementById('fm-marca').value=m?.marca||'';
  document.getElementById('fm-modelo').value=m?.modelo||'';
  document.getElementById('fm-ano').value=m?.ano||'';
  document.getElementById('fm-placa').value=m?.placa||'';
  document.getElementById('fm-tipo').value=m?.tipo||'Caminhão';
  document.getElementById('fm-horas').value=m?.horimetro_inicial||0;
  document.getElementById('fm-valor-compra').value=m?.valor_compra||'';
  document.getElementById('fm-data-aq').value=m?.data_aquisicao||'';
  document.getElementById('fm-vida-util').value=m?.vida_util||10;
  document.getElementById('fm-valor-residual').value=m?.valor_residual||0;
  document.getElementById('fm-obs').value=m?.obs||'';
  document.getElementById('modal-maq').classList.add('open');
}

async function saveMaquina(){
  const marca=document.getElementById('fm-marca').value.trim(),modelo=document.getElementById('fm-modelo').value.trim();
  if(!marca||!modelo){ alert('Preencha marca e modelo.'); return; }
  const btn=document.getElementById('btn-save-maq'); btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
  const payload={marca,modelo,ano:parseInt(document.getElementById('fm-ano').value)||null,placa:document.getElementById('fm-placa').value.trim(),tipo:document.getElementById('fm-tipo').value,horimetro_inicial:parseFloat(document.getElementById('fm-horas').value)||0,valor_compra:parseFloat(document.getElementById('fm-valor-compra').value)||null,data_aquisicao:document.getElementById('fm-data-aq').value||null,vida_util:parseInt(document.getElementById('fm-vida-util').value)||10,valor_residual:parseFloat(document.getElementById('fm-valor-residual').value)||0,obs:document.getElementById('fm-obs').value.trim()};
  let data,error;
  if(editingMaqId){ ({data,error}=await sb.from('maquinas').update(payload).eq('id',editingMaqId).select().single()); if(!error){ const i=cache.maquinas.findIndex(x=>x.id===editingMaqId); if(i>=0) cache.maquinas[i]=data; } }
  else { ({data,error}=await sb.from('maquinas').insert(payload).select().single()); if(!error) cache.maquinas.push(data); }
  btn.disabled=false; btn.innerHTML='Salvar';
  if(error){ alert('Erro: '+error.message); return; }
  closeModal('maq'); renderMaquinas(); updateDashboard();
}

async function deleteMaquina(id){
  if(!confirm('Excluir esta máquina?')) return;
  await sb.from('documentos').delete().eq('maquina_id',id);
  await sb.from('horimetro').delete().eq('maquina_id',id);
  await sb.from('maquinas').delete().eq('id',id);
  cache.maquinas=cache.maquinas.filter(x=>x.id!==id);
  cache.docs=cache.docs.filter(x=>x.maquina_id!==id);
  cache.horas=cache.horas.filter(x=>x.maquina_id!==id);
  showPage('maquinas',null,true);
  renderMaquinas(); updateDashboard();
}

function openDocModal(){ ['fd-numero','fd-obs'].forEach(i=>document.getElementById(i).value=''); document.getElementById('fd-emissao').value=today(); document.getElementById('fd-venc').value=''; document.getElementById('modal-doc').classList.add('open'); }

async function saveDoc(){
  const venc=document.getElementById('fd-venc').value; if(!venc){ alert('Informe o vencimento.'); return; }
  const btn=document.getElementById('btn-save-doc'); btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
  const {data,error}=await sb.from('documentos').insert({maquina_id:currentMaqId,tipo:document.getElementById('fd-tipo').value,numero:document.getElementById('fd-numero').value.trim(),emissao:document.getElementById('fd-emissao').value||null,vencimento:venc,obs:document.getElementById('fd-obs').value.trim()}).select().single();
  btn.disabled=false; btn.innerHTML='Salvar';
  if(error){ alert('Erro: '+error.message); return; }
  cache.docs.push(data); closeModal('doc'); renderDocsList(currentMaqId); updateDashboard();
}

async function deleteDoc(id){ if(!confirm('Excluir documento?')) return; await sb.from('documentos').delete().eq('id',id); cache.docs=cache.docs.filter(x=>x.id!==id); renderDocsList(currentMaqId); updateDashboard(); }

function openHoraModal(){ document.getElementById('fh-data').value=today(); document.getElementById('fh-horas').value=latestHoras(currentMaqId)||''; document.getElementById('fh-obs').value=''; document.getElementById('modal-hora').classList.add('open'); }

async function saveHora(){
  const data=document.getElementById('fh-data').value,leitura=parseFloat(document.getElementById('fh-horas').value)||0;
  if(!data||!leitura){ alert('Preencha data e leitura.'); return; }
  const btn=document.getElementById('btn-save-hora'); btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
  const {data:row,error}=await sb.from('horimetro').insert({maquina_id:currentMaqId,data,leitura,obs:document.getElementById('fh-obs').value.trim(),registrado_por:currentUser.id}).select().single();
  btn.disabled=false; btn.innerHTML='Salvar';
  if(error){ alert('Erro: '+error.message); return; }
  cache.horas.unshift(row); closeModal('hora'); renderHorasList(currentMaqId); updateDashboard();
}

async function deleteHora(id){ if(!confirm('Excluir registro?')) return; await sb.from('horimetro').delete().eq('id',id); cache.horas=cache.horas.filter(x=>x.id!==id); renderHorasList(currentMaqId); }

// ─── CONFIGURAÇÕES ────────────────────────────────────────────
function loadConfigPage(){
  applyBranding();
  renderUsuarios();
  renderPermissoes();
  renderCategorias();
  renderEnvioHistorico();
}

// EMPRESA
function handleLogoUpload(e){
  const file=e.target.files[0]; if(!file) return;
  if(file.size>200000){ alert('Arquivo muito grande. Máximo 200KB.'); return; }
  const reader=new FileReader();
  reader.onload=ev=>{
    const base64=ev.target.result;
    document.getElementById('logo-preview-img').src=base64;
    document.getElementById('logo-preview-img').style.display='';
    document.getElementById('logo-placeholder').style.display='none';
    cache.config['empresa_logo']=base64;
  };
  reader.readAsDataURL(file);
}

function removeLogo(){
  cache.config['empresa_logo']='';
  document.getElementById('logo-preview-img').src='';
  document.getElementById('logo-preview-img').style.display='none';
  document.getElementById('logo-placeholder').style.display='';
}

async function saveEmpresa(){
  const nome=document.getElementById('cfg-empresa-nome').value.trim()||'FinanceGest';
  const logo=cache.config['empresa_logo']||'';
  await Promise.all([
    sb.from('configuracoes').upsert({chave:'empresa_nome',valor:nome},{onConflict:'chave'}),
    sb.from('configuracoes').upsert({chave:'empresa_logo',valor:logo},{onConflict:'chave'})
  ]);
  cache.config['empresa_nome']=nome;
  cache.config['empresa_logo']=logo;
  applyBranding();
  const msg=document.getElementById('empresa-saved-msg');
  msg.textContent='Salvo com sucesso!'; msg.style.display='block';
  setTimeout(()=>msg.style.display='none',3000);
}

// USUÁRIOS
function renderUsuarios(){
  const el=document.getElementById('usuarios-list');
  if(!cache.usuarios.length){ el.innerHTML='<div class="empty">Nenhum usuário encontrado</div>'; return; }
  el.innerHTML=cache.usuarios.map(u=>{
    const initials=(u.email||'?').slice(0,2).toUpperCase();
    const isMe=u.user_id===currentUser.id;
    return `<div class="user-row">
      <div class="user-avatar">${initials}</div>
      <div class="user-details">
        <div class="user-name-text">${u.email||u.user_id.slice(0,8)+'...'}</div>
        <div class="user-email-text"><span class="user-role ${u.role==='admin'?'role-admin':'role-operador'}">${u.role==='admin'?'Admin':'Operador'}</span>${isMe?' · Você':''}</div>
      </div>
      ${!isMe?`<select onchange="changeRole('${u.user_id}',this.value)" style="font-size:12px;padding:5px 8px;">
        <option value="operador" ${u.role==='operador'?'selected':''}>Operador</option>
        <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
      </select>
      <button class="btn btn-danger btn-sm" onclick="removeUser('${u.user_id}')">Remover</button>`:''}
    </div>`;
  }).join('');
}

function openUserModal(){
  ['fu-email','fu-senha'].forEach(i=>document.getElementById(i).value='');
  document.getElementById('fu-role').value='operador';
  document.getElementById('user-modal-msg').style.display='none';
  document.getElementById('modal-user').classList.add('open');
}

async function criarUsuario(){
  const email=document.getElementById('fu-email').value.trim();
  const senha=document.getElementById('fu-senha').value;
  const role=document.getElementById('fu-role').value;
  if(!email||!senha){ alert('Preencha e-mail e senha.'); return; }
  if(senha.length<6){ alert('Senha mínima: 6 caracteres.'); return; }
  const btn=document.getElementById('btn-save-user'); btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
  const {data,error}=await sb.auth.admin?.createUser({email,password:senha,email_confirm:true}) || {error:{message:'Use o painel do Supabase para criar usuários (Authentication → Add user)'}};
  btn.disabled=false; btn.innerHTML='Criar usuário';
  if(error){
    showMsg('user-modal-msg','Para criar usuários, acesse Authentication → Users no Supabase e clique em "Add user". Depois volte aqui e adicione o role via SQL: insert into user_roles (user_id, role) values (\'UUID\', \''+role+'\');','info');
    return;
  }
  if(data?.user){
    await sb.from('user_roles').insert({user_id:data.user.id,role});
    await sb.from('permissoes').insert({user_id:data.user.id});
    cache.usuarios.push({user_id:data.user.id,role,email});
    closeModal('user'); renderUsuarios();
  }
}

async function changeRole(userId,role){
  await sb.from('user_roles').update({role}).eq('user_id',userId);
  const u=cache.usuarios.find(x=>x.user_id===userId);
  if(u) u.role=role;
  renderPermissoes();
}

async function removeUser(userId){
  if(!confirm('Remover acesso deste usuário?')) return;
  await sb.from('user_roles').delete().eq('user_id',userId);
  await sb.from('permissoes').delete().eq('user_id',userId);
  cache.usuarios=cache.usuarios.filter(x=>x.user_id!==userId);
  renderUsuarios(); renderPermissoes();
}

// PERMISSÕES
const permLabels={ver_financeiro:'Ver financeiro',editar_financeiro:'Editar financeiro',ver_maquinas:'Ver máquinas',editar_maquinas:'Editar máquinas',registrar_horimetro:'Registrar horímetro',ver_relatorios:'Ver relatórios'};

function renderPermissoes(){
  const el=document.getElementById('permissoes-list');
  const operadores=cache.usuarios.filter(u=>u.role==='operador');
  if(!operadores.length){ el.innerHTML='<div style="color:var(--txt2);font-size:13px;">Nenhum operador cadastrado.</div>'; return; }
  el.innerHTML=operadores.map(u=>{
    const perms=cache.permissoes.find(p=>p.user_id===u.user_id)||{};
    return `<div style="margin-bottom:1.5rem;">
      <div style="font-weight:500;font-size:13px;margin-bottom:8px;">${u.email||u.user_id.slice(0,12)}</div>
      <div class="perm-grid">${Object.keys(permLabels).map(k=>`
        <label class="perm-item">
          <input type="checkbox" ${perms[k]?'checked':''} onchange="updatePerm('${u.user_id}','${k}',this.checked)">
          ${permLabels[k]}
        </label>`).join('')}
      </div>
    </div>`;
  }).join('<div class="sep"></div>');
}

async function updatePerm(userId,perm,val){
  const existing=cache.permissoes.find(p=>p.user_id===userId);
  if(existing){ existing[perm]=val; await sb.from('permissoes').update({[perm]:val}).eq('user_id',userId); }
  else { const newP={user_id:userId,[perm]:val}; cache.permissoes.push(newP); await sb.from('permissoes').insert(newP); }
}

// CATEGORIAS
function renderCategorias(){
  const el=document.getElementById('categorias-list');
  if(!cache.categorias.length){ el.innerHTML='<div class="empty">Nenhuma categoria</div>'; return; }
  const tipoLabel={pagar:'Pagar',receber:'Receber',ambos:'Ambos'};
  el.innerHTML=cache.categorias.map(c=>`
    <div class="cat-row">
      <div style="flex:1;font-weight:500;">${c.nome}</div>
      <span class="tag" style="margin-right:8px;">${tipoLabel[c.tipo]||c.tipo}</span>
      <button class="btn btn-danger btn-sm" onclick="deleteCat('${c.id}')">✕</button>
    </div>`).join('');
}

function openCatModal(){ document.getElementById('fc-nome').value=''; document.getElementById('fc-tipo').value='ambos'; document.getElementById('modal-cat').classList.add('open'); }

async function saveCat(){
  const nome=document.getElementById('fc-nome').value.trim();
  if(!nome){ alert('Informe o nome.'); return; }
  const btn=document.getElementById('btn-save-cat'); btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
  const {data,error}=await sb.from('categorias').insert({nome,tipo:document.getElementById('fc-tipo').value}).select().single();
  btn.disabled=false; btn.innerHTML='Salvar';
  if(error){ alert('Já existe uma categoria com esse nome.'); return; }
  cache.categorias.push(data); closeModal('cat'); renderCategorias(); populateCatSelect();
}

async function deleteCat(id){
  if(!confirm('Excluir categoria?')) return;
  await sb.from('categorias').delete().eq('id',id);
  cache.categorias=cache.categorias.filter(x=>x.id!==id);
  renderCategorias(); populateCatSelect();
}

// CONTADOR
async function saveContador(){
  const nome=document.getElementById('cfg-contador-nome').value.trim();
  const email=document.getElementById('cfg-contador-email').value.trim();
  const obs=document.getElementById('cfg-contador-obs').value.trim();
  await Promise.all([
    sb.from('configuracoes').upsert({chave:'contador_nome',valor:nome},{onConflict:'chave'}),
    sb.from('configuracoes').upsert({chave:'contador_email',valor:email},{onConflict:'chave'}),
    sb.from('configuracoes').upsert({chave:'contador_obs',valor:obs},{onConflict:'chave'})
  ]);
  Object.assign(cache.config,{contador_nome:nome,contador_email:email,contador_obs:obs});
  alert('Dados do contador salvos!');
}

function previewRelatorio(){
  const inicio=document.getElementById('env-inicio').value;
  const fim=document.getElementById('env-fim').value;
  if(!inicio||!fim){ alert('Selecione o período.'); return; }
  const p=cache.pagar.filter(x=>x.vencimento>=inicio&&x.vencimento<=fim);
  const r=cache.receber.filter(x=>x.vencimento>=inicio&&x.vencimento<=fim);
  const e=r.reduce((s,x)=>s+Number(x.valor),0),s=p.reduce((s,x)=>s+Number(x.valor),0);
  alert(`Período: ${inicio} → ${fim}\n\nEntradas: ${r.length} lançamentos → ${fmt(e)}\nSaídas: ${p.length} lançamentos → ${fmt(s)}\nResultado: ${fmt(e-s)}`);
}

async function enviarContador(){
  const inicio=document.getElementById('env-inicio').value;
  const fim=document.getElementById('env-fim').value;
  const obs=document.getElementById('env-obs').value;
  if(!inicio||!fim){ alert('Selecione o período.'); return; }
  const email=cache.config['contador_email']||'';
  const empresa=cache.config['empresa_nome']||'';
  const p=cache.pagar.filter(x=>x.vencimento>=inicio&&x.vencimento<=fim);
  const r=cache.receber.filter(x=>x.vencimento>=inicio&&x.vencimento<=fim);
  const e=r.reduce((s,x)=>s+Number(x.valor),0),sa=p.reduce((s,x)=>s+Number(x.valor),0);
  const txt=`RELATÓRIO CONTÁBIL${empresa?' — '+empresa:''}\nPeríodo: ${inicio} a ${fim}\nGerado em: ${new Date().toLocaleDateString('pt-BR')}\n${obs?'Obs: '+obs+'\n':''}\n${'='.repeat(52)}\n\nCONTAS A RECEBER\n${'-'.repeat(40)}\n`+
    r.map(x=>`${x.vencimento}  ${(x.descricao||'').padEnd(28)} R$ ${Number(x.valor).toFixed(2).padStart(12)}  [${x.status}]`).join('\n')+
    `\n\nCONTAS A PAGAR\n${'-'.repeat(40)}\n`+
    p.map(x=>`${x.vencimento}  ${(x.descricao||'').padEnd(28)} R$ ${Number(x.valor).toFixed(2).padStart(12)}  [${x.status}]`).join('\n')+
    `\n\n${'='.repeat(52)}\nTotal entradas: R$ ${e.toFixed(2)}\nTotal saídas:   R$ ${sa.toFixed(2)}\nResultado:      R$ ${(e-sa).toFixed(2)}\n${email?'\nEnviar para: '+email:''}`;
  dl(txt,`relatorio_contador_${inicio}_${fim}.txt`,'text/plain');
  await sb.from('envios_contador').insert({enviado_por:currentUser.id,email_destino:email,periodo_inicio:inicio,periodo_fim:fim,obs});
  const {data}=await sb.from('envios_contador').select('*').order('created_at',{ascending:false}).limit(10);
  cache.envios=data||[];
  renderEnvioHistorico();
}

function renderEnvioHistorico(){
  const el=document.getElementById('envio-historico'); if(!el) return;
  if(!cache.envios.length){ el.innerHTML='<div style="color:var(--txt2);font-size:13px;">Nenhum envio registrado.</div>'; return; }
  el.innerHTML=`<table><thead><tr><th>Data</th><th>Período</th><th>E-mail</th></tr></thead><tbody>`+
    cache.envios.map(e=>`<tr><td style="color:var(--txt2);">${new Date(e.created_at).toLocaleDateString('pt-BR')}</td><td>${e.periodo_inicio} → ${e.periodo_fim}</td><td style="color:var(--txt2);">${e.email_destino||'—'}</td></tr>`).join('')+`</tbody></table>`;
}

// MINHA CONTA
async function alterarSenha(){
  const nova=document.getElementById('nova-senha').value;
  const conf=document.getElementById('conf-senha').value;
  const msg=document.getElementById('senha-msg');
  if(nova.length<6){ msg.className='alert alert-warn'; msg.textContent='Senha mínima: 6 caracteres.'; msg.style.display='block'; return; }
  if(nova!==conf){ msg.className='alert alert-warn'; msg.textContent='As senhas não coincidem.'; msg.style.display='block'; return; }
  const {error}=await sb.auth.updateUser({password:nova});
  if(error){ msg.className='alert alert-warn'; msg.textContent='Erro: '+error.message; }
  else { msg.className='alert alert-ok'; msg.textContent='Senha alterada com sucesso!'; document.getElementById('nova-senha').value=''; document.getElementById('conf-senha').value=''; }
  msg.style.display='block';
  setTimeout(()=>msg.style.display='none',4000);
}
