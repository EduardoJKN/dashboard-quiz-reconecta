// ============================================================================
// leadsOrigem.js — origem dos leads (utm_source) a partir de lp_form.leads.
// Mesma base de leads do bloco UTM: QUIZ + filtro de testes + dedup por email.
// Compras = approved no Guru, associadas por email.
// ============================================================================
const { query } = require('./db');
const {
  sqlFiltroTesteLeads,
  sqlPeriodoLeads,
  sqlJoinEntradaLead,
  sqlFiltroTesteGuru,
} = require('./filtroTesteLeadsSql');

const SQL = `
  WITH leads_raw AS (
    SELECT
      LOWER(TRIM(l.email)) AS email_norm,
      l.session_id,
      COALESCE(l.created_at::timestamp, l."timestamp"::timestamp) AS data_lead,
      COALESCE(NULLIF(TRIM(l.utm_source), ''), 'Sem origem') AS origem
    FROM lp_form.leads l
    WHERE UPPER(TRIM(COALESCE(l.funil_origem, ''))) = 'QUIZ'
      AND NULLIF(TRIM(l.email), '') IS NOT NULL
      ${sqlFiltroTesteLeads('l.')}
      ${sqlPeriodoLeads('l.')}
  ),
  leads_dedup AS (
    SELECT DISTINCT ON (email_norm)
      email_norm, session_id, data_lead, origem
    FROM leads_raw
    ORDER BY email_norm, data_lead DESC NULLS LAST
  ),
  leads_with_entrada AS (
    SELECT ld.*, ent.entrada
    FROM leads_dedup ld
    ${sqlJoinEntradaLead('ld')}
  ),
  leads_base AS (
    SELECT * FROM leads_with_entrada
    WHERE entrada IN ('a', 'b', 'c')
      AND ($3::text IS NULL OR entrada = $3::text)
  ),
  compras_aprovadas AS (
    SELECT DISTINCT LOWER(TRIM(g.customer_email)) AS email_norm
    FROM financeiro.guru_log_quiz g
    WHERE LOWER(TRIM(g.status)) = 'approved'
      ${sqlFiltroTesteGuru('g.', { comNome: true })}
      AND COALESCE(g.guru_confirmed_at, g.guru_created_at, g.received_at) >= $1::date
      AND COALESCE(g.guru_confirmed_at, g.guru_created_at, g.received_at) <  ($2::date + interval '1 day')
  )
  SELECT
    origem,
    COUNT(*)::int AS leads,
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM compras_aprovadas ca
      WHERE ca.email_norm = leads_base.email_norm
    ))::int AS compras_aprovadas
  FROM leads_base
  GROUP BY origem
  ORDER BY leads DESC
`;

async function carregarLeadsOrigem({ inicio, fim, entrada = null } = {}) {
  const { rows } = await query(SQL, [inicio, fim, entrada]);
  return rows.map((r) => ({
    origem: r.origem || 'Sem origem',
    leads: r.leads || 0,
    compras_aprovadas: r.compras_aprovadas || 0,
  }));
}

module.exports = { carregarLeadsOrigem };

