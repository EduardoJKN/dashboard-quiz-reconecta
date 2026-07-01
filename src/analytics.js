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
function metricas() {
  const eventos = lerEventos();
  const etapas = etapasFunil();
  const indexDe = {};
  etapas.forEach((e, i) => (indexDe[e.key] = i));

  // Agrupa por sessão: quais etapas alcançou + qual perfil recebeu
  const sessoes = {};
  for (const ev of eventos) {
    const key = tipoParaKey(ev);
    if (indexDe[key] == null) continue; // ignora tipos fora do funil (ex.: pago, reembolso)
    const s = (sessoes[ev.sessao] = sessoes[ev.sessao] || { keys: new Set(), perfil: null });
    s.keys.add(key);
    if (key === 'resultado' && ev.dados && ev.dados.perfil) s.perfil = ev.dados.perfil;
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
  const pagosTotal = pix + cartao + boleto + outroPago;
  const pagamento = {
    conectado: pagosTotal > 0 || reembolsos > 0,
    pix,
    cartao,
    boleto,
    outro: outroPago,
    pagos_total: pagosTotal,
    reembolsos,
    taxa_reembolso: pct(reembolsos, pagosTotal),
    faturamento_bruto: Math.round(fatBruto * 100) / 100,
    faturamento_liquido: Math.round((fatBruto - fatReemb) * 100) / 100,
    ticket: pagosTotal ? Math.round((fatBruto / pagosTotal) * 100) / 100 : 0,
  };

  const conversao = {
    visita_resultado: pct(totais.resultados, totais.visitas),
    resultado_compra: pct(totais.compras, totais.resultados),
    compra_pago: pct(pagosTotal, totais.compras),
    compra_pdf: pct(totais.pdfs, totais.compras),
    geral: pct(totais.pdfs, totais.visitas),
  };

  return {
    gerado_em: Date.now(),
    total_sessoes: totalSessoes,
    totais,
    conversao,
    pagamento,
    funil,
    abandono: abandono.filter((a) => a.count > 0).sort((a, b) => b.count - a.count),
    perfis,
  };
}

module.exports = { registrar, metricas };
