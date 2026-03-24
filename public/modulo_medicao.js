/* ============================================================
   FinanceGest — modulo_medicao.js
   Importação de PDF de medição via IA (Claude API)
   Calibrado para o formato MXP / Aterro Sanitário de Manaus
   ============================================================ */

let medicaoState = {
  pdfBase64: null,
  pdfNome: null,
  resultadoIA: null,
  editado: null
};

function initMedicao() {
  const hoje = today();
  const venc = new Date();
  venc.setDate(venc.getDate() + 30);
  const mesInput = document.getElementById('med-competencia');
  const vencInput = document.getElementById('med-vencimento');
  if (mesInput && !mesInput.value) mesInput.value = hoje.slice(0, 7);
  if (vencInput && !vencInput.value) vencInput.value = venc.toISOString().slice(0, 10);
}

// ─── UPLOAD ──────────────────────────────────────────────────
function handleMedicaoPDF(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.type !== 'application/pdf') { alert('Selecione um arquivo PDF.'); return; }
  if (file.size > 5 * 1024 * 1024) { alert('PDF muito grande. Máximo 5MB.'); return; }

  medicaoState.pdfNome = file.name;
  document.getElementById('med-file-name').textContent = file.name;
  document.getElementById('med-file-name').style.display = '';

  const reader = new FileReader();
  reader.onload = e => {
    medicaoState.pdfBase64 = e.target.result.split(',')[1];
    document.getElementById('btn-extrair-pdf').disabled = false;
    setStatus('PDF carregado. Clique em "Extrair dados com IA" para continuar.', 'info');
  };
  reader.readAsDataURL(file);
}

function setStatus(msg, type) {
  const el = document.getElementById('med-upload-status');
  el.className = 'alert alert-' + (type === 'info' ? 'info' : type === 'ok' ? 'ok' : 'warn');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

// ─── EXTRAÇÃO VIA IA ─────────────────────────────────────────
async function extrairDadosPDF() {
  if (!medicaoState.pdfBase64) { alert('Selecione um PDF primeiro.'); return; }

  const btn = document.getElementById('btn-extrair-pdf');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Analisando PDF...';
  document.getElementById('med-resultado-wrap').style.display = 'none';
  setStatus('A IA está lendo o PDF — isso leva alguns segundos...', 'info');

  const maqLista = cache.maquinas.length
    ? cache.maquinas.map(m => `- ${m.marca} ${m.modelo} | placa: ${m.placa || 'sem placa'} | id: ${m.id}`).join('\n')
    : '(nenhuma máquina cadastrada ainda)';

  const prompt = `Você está lendo um PDF de medição mensal de aluguel de equipamentos da empresa MXP COM. LOC. EQUIP. LTDA.

REGRAS IMPORTANTES:
1. Os equipamentos aparecem na tabela da página 1 com código (ex: EHM-03), descrição, unidade (mês ou h), quantidade contratual e valor global.
2. As HORAS REAIS trabalhadas no período estão nas OBSERVAÇÕES da página 2, no formato "EHM-03 = 28,00h" — use SEMPRE essas horas, não a quantidade da tabela.
3. Para equipamentos cobrados por "mês", a quantidade é 1 (mês cheio), mas as horas reais vêm das observações.
4. Para equipamentos cobrados por "h", a quantidade da tabela é as horas faturadas, mas confirme com as observações.
5. O valor de cada equipamento é o "TOTAL" ou "GLOBAL" da tabela (já calculado).
6. Some todos os valores para obter o valor_total.
7. Tente cruzar cada equipamento com a lista de máquinas do sistema pelo modelo/marca/tipo.

MÁQUINAS CADASTRADAS NO SISTEMA:
${maqLista}

Responda APENAS com JSON válido, sem texto extra, sem markdown, no formato:
{
  "cliente": "nome do contratante/obra",
  "periodo": "MM/YYYY",
  "valor_total": 0.00,
  "equipamentos": [
    {
      "codigo": "código do equipamento (ex: EHM-03)",
      "identificacao": "descrição completa como aparece no PDF",
      "unidade": "mês ou h",
      "horas": 0.0,
      "valor": 0.00,
      "maquina_id": "id do sistema se conseguir cruzar, senão null"
    }
  ],
  "observacoes": "observações relevantes da página 2"
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: medicaoState.pdfBase64 } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    const text = data.content.map(i => i.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    const resultado = JSON.parse(clean);

    medicaoState.resultadoIA = resultado;
    medicaoState.editado = JSON.parse(JSON.stringify(resultado));

    // Preenche cliente automaticamente
    const clienteInput = document.getElementById('med-cliente-override');
    if (clienteInput && !clienteInput.value) clienteInput.value = resultado.cliente || '';

    // Preenche competência se vier do PDF
    if (resultado.periodo) {
      const parts = resultado.periodo.split('/');
      if (parts.length === 2) {
        const mesInput = document.getElementById('med-competencia');
        if (mesInput) mesInput.value = parts[1] + '-' + parts[0].padStart(2, '0');
      }
    }

    renderResultadoIA(resultado);
    btn.disabled = false;
    btn.innerHTML = 'Extrair dados com IA';
    setStatus('', '');

  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = 'Extrair dados com IA';
    setStatus('Erro ao processar: ' + err.message, 'warn');
    console.error(err);
  }
}

// ─── RENDER RESULTADO ────────────────────────────────────────
function renderResultadoIA(r) {
  document.getElementById('med-resultado-wrap').style.display = 'block';
  document.getElementById('med-res-cliente').textContent = r.cliente || '—';
  document.getElementById('med-res-periodo').textContent = r.periodo || '—';
  document.getElementById('med-res-valor').textContent = fmt(r.valor_total || 0);

  const obsWrap = document.getElementById('med-res-obs-wrap');
  if (r.observacoes) {
    document.getElementById('med-res-obs').textContent = r.observacoes;
    obsWrap.style.display = 'block';
  } else {
    obsWrap.style.display = 'none';
  }

  const tbody = document.getElementById('med-equip-tbody');
  if (!r.equipamentos || !r.equipamentos.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty">Nenhum equipamento identificado</div></td></tr>';
    return;
  }

  tbody.innerHTML = r.equipamentos.map((eq, i) => {
    const maqOptions = cache.maquinas.map(m =>
      `<option value="${m.id}" ${eq.maquina_id === m.id ? 'selected' : ''}>${m.marca} ${m.modelo}${m.placa ? ' — ' + m.placa : ''}</option>`
    ).join('');

    const cruzado = !!eq.maquina_id;
    const horaNaoConta = eq.unidade === 'mês'; // horímetro conta mesmo em contratos mensais

    return `<tr id="med-row-${i}">
      <td style="padding:10px 0 10px 1rem;">
        <div style="font-size:12px;font-weight:600;color:var(--txt2);">${eq.codigo || ''}</div>
        <div style="font-weight:500;font-size:13px;margin:2px 0;">${eq.identificacao}</div>
        <div style="margin-top:6px;">
          <select onchange="updateMedicaoEquip(${i},'maquina_id',this.value)" style="font-size:12px;padding:4px 8px;width:100%;max-width:260px;">
            <option value="">— Selecionar máquina do sistema —</option>
            ${maqOptions}
          </select>
        </div>
      </td>
      <td style="padding:10px 8px;text-align:center;">
        <span class="tag">${eq.unidade || '—'}</span>
      </td>
      <td style="padding:10px 8px;">
        <input type="number" value="${eq.horas || 0}" min="0" step="0.1"
          onchange="updateMedicaoEquip(${i},'horas',parseFloat(this.value)||0)"
          style="width:90px;font-size:13px;" ${!cruzado && horaNaoConta ? '' : ''}>
        <div style="font-size:11px;color:var(--txt2);margin-top:3px;">horas no período</div>
      </td>
      <td style="padding:10px 8px;">
        <input type="number" value="${eq.valor || 0}" min="0" step="0.01"
          onchange="updateMedicaoEquip(${i},'valor',parseFloat(this.value)||0)"
          style="width:110px;font-size:13px;">
      </td>
      <td style="padding:10px 1rem 10px 0;text-align:center;">
        <span class="badge ${cruzado ? 'badge-ok' : 'badge-warn'}" id="med-badge-${i}">
          ${cruzado ? 'Cruzado' : 'Verificar'}
        </span>
      </td>
    </tr>`;
  }).join('');

  // Atualiza total exibido ao vivo
  atualizarTotalEditado();
}

function updateMedicaoEquip(idx, campo, valor) {
  if (!medicaoState.editado || !medicaoState.editado.equipamentos) return;
  medicaoState.editado.equipamentos[idx][campo] = valor;

  if (campo === 'maquina_id') {
    const badge = document.getElementById('med-badge-' + idx);
    if (badge) {
      badge.className = 'badge ' + (valor ? 'badge-ok' : 'badge-warn');
      badge.textContent = valor ? 'Cruzado' : 'Verificar';
    }
  }
  if (campo === 'valor') atualizarTotalEditado();
}

function atualizarTotalEditado() {
  if (!medicaoState.editado) return;
  const total = (medicaoState.editado.equipamentos || []).reduce((s, e) => s + (Number(e.valor) || 0), 0);
  medicaoState.editado.valor_total = total;
  const el = document.getElementById('med-res-valor');
  if (el) el.textContent = fmt(total);
}

// ─── CONFIRMAR LANÇAMENTO ────────────────────────────────────
async function confirmarLancamento() {
  const r = medicaoState.editado;
  if (!r || !r.equipamentos) { alert('Extraia os dados do PDF primeiro.'); return; }

  const cliente = document.getElementById('med-cliente-override').value.trim() || r.cliente || 'Cliente';
  const venc = document.getElementById('med-vencimento').value;
  const competencia = document.getElementById('med-competencia').value;

  if (!venc) { alert('Informe o vencimento.'); return; }

  const semCruzamento = r.equipamentos.filter(e => !e.maquina_id && (e.horas || 0) > 0);
  if (semCruzamento.length > 0) {
    const nomes = semCruzamento.map(e => e.codigo + ' ' + e.identificacao).join('\n');
    const ok = confirm(`${semCruzamento.length} equipamento(s) com horas não foram cruzados com máquinas do sistema. As horas desses NÃO serão somadas ao horímetro:\n\n${nomes}\n\nContinuar mesmo assim?`);
    if (!ok) return;
  }

  const btn = document.getElementById('btn-confirmar-lancamento');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Lançando...';

  try {
    const valorTotal = r.valor_total || r.equipamentos.reduce((s, e) => s + (Number(e.valor) || 0), 0);
    const competenciaLabel = (() => {
      if (!competencia) return '';
      const [ano, mes] = competencia.split('-');
      const nomes = ['','janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
      return nomes[parseInt(mes)] + '/' + ano;
    })();
    const descricao = `Medição ${competenciaLabel} — ${cliente}`;

    // 1. Conta a receber
    const { data: contaData, error: contaErr } = await sb
      .from('contas_receber')
      .insert({
        descricao,
        contraparte: cliente,
        categoria: 'Aluguel de equipamentos',
        valor: valorTotal,
        vencimento: venc,
        status: 'pendente'
      })
      .select().single();

    if (contaErr) throw new Error('Erro ao lançar conta: ' + contaErr.message);
    cache.receber.push(contaData);

    // 2. Horímetro por máquina
    let horasLancadas = 0;
    for (const eq of r.equipamentos) {
      if (!eq.maquina_id || !(eq.horas > 0)) continue;
      const novaLeitura = calcNovaLeitura(eq.maquina_id, eq.horas);
      const { data: horaData, error: horaErr } = await sb
        .from('horimetro')
        .insert({
          maquina_id: eq.maquina_id,
          data: today(),
          leitura: novaLeitura,
          obs: `${eq.codigo ? eq.codigo + ' — ' : ''}${eq.horas}h no período (${competenciaLabel})`,
          registrado_por: currentUser.id
        })
        .select().single();
      if (!horaErr && horaData) { cache.horas.unshift(horaData); horasLancadas++; }
    }

    btn.disabled = false;
    btn.innerHTML = 'Confirmar e lançar';

    // Sucesso
    document.getElementById('med-sucesso').style.display = 'block';
    document.getElementById('med-sucesso-texto').innerHTML =
      `<strong>Lançado com sucesso!</strong><br>
       ✓ Conta a receber: <strong>${fmt(valorTotal)}</strong> — vencimento ${venc}<br>
       ✓ Horímetro atualizado em <strong>${horasLancadas}</strong> máquina(s)`;

    // Reset
    medicaoState = { pdfBase64: null, pdfNome: null, resultadoIA: null, editado: null };
    document.getElementById('med-resultado-wrap').style.display = 'none';
    document.getElementById('med-file-input').value = '';
    document.getElementById('med-file-name').style.display = 'none';
    document.getElementById('btn-extrair-pdf').disabled = true;
    document.getElementById('med-cliente-override').value = '';

    updateDashboard();

  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = 'Confirmar e lançar';
    alert('Erro: ' + err.message);
  }
}

function calcNovaLeitura(maqId, horasPeriodo) {
  const registros = cache.horas
    .filter(h => h.maquina_id === maqId)
    .sort((a, b) => b.data.localeCompare(a.data));
  const base = registros.length
    ? Number(registros[0].leitura)
    : (cache.maquinas.find(m => m.id === maqId)?.horimetro_inicial || 0);
  return Math.round((base + Number(horasPeriodo)) * 10) / 10;
}
