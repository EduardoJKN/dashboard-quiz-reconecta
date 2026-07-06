// ============================================================================
// pagamentoGuru.js — le financeiro.guru_log_quiz e monta o objeto 'pagamento'
// do dashboard. Somente leitura. Nao cria tabela nem escreve nada.
//
// Regras (combinadas com o time):
//   - pago       -> status em { approved, paid, completed, complete, pago, aprovado }
//   - reembolso  -> status contem { refund, refunded, reembolso, reimbursed,
//                                   chargeback, estorno }
//   - dedup pagamentos por guru_id -> request_id -> id
//   - dedup reembolsos separadamente, mesma cascata
//   - metodo: pix / cartao / boleto / outro (inclui 'free')
// ============================================================================
const { query } = require('./db');

const STATUS_PAGOS = new Set([
  'approved',
  'paid',
  'completed',
  'complete',
  'pago',
  'aprovado',
]);

const REGEX_REEMBOLSO = /(refund|refunded|reembolso|reimbursed|chargeback|estorno)/i;

// Regra global de exclusao de testes/internos + filtro de periodo por
// COALESCE(guru_confirmed_at, guru_created_at, received_at). Parametros:
// $1 = inicio, $2 = fim, $3 = entrada opcional ('a'|'b'|'c'|NULL). Quando
// entrada setada, casa customer_email com funil_quiz.quiz_sessoes.email.
const SQL = `
  SELECT
    id,
    guru_id::text AS guru_id,
    request_id,
    status,
    total_value,
    currency,
    payment_method,
    guru_created_at,
    guru_confirmed_at,
    received_at
  FROM financeiro.guru_log_quiz
  WHERE COALESCE(customer_email, '') NOT ILIKE '%teste%'
    AND COALESCE(customer_email, '') NOT ILIKE '%reconecta%'
    AND COALESCE(guru_confirmed_at, guru_created_at, received_at) >= $1::date
    AND COALESCE(guru_confirmed_at, guru_created_at, received_at) <  ($2::date + interval '1 day')
    AND (
      $3::text IS NULL
      OR EXISTS (
        SELECT 1
        FROM funil_quiz.quiz_sessoes qs
        WHERE LOWER(TRIM(qs.ab_entrada)) = $3::text
          AND NULLIF(TRIM(qs.email), '') IS NOT NULL
          AND COALESCE(qs.email, '') NOT ILIKE '%teste%'
          AND COALESCE(qs.email, '') NOT ILIKE '%reconecta%'
          AND LOWER(TRIM(qs.email)) = LOWER(TRIM(financeiro.guru_log_quiz.customer_email))
      )
    )
  ORDER BY COALESCE(guru_confirmed_at, guru_created_at, received_at) ASC
`;

function chaveDedup(row) {
  if (row.guru_id) return 'g:' + row.guru_id;
  if (row.request_id) return 'r:' + row.request_id;
  if (row.id != null) return 'i:' + row.id;
  return null;
}

function classificarMetodo(pm) {
  const m = String(pm || '').toLowerCase();
  if (m.includes('pix')) return 'pix';
  if (m.includes('credit_card') || m.includes('cartao') || m.includes('cartão') || m.includes('card')) return 'cartao';
  if (m.includes('boleto')) return 'boleto';
  return 'outro';
}

function pct(a, b) {
  return b ? Math.round((a / b) * 1000) / 10 : 0;
}

async function carregarPagamento({ inicio, fim, entrada = null } = {}) {
  const { rows } = await query(SQL, [inicio, fim, entrada]);

  const vistoPago = new Set();
  const vistoReemb = new Set();
  const vistoWaiting = new Set();
  let pix = 0, cartao = 0, boleto = 0, outro = 0;
  let fatBruto = 0, fatReemb = 0, reembolsos = 0;
  let esperando_pagamento = 0;

  for (const row of rows) {
    const status = String(row.status || '').toLowerCase().trim();
    const valor = Number(row.total_value) || 0;
    const chave = chaveDedup(row);

    const isReemb = REGEX_REEMBOLSO.test(status);
    const isPago = STATUS_PAGOS.has(status);
    const isWaiting = status === 'waiting_payment';

    if (isReemb) {
      if (chave && vistoReemb.has(chave)) continue;
      if (chave) vistoReemb.add(chave);
      reembolsos++;
      fatReemb += valor;
      continue;
    }

    if (isPago) {
      if (chave && vistoPago.has(chave)) continue;
      if (chave) vistoPago.add(chave);
      const m = classificarMetodo(row.payment_method);
      if (m === 'pix') pix++;
      else if (m === 'cartao') cartao++;
      else if (m === 'boleto') boleto++;
      else outro++;
      fatBruto += valor;
      continue;
    }

    if (isWaiting) {
      if (chave && vistoWaiting.has(chave)) continue;
      if (chave) vistoWaiting.add(chave);
      esperando_pagamento++;
    }
  }

  const pagos_total = pix + cartao + boleto + outro;
  return {
    conectado: true,
    pix,
    cartao,
    boleto,
    outro,
    pagos_total,
    esperando_pagamento,
    reembolsos,
    taxa_reembolso: pct(reembolsos, pagos_total),
    faturamento_bruto: Math.round(fatBruto * 100) / 100,
    faturamento_liquido: Math.round((fatBruto - fatReemb) * 100) / 100,
    ticket: pagos_total ? Math.round((fatBruto / pagos_total) * 100) / 100 : 0,
  };
}

module.exports = { carregarPagamento };
