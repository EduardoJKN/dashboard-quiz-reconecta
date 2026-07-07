// ============================================================================
// leadsUtm.js — leads do QUIZ (lp_form.leads) cruzados com compras approved
// (financeiro.guru_log_quiz). Retorna 3 blocos:
//
//   - resumo:   totais para os cards (total_leads, total_compradores, valor)
//   - por_utm:  agregado por (campaign, content, term, page_url) — max 50
//   - detalhes: linha por email (mais recente no periodo) — max 300
//
// Entrada A/B/C: quiz_sessoes.ab_entrada via session_id (preferencia) ou email.
// Prioriza sessao com ab_entrada valida mesmo se outra match tiver vazio.
//
// PII: retornamos email, first_name e instagram (dashboard interno). NAO
// retornamos telefone, documento, session_id, ss_xcod, request_id, guru_id
// nem raw_payload — nem para o front, nem para logs.
// ============================================================================
const { query } = require('./db');
const { sqlFiltroTesteLeads, sqlPeriodoLeads, sqlJoinEntradaLead } = require('./filtroTesteLeadsSql');

// Parametros: $1 = inicio, $2 = fim, $3 = entrada global ('a'|'b'|'c'|NULL=todas).
const SQL = `
  WITH leads_raw AS (
    SELECT
      LOWER(TRIM(l.email)) AS email_norm,
      l.email,
      l.first_name,
      l.instagram,
      l.session_id,
      COALESCE(l.created_at::timestamp, l."timestamp"::timestamp) AS data_lead,
      COALESCE(NULLIF(TRIM(l.utm_campaign), ''), 'Sem utm_campaign') AS utm_campaign,
      COALESCE(NULLIF(TRIM(l.utm_content),  ''), 'Sem utm_content')  AS utm_content,
      COALESCE(NULLIF(TRIM(l.utm_term),     ''), 'Sem utm_term')     AS utm_term,
      COALESCE(NULLIF(TRIM(l.page_url),     ''), 'Sem page_url')     AS page_url
    FROM lp_form.leads l
    WHERE UPPER(TRIM(COALESCE(l.funil_origem, ''))) = 'QUIZ'
      AND NULLIF(TRIM(l.email), '') IS NOT NULL
      ${sqlFiltroTesteLeads('l.')}
      ${sqlPeriodoLeads('l.')}
  ),
  leads_dedup AS (
    SELECT DISTINCT ON (email_norm)
      email_norm, email, first_name, instagram, session_id, data_lead,
      utm_campaign, utm_content, utm_term, page_url
    FROM leads_raw
    ORDER BY email_norm, data_lead DESC NULLS LAST
  ),
  leads_with_entrada AS (
    SELECT
      ld.*,
      ent.entrada,
      CASE
        WHEN ent.entrada IS NOT NULL THEN NULL
        WHEN NULLIF(TRIM(ld.session_id), '') IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM funil_quiz.quiz_sessoes qs
            WHERE LOWER(TRIM(qs.email)) = ld.email_norm
          ) THEN 'sem_session_id'
        WHEN NULLIF(TRIM(ld.session_id), '') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM funil_quiz.quiz_sessoes qs
            WHERE qs.session_id = ld.session_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM funil_quiz.quiz_sessoes qs
            WHERE LOWER(TRIM(qs.email)) = ld.email_norm
          ) THEN 'session_id_sem_match'
        WHEN EXISTS (
            SELECT 1 FROM funil_quiz.quiz_sessoes qs
            WHERE (
              (NULLIF(TRIM(ld.session_id), '') IS NOT NULL AND qs.session_id = ld.session_id)
              OR LOWER(TRIM(qs.email)) = ld.email_norm
            )
            AND NULLIF(TRIM(qs.ab_entrada), '') IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM funil_quiz.quiz_sessoes qs
            WHERE (
              (NULLIF(TRIM(ld.session_id), '') IS NOT NULL AND qs.session_id = ld.session_id)
              OR LOWER(TRIM(qs.email)) = ld.email_norm
            )
            AND LOWER(TRIM(qs.ab_entrada)) IN ('a', 'b', 'c')
          ) THEN 'ab_entrada_vazio'
        WHEN EXISTS (
            SELECT 1 FROM funil_quiz.quiz_sessoes qs
            WHERE (
              (NULLIF(TRIM(ld.session_id), '') IS NOT NULL AND qs.session_id = ld.session_id)
              OR LOWER(TRIM(qs.email)) = ld.email_norm
            )
            AND NULLIF(TRIM(qs.ab_entrada), '') IS NOT NULL
            AND LOWER(TRIM(qs.ab_entrada)) NOT IN ('a', 'b', 'c')
          )
          AND NOT EXISTS (
            SELECT 1 FROM funil_quiz.quiz_sessoes qs
            WHERE (
              (NULLIF(TRIM(ld.session_id), '') IS NOT NULL AND qs.session_id = ld.session_id)
              OR LOWER(TRIM(qs.email)) = ld.email_norm
            )
            AND LOWER(TRIM(qs.ab_entrada)) IN ('a', 'b', 'c')
          ) THEN 'ab_entrada_fora_abc'
        ELSE 'outro'
      END AS entrada_motivo
    FROM leads_dedup ld
    ${sqlJoinEntradaLead('ld')}
  ),
  leads_base AS (
    SELECT * FROM leads_with_entrada
    WHERE $3::text IS NULL OR entrada = $3::text
  ),
  compras_agg AS (
    SELECT
      LOWER(TRIM(g.customer_email)) AS email_norm,
      SUM(COALESCE(g.total_value, 0))::numeric AS total_value,
      STRING_AGG(DISTINCT NULLIF(TRIM(g.payment_method), ''), ', ') AS payment_method,
      MAX(COALESCE(g.guru_confirmed_at, g.guru_created_at, g.received_at)) AS data_compra
    FROM financeiro.guru_log_quiz g
    WHERE LOWER(TRIM(g.status)) = 'approved'
      AND COALESCE(g.customer_email, '') NOT ILIKE '%teste%'
      AND COALESCE(g.customer_email, '') NOT ILIKE '%reconecta%'
      AND NULLIF(TRIM(g.customer_email), '') IS NOT NULL
      AND COALESCE(g.guru_confirmed_at, g.guru_created_at, g.received_at) >= $1::date
      AND COALESCE(g.guru_confirmed_at, g.guru_created_at, g.received_at) <  ($2::date + interval '1 day')
    GROUP BY LOWER(TRIM(g.customer_email))
  )
  SELECT
    ld.email,
    ld.first_name                       AS nome,
    ld.instagram,
    ld.data_lead,
    ld.utm_campaign,
    ld.utm_content,
    ld.utm_term,
    ld.page_url,
    ld.entrada,
    ld.entrada_motivo,
    (ca.email_norm IS NOT NULL)         AS comprou,
    ca.total_value,
    ca.payment_method,
    ca.data_compra
  FROM leads_base ld
  LEFT JOIN compras_agg ca ON ca.email_norm = ld.email_norm
  ORDER BY comprou DESC, ld.data_lead DESC NULLS LAST
  LIMIT 300
`;

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function normEntrada(v) {
  const s = String(v || '').toLowerCase().trim();
  return (s === 'a' || s === 'b' || s === 'c') ? s : null;
}

async function carregarLeadsUtm({ inicio, fim, entrada = null } = {}) {
  const { rows } = await query(SQL, [inicio, fim, entrada]);

  const detalhes = rows.map((r) => ({
    email: r.email || '',
    nome: r.nome || '',
    instagram: r.instagram || '',
    data_lead: r.data_lead ? new Date(r.data_lead).toISOString() : null,
    entrada: normEntrada(r.entrada),
    utm_campaign: r.utm_campaign || 'Sem utm_campaign',
    utm_content: r.utm_content || 'Sem utm_content',
    utm_term: r.utm_term || 'Sem utm_term',
    page_url: r.page_url || 'Sem page_url',
    comprou: !!r.comprou,
    total_value: r.comprou ? round2(r.total_value) : 0,
    payment_method: r.comprou ? (r.payment_method || '') : '',
    data_compra: r.data_compra ? new Date(r.data_compra).toISOString() : null,
  }));

  const mapa = new Map();
  for (const d of detalhes) {
    const chave = [d.utm_campaign, d.utm_content, d.utm_term, d.page_url].join('|');
    let g = mapa.get(chave);
    if (!g) {
      g = {
        utm_campaign: d.utm_campaign,
        utm_content: d.utm_content,
        utm_term: d.utm_term,
        page_url: d.page_url,
        leads: 0,
        compradores: 0,
        valor_total_aprovado: 0,
      };
      mapa.set(chave, g);
    }
    g.leads += 1;
    if (d.comprou) {
      g.compradores += 1;
      g.valor_total_aprovado = round2(g.valor_total_aprovado + d.total_value);
    }
  }
  const por_utm = [...mapa.values()]
    .sort((a, b) => (b.compradores - a.compradores) || (b.leads - a.leads))
    .slice(0, 50);

  const total_leads = detalhes.length;
  const total_compradores = detalhes.reduce((s, d) => s + (d.comprou ? 1 : 0), 0);
  const valor_total_aprovado = round2(
    detalhes.reduce((s, d) => s + (d.comprou ? d.total_value : 0), 0)
  );

  const por_entrada = { a: 0, b: 0, c: 0, sem: 0 };
  const compradores_por_entrada = { a: 0, b: 0, c: 0, sem: 0 };
  const sem_entrada_motivos = {};
  for (const d of detalhes) {
    const k = d.entrada || 'sem';
    por_entrada[k] = (por_entrada[k] || 0) + 1;
    if (d.comprou) compradores_por_entrada[k] = (compradores_por_entrada[k] || 0) + 1;
  }
  for (const r of rows) {
    if (!normEntrada(r.entrada) && r.entrada_motivo) {
      sem_entrada_motivos[r.entrada_motivo] = (sem_entrada_motivos[r.entrada_motivo] || 0) + 1;
    }
  }

  return {
    resumo: {
      total_leads,
      total_compradores,
      valor_total_aprovado,
      por_entrada,
      compradores_por_entrada,
      sem_entrada_motivos,
    },
    por_utm,
    detalhes,
  };
}

module.exports = { carregarLeadsUtm };
