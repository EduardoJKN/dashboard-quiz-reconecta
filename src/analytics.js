// ============================================================================
// analytics.js — registro de eventos do funil + agregação para o dashboard.
// Armazena em data/eventos.jsonl (1 evento por linha). Funções nunca lançam
// erro pra não quebrar a requisição.
//
// ATENÇÃO (Render Free): o disco é efêmero — os eventos zeram a cada redeploy
// ou quando o serviço hiberna. Pra histórico permanente (faturamento/reembolso),
// plugar um banco (Postgres) ou um disco persistente. Pro começo, arquivo basta.
// ============================================================================
const fs = require('fs');
const path = require('path');
const { carregarPagamento } = require('./pagamentoGuru');
const { carregarLeads } = require('./leadsQuiz');
const { carregarFunilQuiz } = require('./funilQuiz');

const DIR = path.join(__dirname, '..', 'data');
const ARQ = path.join(DIR, 'eventos.jsonl');

function garantirDir() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
}

// --- Registra um evento (à prova de falha) -----------------------------------
function registrar(tipo, sessao, dados = {}) {
  try {
    garantirDir();
    const ev = { ts: Date.now(), tipo, sessao: sessao || 'anon', dados: dados || {} };
    fs.appendFileSync(ARQ, JSON.stringify(ev) + '\n');
  } catch (e) {
    console.error('[analytics] falha ao registrar:', e.message);
  }
}

// --- Rótulos amigáveis das 15 perguntas (pro funil) --------------------------
const LABEL_PERGUNTA = {
  1: 'P1 · Momento',
  2: 'P2 · Formação',
  3: 'P3 · Foco',
  4: 'P4 · Bio (clareza)',
  5: 'P5 · Caminho p/ agendar',
  6: 'P6 · Conteúdo (atrai)',
  7: 'P7 · Conteúdo (vende)',
  8: 'P8 · Prova (mostra)',
  9: 'P9 · Prova (confiança)',
  10: 'P10 · Conversão (some)',
  11: 'P11 · Conversão (preço)',
  12: 'P12 · Constância (posta)',
  13: 'P13 · Constância (some)',
  14: 'P14 · Custo',
  15: 'P15 · Compromisso',
};

const PERFIL_EMOJI = {
  'A Especialista Invisível': '🎭',
  'A Vitrine Sem Placa': '🪧',
  'O Ímã de Curiosos': '🧲',
  'A Autoridade Tímida': '🤫',
  'Curtida, Mas Não Agendada': '💔',
  'O Fantasma do Feed': '👻',
};

// Agrupa o faturamento (do formulario do quiz) em 3 baldes de qualidade de lead.
// Os valores brutos vem do select 'faturamento' da captura.
function bucketFaturamento(v) {
  if (!v) return null;
  if (v === 'comecar') return 'Não atua na área';
  if (v === 'ate_5k' || v === '5k_12k') return 'Abaixo de R$12k/mês';
  if (v === '13k_30k' || v === '31k_70k' || v === 'acima_71k') return 'Acima de R$12k/mês';
  return 'Outro';
}

// --- Ordem das etapas do funil (sessões) -------------------------------------
function etapasFunil() {
  const et = [
    { key: 'visita', label: 'Abriu o quiz' },
    { key: 'iniciou', label: 'Começou a responder' },
  ];
  for (let n = 1; n <= 15; n++) et.push({ key: 'p' + n, label: LABEL_PERGUNTA[n] });
  et.push({ key: 'captura', label: 'Chegou no formulário' });
  et.push({ key: 'lead', label: 'Preencheu os dados' });
  et.push({ key: 'resultado', label: 'Viu o diagnóstico' });
  et.push({ key: 'compra', label: 'Clicou em comprar' });
  et.push({ key: 'pdf', label: 'PDF gerado' });
  return et;
}

function tipoParaKey(ev) {
  if (ev.tipo === 'passo') return 'p' + (ev.dados && ev.dados.passo);
  return ev.tipo; // visita, iniciou, captura, lead, resultado, compra, pdf
}

function lerEventos() {
  try {
    if (!fs.existsSync(ARQ)) return [];
    return fs
      .readFileSync(ARQ, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

// --- Agrega tudo num objeto pro dashboard ------------------------------------
async function metricas() {
  const eventos = lerEventos();
  const etapas = etapasFunil();
  const indexDe = {};
  etapas.forEach((e, i) => (indexDe[e.key] = i));

  // Agrupa por sessão: quais etapas alcançou + qual perfil recebeu
  const sessoes = {};
  for (const ev of eventos) {
    const key = tipoParaKey(ev);
    if (indexDe[key] == null) continue; // ignora tipos fora do funil (ex.: pago, reembolso)
    const s = (sessoes[ev.sessao] = sessoes[ev.sessao] || { keys: new Set(), perfil: null, origem: null });
    s.keys.add(key);
    if (key === 'resultado' && ev.dados && ev.dados.perfil) s.perfil = ev.dados.perfil;
    // Origem/captacao (primeiro toque): o time manda no evento 'visita'
    if (key === 'visita' && !s.origem) {
      const d = ev.dados || {};
      s.origem = d.origem || d.link || d.utm_campaign || d.utm_source || d.ref || null;
    }
    // Tipo de lead: o time manda o 'faturamento' do formulario no evento 'lead'
    if (key === 'lead' && ev.dados && ev.dados.faturamento) s.faturamento = ev.dados.faturamento;
  }

  const lista = Object.values(sessoes);
  const totalSessoes = lista.length;

  // Maior etapa alcançada por sessão (deixa o funil monotônico mesmo se faltar evento)
  for (const s of lista) {
    let max = -1;
    s.keys.forEach((k) => {
      if (indexDe[k] > max) max = indexDe[k];
    });
    s.maxIdx = max;
  }

  // Funil: quantas sessões alcançaram CADA etapa (>=)
  const funil = etapas.map((e, i) => ({
    key: e.key,
    label: e.label,
    sessoes: lista.filter((s) => s.maxIdx >= i).length,
  }));
  const base = funil[0].sessoes || 1;
  funil.forEach((f, i) => {
    f.pct_topo = Math.round((f.sessoes / base) * 1000) / 10; // % do total que abriu
    if (i === 0) {
      f.pct_etapa = 100;
      f.abandonaram = 0;
    } else {
      const ant = funil[i - 1].sessoes || 1;
      f.pct_etapa = Math.round((f.sessoes / ant) * 1000) / 10; // retenção vs etapa anterior
      f.abandonaram = funil[i - 1].sessoes - f.sessoes; // perdidos nesta etapa
    }
  });

  // Onde cada sessão PAROU (maior etapa atingida) — exclui quem gerou o PDF
  const abandono = etapas.map((e) => ({ key: e.key, label: e.label, count: 0 }));
  const idxPdf = indexDe['pdf'];
  for (const s of lista) {
    if (s.maxIdx < 0 || s.maxIdx === idxPdf) continue;
    abandono[s.maxIdx].count++;
  }

  // Distribuição por perfil (entre quem chegou ao resultado)
  const tally = {};
  let comPerfil = 0;
  for (const s of lista) {
    if (s.perfil) {
      tally[s.perfil] = (tally[s.perfil] || 0) + 1;
      comPerfil++;
    }
  }
  const perfis = Object.entries(tally)
    .map(([nome, count]) => ({
      nome,
      emoji: PERFIL_EMOJI[nome] || '•',
      count,
      pct: Math.round((count / (comPerfil || 1)) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count);

  const get = (k) => (funil[indexDe[k]] ? funil[indexDe[k]].sessoes : 0);
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const leads = get('lead');
  const totais = {
    visitas: get('visita'),
    iniciaram: get('iniciou'),
    leads,
    resultados: get('resultado'),
    compras: get('compra'),
    pdfs: get('pdf'),
  };

  // Se tiver Postgres, o card "Leads (formulario)" vem de lp_form.leads
  // (funil_origem = 'QUIZ'). Se falhar, mantem o valor do funil local.
  if (process.env.DATABASE_URL) {
    try {
      totais.leads = await carregarLeads();
    } catch (e) {
      console.error('[analytics] falha ao ler leads do Postgres, usando fallback local:', e.message);
    }
  }

  // --- Pagamento (eventos 'pago'/'reembolso' vindos do webhook do Guru) -------
  // Dedup por id de transacao: o Guru pode reenviar o mesmo evento varias vezes.
  const vistoPago = new Set();
  const vistoReemb = new Set();
  let pix = 0, cartao = 0, boleto = 0, outroPago = 0;
  let fatBruto = 0, fatReemb = 0, reembolsos = 0;
  for (const ev of eventos) {
    const d = ev.dados || {};
    const id = d.id || d.transacao || null;
    if (ev.tipo === 'pago') {
      if (id && vistoPago.has(id)) continue;
      if (id) vistoPago.add(id);
      const m = d.metodo || 'outro';
      fatBruto += Number(d.valor) || 0;
      if (m === 'pix') pix++;
      else if (m === 'cartao') cartao++;
      else if (m === 'boleto') boleto++;
      else outroPago++;
    } else if (ev.tipo === 'reembolso') {
      if (id && vistoReemb.has(id)) continue;
      if (id) vistoReemb.add(id);
      reembolsos++;
      fatReemb += Number(d.valor) || 0;
    }
  }
  const pagosTotalLocal = pix + cartao + boleto + outroPago;
  const pagamentoLocal = {
    conectado: pagosTotalLocal > 0 || reembolsos > 0,
    pix,
    cartao,
    boleto,
    outro: outroPago,
    pagos_total: pagosTotalLocal,
    reembolsos,
    taxa_reembolso: pct(reembolsos, pagosTotalLocal),
    faturamento_bruto: Math.round(fatBruto * 100) / 100,
    faturamento_liquido: Math.round((fatBruto - fatReemb) * 100) / 100,
    ticket: pagosTotalLocal ? Math.round((fatBruto / pagosTotalLocal) * 100) / 100 : 0,
  };

  // Se tiver Postgres configurado, o objeto 'pagamento' vem da tabela
  // financeiro.guru_log_quiz (fonte de verdade). Se falhar, cai no local.
  let pagamento = pagamentoLocal;
  if (process.env.DATABASE_URL) {
    try {
      pagamento = await carregarPagamento();
    } catch (e) {
      console.error('[analytics] falha ao ler pagamento do Postgres, usando fallback local:', e.message);
      pagamento = pagamentoLocal;
    }
  }
  const pagosTotal = pagamento.pagos_total;

  // Regra de negocio: o PDF so e gerado quando ha pagamento confirmado.
  // Entao totais.pdfs = pagamento.pagos_total (mesma coisa vale na etapa 'pdf'
  // do array funil, montada abaixo). Se nao houver pagamento, fica 0.
  const pdfsGerados = pagamento && pagamento.pagos_total ? pagamento.pagos_total : 0;
  totais.pdfs = pdfsGerados;

  // --- Captacao por link/origem (primeiro toque) -----------------------------
  // Origem vem do evento 'visita' (dados.origem / utm_source / utm_campaign / link).
  // Enquanto o time nao enviar, tudo cai em "Sem origem (direto)".
  const idxLead = indexDe['lead'];
  const idxCompra = indexDe['compra'];
  const capMap = {};
  let temOrigem = false;
  for (const s of lista) {
    if (s.origem) temOrigem = true;
    const chave = s.origem || 'Sem origem (direto)';
    const cc = (capMap[chave] = capMap[chave] || { origem: chave, visitas: 0, leads: 0, compras: 0 });
    cc.visitas++;
    if (s.maxIdx >= idxLead) cc.leads++;
    if (s.maxIdx >= idxCompra) cc.compras++;
  }
  const captacao = {
    tem_origem: temOrigem,
    fontes: Object.values(capMap)
      .map((cc) => ({
        ...cc,
        pct: pct(cc.visitas, totalSessoes),
        conv_lead: pct(cc.leads, cc.visitas),
        conv_compra: pct(cc.compras, cc.visitas),
      }))
      .sort((a, b) => b.visitas - a.visitas),
  };

  // --- Qualidade de lead (por faturamento do formulario) ---------------------
  // O CPL (custo por lead) e calculado no dashboard, com o investimento digitado.
  const leadTipoMap = {};
  let temTipoLead = false;
  let leadsClassificados = 0;
  for (const s of lista) {
    if (!s.faturamento) continue;
    temTipoLead = true;
    const b = bucketFaturamento(s.faturamento) || 'Outro';
    leadTipoMap[b] = (leadTipoMap[b] || 0) + 1;
    leadsClassificados++;
  }
  const ORDEM_TIPO = ['Acima de R$12k/mês', 'Abaixo de R$12k/mês', 'Não atua na área', 'Outro'];
  const leads_tipos = {
    classificado: temTipoLead,
    total: leadsClassificados,
    tipos: Object.entries(leadTipoMap)
      .map(([tipo, count]) => ({ tipo, count, pct: pct(count, leadsClassificados) }))
      .sort((a, b) => ORDEM_TIPO.indexOf(a.tipo) - ORDEM_TIPO.indexOf(b.tipo)),
  };

  // --- Bloco funil/sessoes/captacao/abandono vindo de funil_quiz.quiz_sessoes -
  // Substitui total_sessoes, totais.visitas/iniciaram/resultados/compras,
  // captacao e abandono quando o Postgres esta configurado. Nao mexe em
  // totais.leads (esse vem de lp_form.leads via carregarLeads) nem em pagamento.
  let totalSessoesFinal = totalSessoes;
  let captacaoFinal = captacao;
  let abandonoFinal = null; // se null, cai no fallback local no return
  let funilFinal = null;    // idem
  if (process.env.DATABASE_URL) {
    try {
      const fq = await carregarFunilQuiz();
      totalSessoesFinal = fq.total_sessoes;
      totais.visitas = fq.totais.visitas;
      totais.iniciaram = fq.totais.iniciaram;
      totais.resultados = fq.totais.resultados;
      totais.compras = fq.totais.compras;

      // funil: monta o array na mesma forma do local
      // ({ key, label, sessoes, pct_topo, pct_etapa, abandonaram }). O "lead"
      // aqui usa virou_lead da tabela de sessoes (visualizacao de funil), NAO
      // substitui o card oficial de leads (esse vem de lp_form.leads).
      const alcancePergunta = {};
      for (const r of fq.perguntas_alcance) alcancePergunta[r.pergunta] = r.sessoes;
      const funilCru = [
        { key: 'visita',    label: 'Abriu o quiz',         sessoes: fq.totais.visitas },
        { key: 'iniciou',   label: 'Começou a responder',  sessoes: fq.totais.iniciaram },
      ];
      for (let n = 1; n <= 15; n++) {
        funilCru.push({
          key: 'p' + n,
          label: LABEL_PERGUNTA[n],
          sessoes: alcancePergunta[n] || 0,
        });
      }
      funilCru.push({ key: 'captura',   label: 'Chegou no formulário', sessoes: fq.chegaram_form });
      funilCru.push({ key: 'lead',      label: 'Preencheu os dados',   sessoes: fq.viraram_lead });
      funilCru.push({ key: 'resultado', label: 'Viu o diagnóstico',    sessoes: fq.totais.resultados });
      funilCru.push({ key: 'compra',    label: 'Clicou em comprar',    sessoes: fq.totais.compras });
      funilCru.push({ key: 'pdf',       label: 'PDF gerado',           sessoes: pdfsGerados });

      const baseTopo = funilCru[0].sessoes || 1;
      funilFinal = funilCru.map((f, i) => {
        const pct_topo = Math.round((f.sessoes / baseTopo) * 1000) / 10;
        if (i === 0) return { ...f, pct_topo: 100, pct_etapa: 100, abandonaram: 0 };
        const ant = funilCru[i - 1].sessoes || 1;
        return {
          ...f,
          pct_topo,
          pct_etapa: Math.round((f.sessoes / ant) * 1000) / 10,
          abandonaram: Math.max(0, funilCru[i - 1].sessoes - f.sessoes),
        };
      });

      // captacao a partir das origens (utm_source)
      const semOrigemChave = 'Sem origem';
      const totSessoesCap = fq.total_sessoes || 0;
      captacaoFinal = {
        tem_origem: fq.origens.some((o) => o.origem && o.origem !== semOrigemChave),
        fontes: fq.origens
          .map((o) => ({
            origem: o.origem === semOrigemChave ? 'Sem origem (direto)' : o.origem,
            visitas: o.sessoes,
            leads: o.leads,
            compras: o.compras,
            pct: pct(o.sessoes, totSessoesCap),
            conv_lead: pct(o.leads, o.sessoes),
            conv_compra: pct(o.compras, o.sessoes),
          }))
          .sort((a, b) => b.visitas - a.visitas),
      };

      // abandono: por pergunta + no formulario. Labels a partir de LABEL_PERGUNTA.
      const rotuloPergunta = (n) => {
        if (n == null || n === 0) return 'Abriu o quiz';
        if (n >= 1 && n <= 15) return LABEL_PERGUNTA[n] || `P${n}`;
        return `P${n}`;
      };
      abandonoFinal = [];
      for (const r of fq.perguntas_abandono) {
        if (!r.sessoes) continue;
        const n = r.parou_na_pergunta;
        abandonoFinal.push({
          key: n == null || n === 0 ? 'visita' : 'p' + n,
          label: rotuloPergunta(n),
          count: r.sessoes,
        });
      }
      if (fq.abandono_formulario > 0) {
        abandonoFinal.push({
          key: 'captura',
          label: 'Chegou no formulário',
          count: fq.abandono_formulario,
        });
      }
      abandonoFinal.sort((a, b) => b.count - a.count);
    } catch (e) {
      console.error('[analytics] falha ao ler funil do Postgres, usando fallback local:', e.message);
    }
  }

  const conversao = {
    visita_resultado: pct(totais.resultados, totais.visitas),
    resultado_compra: pct(totais.compras, totais.resultados),
    compra_pago: pct(pagosTotal, totais.compras),
    compra_pdf: pct(totais.pdfs, totais.compras),
    geral: pct(totais.pdfs, totais.visitas),
  };

  return {
    gerado_em: Date.now(),
    total_sessoes: totalSessoesFinal,
    totais,
    conversao,
    pagamento,
    captacao: captacaoFinal,
    leads_tipos,
    funil: funilFinal || funil,
    abandono: abandonoFinal || abandono.filter((a) => a.count > 0).sort((a, b) => b.count - a.count),
    perfis,
  };
}

module.exports = { registrar, metricas };
