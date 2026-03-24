/* ============================================================
   FinanceGest — app.js
   Supabase backend + full UI logic
   ============================================================ */

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

let currentUser = null;
let userRole    = null;   // 'admin' | 'operador'
let currentMaqId = null;

// cache
let cache = { pagar:[], receber:[], maquinas:[], docs:[], horas:[] };

// ─── UTILS ───────────────────────────────────────────────────
const fmt  = v => 'R$ ' + Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const today = () => new Date().toISOString().slice(0,10);
const isAdmin = () => userRole === 'admin';

function loading(btnId, on){
  const b = document.getElementById(btnId);
  if(!b) return;
  b.disabled = on;
  b.innerHTML = on ? '<span class="spinner"></span>' : b.dataset.label || b.innerHTML;
}

function showErr(id, msg){ const el=document.getElementById(id); el.style.display=msg?'block':'none'; el.textContent=msg||''; }

// ─── AUTH ─────────────────────────────────────────────────────
async function doLogin(){
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;
  showErr('auth-err','');
  const btn = document.getElementById('login-btn');
  btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
  const {error} = await sb.auth.signInWithPassword({email,password:pass});
  btn.disabled=false; btn.innerHTML='Entrar';
  if(error) showErr('auth-err', 'E-mail ou senha incorretos.');
}

async function doLogout(){
  await sb.auth.signOut();
  location.reload();
}

sb.auth.onAuthStateChange(async (event, session) => {
  if(session?.user){
    currentUser = session.user;
    await loadUserRole();
    bootApp();
  } else {
    document.getElementById('auth-screen').style.display='flex';
    document.getElementById('app-screen').style.display='none';
  }
});

async function loadUserRole(){
  const {data} = await sb.from('user_roles').select('role').eq('user_id', currentUser.id).single();
  userRole = data?.role || 'operador';
}

function bootApp(){
  document.getElementById('auth-screen').style.display='none';
  document.getElementById('app-screen').style.display='flex';

  // show/hide financial nav items
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin() ? '' : 'none';
  });

  // user info
  document.getElementById('user-email-display').textContent = currentUser.email;
  document.getElementById('user-role-display').innerHTML =
    `<span class="user-role ${isAdmin()?'role-admin':'role-operador'}">${isAdmin()?'Admin':'Operador'}</span>`;

  // if operador, redirect dashboard to machines view
  if(!isAdmin()){
    document.getElementById('dash-metrics-financial').style.display='none';
  }

  loadAll();
}

// ─── DATA LOADING ─────────────────────────────────────────────
async function loadAll(){
  const [pRes, rRes, mRes] = await Promise.all([
    isAdmin() ? sb.from('contas_pagar').select('*').order('vencimento') : Promise.resolve({data:[]}),
    isAdmin() ? sb.from('contas_receber').select('*').order('vencimento') : Promise.resolve({data:[]}),
    sb.from('maquinas').select('*').order('marca')
  ]);
  cache.pagar    = pRes.data || [];
  cache.receber  = rRes.data || [];
  cache.maquinas = mRes.data || [];

  if(isAdmin()){
    const [dRes, hRes] = await Promise.all([
      sb.from('documentos').select('*'),
      sb.from('horimetro').select('*').order('data', {ascending:false})
    ]);
    cache.docs  = dRes.data || [];
    cache.horas = hRes.data || [];
  } else {
    const ids = cache.maquinas.map(m=>m.id);
    if(ids.length){
      const [dRes, hRes] = await Promise.all([
        sb.from('documentos').select('*').in('maquina_id', ids),
        sb.from('horimetro').select('*').in('maquina_id', ids).order('data', {ascending:false})
      ]);
      cache.docs  = dRes.data || [];
      cache.horas = hRes.data || [];
    }
  }

  updateDashboard();
  renderMaquinas();
}

// ─── NAVIGATION ───────────────────────────────────────────────
let chartFluxo, chartCat, chartFluxoDetail;

function showPage(id, el, skipActive){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  if(!skipActive){
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
    if(el) el.classList.add('active');
  }
  document.getElementById('page-'+id).classList.add('active');
  if(id==='dashboard') updateDashboard();
  if(id==='fluxo') renderFluxo();
  if(id==='pagar') renderPagar();
  if(id==='receber') renderReceber();
  if(id==='maquinas') renderMaquinas();
}

// ─── MODAL HELPERS ────────────────────────────────────────────
let finModalType = null;

function openModal(type){
  finModalType = type;
  document.getElementById('modal-fin-title').textContent = type==='pagar'?'Nova conta a pagar':'Nova conta a receber';
  document.getElementById('ff-part-label').textContent   = type==='pagar'?'Fornecedor':'Cliente';
  document.getElementById('ff-venc').value = today();
  ['ff-desc','ff-part','ff-valor'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('btn-save-fin').dataset.label='Salvar';
  document.getElementById('modal-fin').classList.add('open');
}

function closeModal(id){ document.getElementById('modal-'+id).classList.remove('open'); }

// ─── FINANCIAL CRUD ───────────────────────────────────────────
async function saveFinItem(){
  const desc  = document.getElementById('ff-desc').value.trim();
  const valor = parseFloat(document.getElementById('ff-valor').value)||0;
  const venc  = document.getElementById('ff-venc').value;
  const part  = document.getElementById('ff-part').value.trim();
  const cat   = document.getElementById('ff-cat').value;
  if(!desc||!valor||!venc){ alert('Preencha descrição, valor e vencimento.'); return; }
  loading('btn-save-fin', true);
  const status = venc < today() ? 'vencido' : 'pendente';
  const table  = finModalType==='pagar' ? 'contas_pagar' : 'contas_receber';
  const {data,error} = await sb.from(table).insert({descricao:desc,valor,vencimento:venc,contraparte:part,categoria:cat,status}).select().single();
  loading('btn-save-fin', false);
  if(error){ alert('Erro ao salvar: '+error.message); return; }
  if(finModalType==='pagar') cache.pagar.push(data); else cache.receber.push(data);
  closeModal('fin');
  if(finModalType==='pagar') renderPagar(); else renderReceber();
  updateDashboard();
}

async function toggleStatus(type, id){
  const arr   = type==='pagar' ? cache.pagar : cache.receber;
  const item  = arr.find(x=>x.id===id);
  if(!item) return;
  const newStatus = type==='pagar' ? (item.status==='pago'?'pendente':'pago') : (item.status==='recebido'?'pendente':'recebido');
  await sb.from(type==='pagar'?'contas_pagar':'contas_receber').update({status:newStatus}).eq('id',id);
  item.status = newStatus;
  if(type==='pagar') renderPagar(); else renderReceber();
  updateDashboard();
}

async function deleteFinItem(type, id){
  if(!confirm('Excluir este lançamento?')) return;
  await sb.from(type==='pagar'?'contas_pagar':'contas_receber').delete().eq('id',id);
  if(type==='pagar') cache.pagar = cache.pagar.filter(x=>x.id!==id);
  else cache.receber = cache.receber.filter(x=>x.id!==id);
  if(type==='pagar') renderPagar(); else renderReceber();
  updateDashboard();
}

// ─── STATUS BADGE ─────────────────────────────────────────────
function statusBadge(s){
  const map   = {pago:'badge-ok',recebido:'badge-ok',pendente:'badge-warn',vencido:'badge-err'};
  const label = {pago:'Pago',recebido:'Recebido',pendente:'Pendente',vencido:'Vencido'};
  return `<span class="badge ${map[s]||'badge-warn'}">${label[s]||s}</span>`;
}

// ─── RENDER PAGAR ─────────────────────────────────────────────
function renderPagar(){
  const q = document.getElementById('search-pagar').value.toLowerCase();
  const f = document.getElementById('filter-pagar').value;
  const rows = cache.pagar.filter(x=>(!q||(x.descricao+x.contraparte).toLowerCase().includes(q))&&(!f||x.status===f))
    .sort((a,b)=>a.vencimento.localeCompare(b.vencimento));
  const tb = document.getElementById('tbody-pagar');
  if(!rows.length){ tb.innerHTML=`<tr><td colspan="6"><div class="empty">Nenhuma conta encontrada</div></td></tr>`; return; }
  tb.innerHTML = rows.map(x=>`<tr>
    <td style="padding:10px 1.25rem;"><strong style="font-weight:500;">${x.descricao}</strong><br><span class="tag">${x.categoria}</span></td>
    <td style="color:var(--txt2);">${x.contraparte||'—'}</td>
    <td style="color:var(--txt2);">${x.vencimento}</td>
    <td class="neg"><strong style="font-weight:500;">${fmt(x.valor)}</strong></td>
    <td>${statusBadge(x.status)}</td>
    <td style="padding-right:1.25rem;white-space:nowrap;">
      <button class="btn" style="font-size:11px;padding:4px 8px;" onclick="toggleStatus('pagar','${x.id}')">${x.status==='pago'?'Reabrir':'Marcar pago'}</button>
      <button class="btn btn-danger" style="font-size:11px;padding:4px 8px;margin-left:4px;" onclick="deleteFinItem('pagar','${x.id}')">✕</button>
    </td></tr>`).join('');
}

// ─── RENDER RECEBER ───────────────────────────────────────────
function renderReceber(){
  const q = document.getElementById('search-receber').value.toLowerCase();
  const f = document.getElementById('filter-receber').value;
  const rows = cache.receber.filter(x=>(!q||(x.descricao+x.contraparte).toLowerCase().includes(q))&&(!f||x.status===f))
    .sort((a,b)=>a.vencimento.localeCompare(b.vencimento));
  const tb = document.getElementById('tbody-receber');
  if(!rows.length){ tb.innerHTML=`<tr><td colspan="6"><div class="empty">Nenhuma conta encontrada</div></td></tr>`; return; }
  tb.innerHTML = rows.map(x=>`<tr>
    <td style="padding:10px 1.25rem;"><strong style="font-weight:500;">${x.descricao}</strong><br><span class="tag">${x.categoria}</span></td>
    <td style="color:var(--txt2);">${x.contraparte||'—'}</td>
    <td style="color:var(--txt2);">${x.vencimento}</td>
    <td class="pos"><strong style="font-weight:500;">${fmt(x.valor)}</strong></td>
    <td>${statusBadge(x.status)}</td>
    <td style="padding-right:1.25rem;white-space:nowrap;">
      <button class="btn" style="font-size:11px;padding:4px 8px;" onclick="toggleStatus('receber','${x.id}')">${x.status==='recebido'?'Reabrir':'Marcar recebido'}</button>
      <button class="btn btn-danger" style="font-size:11px;padding:4px 8px;margin-left:4px;" onclick="deleteFinItem('receber','${x.id}')">✕</button>
    </td></tr>`).join('');
}

// ─── DASHBOARD ────────────────────────────────────────────────
function getMonthLabel(offset){ const d=new Date(); d.setMonth(d.getMonth()+offset); return d.toLocaleString('pt-BR',{month:'short',year:'2-digit'}); }
function itemsInMonth(arr,offset){ const d=new Date(); d.setMonth(d.getMonth()+offset); const ym=d.toISOString().slice(0,7); return arr.filter(x=>(x.vencimento||'').slice(0,7)===ym); }

function updateDashboard(){
  if(isAdmin()){
    const t=today(), d30=new Date(); d30.setDate(d30.getDate()+30); const d30s=d30.toISOString().slice(0,10);
    const p30  = cache.pagar.filter(x=>x.status!=='pago'&&x.vencimento>=t&&x.vencimento<=d30s);
    const r30  = cache.receber.filter(x=>x.status!=='recebido'&&x.vencimento>=t&&x.vencimento<=d30s);
    const saldo= cache.receber.filter(x=>x.status==='recebido').reduce((s,x)=>s+Number(x.valor),0)
                -cache.pagar.filter(x=>x.status==='pago').reduce((s,x)=>s+Number(x.valor),0);
    document.getElementById('m-saldo').textContent=fmt(saldo);
    document.getElementById('m-saldo').className='metric-value '+(saldo>=0?'pos':'neg');
    document.getElementById('m-receber').textContent=fmt(r30.reduce((s,x)=>s+Number(x.valor),0));
    document.getElementById('m-pagar').textContent=fmt(p30.reduce((s,x)=>s+Number(x.valor),0));
    document.getElementById('m-receber-qt').textContent=r30.length+' lançamento'+(r30.length!==1?'s':'');
    document.getElementById('m-pagar-qt').textContent=p30.length+' lançamento'+(p30.length!==1?'s':'');
    buildChartFluxo(); buildChartCat();
  }

  // machines metrics
  document.getElementById('m-maq').textContent = cache.maquinas.length;

  const td=today(), d30b=new Date(); d30b.setDate(d30b.getDate()+30); const d30bs=d30b.toISOString().slice(0,10);
  const docsWarn = cache.docs.filter(x=>x.vencimento&&x.vencimento>=td&&x.vencimento<=d30bs);
  document.getElementById('m-docs').textContent = docsWarn.length;

  const valorFrota = cache.maquinas.reduce((s,m)=>s+calcValorAtual(m),0);
  document.getElementById('m-frota').textContent = fmt(valorFrota);

  // vencimentos 7d
  const d7=new Date(); d7.setDate(d7.getDate()+7); const d7s=d7.toISOString().slice(0,10);
  let proximos = [];
  if(isAdmin()){
    proximos=[
      ...cache.pagar.filter(x=>x.status!=='pago'&&x.vencimento>=td&&x.vencimento<=d7s).map(x=>({...x,tipo:'pagar'})),
      ...cache.receber.filter(x=>x.status!=='recebido'&&x.vencimento>=td&&x.vencimento<=d7s).map(x=>({...x,tipo:'receber'}))
    ];
  }
  proximos=[...proximos,...cache.docs.filter(x=>x.vencimento&&x.vencimento>=td&&x.vencimento<=d7s).map(x=>({...x,tipo:'documento',descricao:x.tipo+' — '+(x.maquina_nome||maqNome(x.maquina_id)),valor:0}))];
  proximos.sort((a,b)=>(a.vencimento||'').localeCompare(b.vencimento||''));

  const vList=document.getElementById('vencimentos-list');
  if(!proximos.length){ vList.innerHTML='<div class="empty">Nenhum vencimento nos próximos 7 dias</div>'; }
  else {
    vList.innerHTML=`<table><thead><tr><th style="padding:8px 0 8px;">Descrição</th><th>Tipo</th><th>Vencimento</th><th>Valor</th></tr></thead><tbody>`+
      proximos.map(x=>`<tr>
        <td>${x.descricao}</td>
        <td><span class="badge ${x.tipo==='receber'?'badge-ok':x.tipo==='documento'?'badge-warn':'badge-err'}">${x.tipo==='pagar'?'Pagar':x.tipo==='receber'?'Receber':'Documento'}</span></td>
        <td style="color:var(--txt2);">${x.vencimento}</td>
        <td class="${x.tipo==='receber'?'pos':x.tipo==='pagar'?'neg':''}">${x.valor?fmt(x.valor):'—'}</td>
      </tr>`).join('')+`</tbody></table>`;
  }
}

function maqNome(id){ const m=cache.maquinas.find(x=>x.id===id); return m?`${m.marca} ${m.modelo}`:''; }

function buildChartFluxo(){
  const labels   = [-5,-4,-3,-2,-1,0].map(getMonthLabel);
  const entradas = [-5,-4,-3,-2,-1,0].map(i=>itemsInMonth(cache.receber,i).reduce((s,x)=>s+Number(x.valor),0));
  const saidas   = [-5,-4,-3,-2,-1,0].map(i=>itemsInMonth(cache.pagar,i).reduce((s,x)=>s+Number(x.valor),0));
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
  const totalE=cache.receber.reduce((s,x)=>s+Number(x.valor),0);
  const totalS=cache.pagar.reduce((s,x)=>s+Number(x.valor),0);
  const res=totalE-totalS;
  document.getElementById('fc-entrada').textContent=fmt(totalE);
  document.getElementById('fc-saida').textContent=fmt(totalS);
  document.getElementById('fc-resultado').textContent=fmt(res);
  document.getElementById('fc-resultado').className='metric-value '+(res>=0?'pos':'neg');
  const labels=[-5,-4,-3,-2,-1,0,1,2].map(getMonthLabel);
  const entradas=[-5,-4,-3,-2,-1,0,1,2].map(i=>itemsInMonth(cache.receber,i).reduce((s,x)=>s+Number(x.valor),0));
  const saidas=[-5,-4,-3,-2,-1,0,1,2].map(i=>itemsInMonth(cache.pagar,i).reduce((s,x)=>s+Number(x.valor),0));
  if(chartFluxoDetail) chartFluxoDetail.destroy();
  chartFluxoDetail=new Chart(document.getElementById('chartFluxoDetail'),{type:'line',data:{labels,datasets:[{label:'Entradas',data:entradas,borderColor:'#1D9E75',backgroundColor:'rgba(29,158,117,0.1)',fill:true,tension:0.4,pointRadius:4},{label:'Saídas',data:saidas,borderColor:'#D85A30',backgroundColor:'rgba(216,90,48,0.08)',fill:true,tension:0.4,pointRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:12},boxWidth:12}}},scales:{x:{grid:{display:false}},y:{grid:{color:'rgba(128,128,128,0.1)'},ticks:{callback:v=>'R$'+Number(v).toLocaleString('pt-BR')}}}}});
  const all=[...cache.receber.map(x=>({...x,tipo:'entrada'})),...cache.pagar.map(x=>({...x,tipo:'saida'}))].sort((a,b)=>(b.vencimento||'').localeCompare(a.vencimento||''));
  const tb=document.getElementById('tbody-extrato');
  if(!all.length){ tb.innerHTML=`<tr><td colspan="4"><div class="empty">Sem lançamentos</div></td></tr>`; return; }
  tb.innerHTML=all.slice(0,30).map(x=>`<tr>
    <td style="color:var(--txt2);">${x.vencimento}</td><td>${x.descricao}</td>
    <td><span class="badge ${x.tipo==='entrada'?'badge-ok':'badge-err'}">${x.tipo==='entrada'?'Entrada':'Saída'}</span></td>
    <td class="${x.tipo==='entrada'?'pos':'neg'}">${x.tipo==='entrada'?'+':'-'}${fmt(x.valor)}</td>
  </tr>`).join('');
}

// ─── EXPORTS ──────────────────────────────────────────────────
function exportCSV(){
  const rows=[['Tipo','Descrição','Contraparte','Categoria','Vencimento','Valor','Status']];
  cache.pagar.forEach(x=>rows.push(['Pagar',x.descricao,x.contraparte||'',x.categoria,x.vencimento,x.valor,x.status]));
  cache.receber.forEach(x=>rows.push(['Receber',x.descricao,x.contraparte||'',x.categoria,x.vencimento,x.valor,x.status]));
  dl('\uFEFF'+rows.map(r=>r.map(c=>`"${c}"`).join(';')).join('\n'),'financeiro_'+today()+'.csv','text/csv');
}
function exportTxt(){
  const e=cache.receber.reduce((s,x)=>s+Number(x.valor),0), s=cache.pagar.reduce((s,x)=>s+Number(x.valor),0);
  const txt=`RELATÓRIO FINANCEIRO — ${new Date().toLocaleDateString('pt-BR')}\n${'='.repeat(50)}\n\nCONTAS A RECEBER\n${'-'.repeat(40)}\n`+
    cache.receber.map(x=>`${x.vencimento}  ${(x.descricao||'').padEnd(28)} R$ ${Number(x.valor).toFixed(2).padStart(12)}  [${x.status}]`).join('\n')+
    `\n\nCONTAS A PAGAR\n${'-'.repeat(40)}\n`+
    cache.pagar.map(x=>`${x.vencimento}  ${(x.descricao||'').padEnd(28)} R$ ${Number(x.valor).toFixed(2).padStart(12)}  [${x.status}]`).join('\n')+
    `\n\n${'='.repeat(50)}\nTotal entradas: R$ ${e.toFixed(2)}\nTotal saídas:   R$ ${s.toFixed(2)}\nResultado:      R$ ${(e-s).toFixed(2)}\n`;
  dl(txt,'relatorio_contador_'+today()+'.txt','text/plain');
}
function dl(content,name,type){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); }

// ─── DEPRECIAÇÃO ─────────────────────────────────────────────
function calcValorAtual(m){
  if(!m.valor_compra || !m.data_aquisicao) return 0;
  const anos = (Date.now()-new Date(m.data_aquisicao).getTime())/(1000*60*60*24*365.25);
  const vidaUtil = m.vida_util || 10;
  const residual = m.valor_residual || 0;
  const dep = Math.min(anos/vidaUtil, 1) * (Number(m.valor_compra)-residual);
  return Math.max(Number(m.valor_compra)-dep, residual);
}

function calcDepPercent(m){
  if(!m.valor_compra || !m.data_aquisicao) return 0;
  const anos=(Date.now()-new Date(m.data_aquisicao).getTime())/(1000*60*60*24*365.25);
  return Math.min(anos/(m.vida_util||10)*100, 100);
}

// ─── MÁQUINAS LIST ────────────────────────────────────────────
function renderMaquinas(){
  const q=(document.getElementById('search-maq')||{}).value?.toLowerCase()||'';
  const rows=cache.maquinas.filter(m=>!q||(m.marca+m.modelo+m.placa).toLowerCase().includes(q));
  const grid=document.getElementById('maquinas-grid');
  if(!rows.length){ grid.innerHTML='<div class="empty">Nenhuma máquina cadastrada</div>'; return; }
  grid.innerHTML=rows.map(m=>{
    const horasAtual = latestHoras(m.id) || m.horimetro_inicial || 0;
    const dep = calcDepPercent(m);
    const docsVenc = cache.docs.filter(d=>d.maquina_id===m.id && d.vencimento && d.vencimento < today()).length;
    return `<div class="machine-card" onclick="openMaqDetalhe('${m.id}')">
      <div class="machine-header">
        <div>
          <div class="machine-name">${m.marca} ${m.modelo}</div>
          <div class="machine-sub">${m.tipo||''} · ${m.ano||''} · ${m.placa||''}</div>
        </div>
        ${docsVenc?`<span class="badge badge-err">${docsVenc} doc${docsVenc>1?'s':''} vencido${docsVenc>1?'s':''}</span>`:'<span class="badge badge-ok">OK</span>'}
      </div>
      <div class="machine-stats">
        <div class="machine-stat"><div class="machine-stat-label">Horímetro</div><div class="machine-stat-val">${Number(horasAtual).toLocaleString('pt-BR')} h</div></div>
        <div class="machine-stat"><div class="machine-stat-label">Valor atual</div><div class="machine-stat-val">${m.valor_compra?fmt(calcValorAtual(m)):'—'}</div></div>
      </div>
      ${m.valor_compra?`<div style="margin-top:10px;"><div style="font-size:11px;color:var(--txt2);margin-bottom:4px;">Depreciação: ${dep.toFixed(0)}%</div><div class="progress-bar"><div class="progress-fill" style="width:${dep.toFixed(0)}%;background:${dep>80?'#D85A30':dep>50?'#BA7517':'#1D9E75'};"></div></div></div>`:''}
    </div>`;
  }).join('');
  if(!isAdmin()) document.getElementById('btn-nova-maq-wrap').style.display='none';
}

function latestHoras(maqId){
  const r=cache.horas.filter(h=>h.maquina_id===maqId).sort((a,b)=>b.data.localeCompare(a.data));
  return r.length ? r[0].leitura : null;
}

// ─── MÁQUINA DETALHE ──────────────────────────────────────────
function openMaqDetalhe(id){
  currentMaqId = id;
  const m = cache.maquinas.find(x=>x.id===id);
  if(!m) return;
  document.getElementById('maq-detalhe-title').textContent = `${m.marca} ${m.modelo}`;

  // actions
  const actWrap = document.getElementById('maq-detalhe-actions');
  if(isAdmin()){
    actWrap.innerHTML=`<button class="btn" onclick="openMaqModal('${id}')">✎ Editar</button>
      <button class="btn btn-danger" onclick="deleteMaquina('${id}')">Excluir</button>`;
  } else { actWrap.innerHTML=''; }

  // show/hide buttons for operador
  document.getElementById('btn-add-doc').style.display = isAdmin()?'':'none';
  document.getElementById('btn-add-hora').style.display = '';

  // info geral
  const horasAtual = latestHoras(id) || m.horimetro_inicial || 0;
  document.getElementById('maq-info-geral').innerHTML=`
    <table><tbody>
      <tr><td style="color:var(--txt2);padding:7px 0;width:140px;">Tipo</td><td style="padding:7px 0;">${m.tipo||'—'}</td></tr>
      <tr><td style="color:var(--txt2);padding:7px 0;">Placa / Série</td><td style="padding:7px 0;">${m.placa||'—'}</td></tr>
      <tr><td style="color:var(--txt2);padding:7px 0;">Ano</td><td style="padding:7px 0;">${m.ano||'—'}</td></tr>
      <tr><td style="color:var(--txt2);padding:7px 0;">Horímetro atual</td><td style="padding:7px 0;font-weight:500;">${Number(horasAtual).toLocaleString('pt-BR')} h</td></tr>
      <tr><td style="color:var(--txt2);padding:7px 0;">Data aquisição</td><td style="padding:7px 0;">${m.data_aquisicao||'—'}</td></tr>
      ${m.obs?`<tr><td style="color:var(--txt2);padding:7px 0;">Obs.</td><td style="padding:7px 0;color:var(--txt2);">${m.obs}</td></tr>`:''}
    </tbody></table>`;

  // depreciação
  if(m.valor_compra){
    const dep=calcDepPercent(m), va=calcValorAtual(m);
    const anos=(Date.now()-new Date(m.data_aquisicao).getTime())/(1000*60*60*24*365.25);
    document.getElementById('maq-depreciacao').innerHTML=`
      <table><tbody>
        <tr><td style="color:var(--txt2);padding:7px 0;width:140px;">Valor de compra</td><td style="padding:7px 0;">${fmt(m.valor_compra)}</td></tr>
        <tr><td style="color:var(--txt2);padding:7px 0;">Valor atual</td><td style="padding:7px 0;font-weight:500;" class="pos">${fmt(va)}</td></tr>
        <tr><td style="color:var(--txt2);padding:7px 0;">Depreciado</td><td style="padding:7px 0;" class="neg">${fmt(Number(m.valor_compra)-va)}</td></tr>
        <tr><td style="color:var(--txt2);padding:7px 0;">Vida útil</td><td style="padding:7px 0;">${m.vida_util||10} anos</td></tr>
        <tr><td style="color:var(--txt2);padding:7px 0;">Valor residual</td><td style="padding:7px 0;">${fmt(m.valor_residual||0)}</td></tr>
      </tbody></table>
      <div style="margin-top:12px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--txt2);margin-bottom:4px;"><span>Depreciação acumulada</span><span>${dep.toFixed(1)}%</span></div>
        <div class="progress-bar" style="height:8px;"><div class="progress-fill" style="width:${dep.toFixed(0)}%;background:${dep>80?'#D85A30':dep>50?'#BA7517':'#1D9E75'};"></div></div>
        <div style="font-size:11px;color:var(--txt2);margin-top:4px;">${anos.toFixed(1)} anos em uso</div>
      </div>`;
  } else {
    document.getElementById('maq-depreciacao').innerHTML='<div style="color:var(--txt2);font-size:13px;">Sem dados de valor de compra.</div>';
  }

  renderDocsList(id);
  renderHorasList(id);

  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-maq-detalhe').classList.add('active');
}

function renderDocsList(maqId){
  const docs=cache.docs.filter(d=>d.maquina_id===maqId).sort((a,b)=>(a.vencimento||'').localeCompare(b.vencimento||''));
  const el=document.getElementById('maq-docs-list');
  if(!docs.length){ el.innerHTML='<div style="color:var(--txt2);font-size:13px;padding:8px 0;">Nenhum documento cadastrado.</div>'; return; }
  el.innerHTML=docs.map(d=>{
    const venc=d.vencimento;
    const expired=venc&&venc<today(); const warn=venc&&!expired&&venc<in30();
    const badge=expired?'badge-err':warn?'badge-warn':'badge-ok';
    const label=expired?'Vencido':warn?'Vence em breve':'Válido';
    return `<div class="doc-row">
      <div><strong style="font-weight:500;">${d.tipo}</strong>${d.numero?` <span class="tag">${d.numero}</span>`:''}</div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:12px;color:var(--txt2);">${venc||'—'}</span>
        <span class="badge ${badge}">${label}</span>
        ${isAdmin()?`<button class="btn btn-danger" style="font-size:11px;padding:3px 7px;" onclick="deleteDoc('${d.id}')">✕</button>`:''}
      </div>
    </div>`;
  }).join('');
}

function renderHorasList(maqId){
  const horas=cache.horas.filter(h=>h.maquina_id===maqId).sort((a,b)=>b.data.localeCompare(a.data)).slice(0,10);
  const el=document.getElementById('maq-horas-list');
  if(!horas.length){ el.innerHTML='<div style="color:var(--txt2);font-size:13px;padding:8px 0;">Nenhum registro de horímetro.</div>'; return; }
  el.innerHTML=`<table><thead><tr><th>Data</th><th>Leitura (h)</th><th>Observação</th><th></th></tr></thead><tbody>`+
    horas.map(h=>`<tr>
      <td style="color:var(--txt2);">${h.data}</td>
      <td><strong style="font-weight:500;">${Number(h.leitura).toLocaleString('pt-BR')}</strong></td>
      <td style="color:var(--txt2);">${h.obs||'—'}</td>
      <td><button class="btn btn-danger" style="font-size:11px;padding:3px 7px;" onclick="deleteHora('${h.id}')">✕</button></td>
    </tr>`).join('')+`</tbody></table>`;
}

function in30(){ const d=new Date(); d.setDate(d.getDate()+30); return d.toISOString().slice(0,10); }

// ─── MÁQUINA MODAL ────────────────────────────────────────────
let editingMaqId = null;

function openMaqModal(id){
  editingMaqId = id||null;
  const m = id ? cache.maquinas.find(x=>x.id===id) : null;
  document.getElementById('modal-maq-title').textContent = m?'Editar máquina':'Nova máquina';
  document.getElementById('fm-marca').value   = m?.marca||'';
  document.getElementById('fm-modelo').value  = m?.modelo||'';
  document.getElementById('fm-ano').value     = m?.ano||'';
  document.getElementById('fm-placa').value   = m?.placa||'';
  document.getElementById('fm-tipo').value    = m?.tipo||'Caminhão';
  document.getElementById('fm-horas').value   = m?.horimetro_inicial||0;
  document.getElementById('fm-valor-compra').value  = m?.valor_compra||'';
  document.getElementById('fm-data-aq').value = m?.data_aquisicao||'';
  document.getElementById('fm-vida-util').value = m?.vida_util||10;
  document.getElementById('fm-valor-residual').value = m?.valor_residual||0;
  document.getElementById('fm-obs').value     = m?.obs||'';
  document.getElementById('btn-save-maq').dataset.label='Salvar';
  document.getElementById('modal-maq').classList.add('open');
}

async function saveMaquina(){
  const marca=document.getElementById('fm-marca').value.trim();
  const modelo=document.getElementById('fm-modelo').value.trim();
  if(!marca||!modelo){ alert('Preencha marca e modelo.'); return; }
  loading('btn-save-maq',true);
  const payload={
    marca, modelo,
    ano: parseInt(document.getElementById('fm-ano').value)||null,
    placa: document.getElementById('fm-placa').value.trim(),
    tipo: document.getElementById('fm-tipo').value,
    horimetro_inicial: parseFloat(document.getElementById('fm-horas').value)||0,
    valor_compra: parseFloat(document.getElementById('fm-valor-compra').value)||null,
    data_aquisicao: document.getElementById('fm-data-aq').value||null,
    vida_util: parseInt(document.getElementById('fm-vida-util').value)||10,
    valor_residual: parseFloat(document.getElementById('fm-valor-residual').value)||0,
    obs: document.getElementById('fm-obs').value.trim()
  };
  let data, error;
  if(editingMaqId){
    ({data,error}=await sb.from('maquinas').update(payload).eq('id',editingMaqId).select().single());
    if(!error){ const idx=cache.maquinas.findIndex(x=>x.id===editingMaqId); if(idx>=0) cache.maquinas[idx]=data; }
  } else {
    ({data,error}=await sb.from('maquinas').insert(payload).select().single());
    if(!error) cache.maquinas.push(data);
  }
  loading('btn-save-maq',false);
  if(error){ alert('Erro: '+error.message); return; }
  closeModal('maq');
  renderMaquinas();
  updateDashboard();
}

async function deleteMaquina(id){
  if(!confirm('Excluir esta máquina e todos os seus registros?')) return;
  await sb.from('documentos').delete().eq('maquina_id',id);
  await sb.from('horimetro').delete().eq('maquina_id',id);
  await sb.from('maquinas').delete().eq('id',id);
  cache.maquinas=cache.maquinas.filter(x=>x.id!==id);
  cache.docs=cache.docs.filter(x=>x.maquina_id!==id);
  cache.horas=cache.horas.filter(x=>x.maquina_id!==id);
  showPage('maquinas',null,true);
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.querySelector('.nav-item:nth-child(6)').classList.add('active');
  renderMaquinas(); updateDashboard();
}

// ─── DOCUMENTO MODAL ──────────────────────────────────────────
function openDocModal(){
  ['fd-numero','fd-obs'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('fd-emissao').value=today();
  document.getElementById('fd-venc').value='';
  document.getElementById('btn-save-doc').dataset.label='Salvar';
  document.getElementById('modal-doc').classList.add('open');
}

async function saveDoc(){
  const tipo=document.getElementById('fd-tipo').value;
  const venc=document.getElementById('fd-venc').value;
  if(!venc){ alert('Informe o vencimento do documento.'); return; }
  loading('btn-save-doc',true);
  const {data,error}=await sb.from('documentos').insert({
    maquina_id:currentMaqId, tipo,
    numero:document.getElementById('fd-numero').value.trim(),
    emissao:document.getElementById('fd-emissao').value||null,
    vencimento:venc,
    obs:document.getElementById('fd-obs').value.trim()
  }).select().single();
  loading('btn-save-doc',false);
  if(error){ alert('Erro: '+error.message); return; }
  cache.docs.push(data);
  closeModal('doc');
  renderDocsList(currentMaqId);
  updateDashboard();
}

async function deleteDoc(id){
  if(!confirm('Excluir documento?')) return;
  await sb.from('documentos').delete().eq('id',id);
  cache.docs=cache.docs.filter(x=>x.id!==id);
  renderDocsList(currentMaqId);
  updateDashboard();
}

// ─── HORÍMETRO MODAL ──────────────────────────────────────────
function openHoraModal(){
  document.getElementById('fh-data').value=today();
  document.getElementById('fh-horas').value=latestHoras(currentMaqId)||'';
  document.getElementById('fh-obs').value='';
  document.getElementById('btn-save-hora').dataset.label='Salvar';
  document.getElementById('modal-hora').classList.add('open');
}

async function saveHora(){
  const data=document.getElementById('fh-data').value;
  const leitura=parseFloat(document.getElementById('fh-horas').value)||0;
  if(!data||!leitura){ alert('Preencha data e leitura.'); return; }
  loading('btn-save-hora',true);
  const {data:row,error}=await sb.from('horimetro').insert({
    maquina_id:currentMaqId, data, leitura,
    obs:document.getElementById('fh-obs').value.trim(),
    registrado_por:currentUser.id
  }).select().single();
  loading('btn-save-hora',false);
  if(error){ alert('Erro: '+error.message); return; }
  cache.horas.unshift(row);
  closeModal('hora');
  renderHorasList(currentMaqId);
  updateDashboard();
}

async function deleteHora(id){
  if(!confirm('Excluir este registro?')) return;
  await sb.from('horimetro').delete().eq('id',id);
  cache.horas=cache.horas.filter(x=>x.id!==id);
  renderHorasList(currentMaqId);
}
