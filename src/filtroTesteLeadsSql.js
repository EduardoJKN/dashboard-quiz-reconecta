// ============================================================================
// filtroTesteLeadsSql.js — clausulas SQL compartilhadas para excluir leads de
// teste/interno em lp_form.leads. Usado por leadsQuiz.js e leadsUtm.js.
//
// Regra (combinada com o time):
//   (a) email / first_name / instagram — filtro amplo por substring
//   (b) UTMs / page_url — filtro cirurgico (nao remove campanhas reais com
//       "Teste" no nome, ex.: "Diagnóstico | Teste | CBO | Purchase...")
//
// p = prefixo de coluna ('' ou 'l.').
// ============================================================================
function sqlFiltroTesteLeads(p = '') {
  return `
      AND COALESCE(${p}email, '')      NOT ILIKE '%test%'
      AND COALESCE(${p}email, '')      NOT ILIKE '%teste%'
      AND COALESCE(${p}email, '')      NOT ILIKE '%jardelkahne%'
      AND COALESCE(${p}email, '')      NOT ILIKE '%reconecta%'
      AND COALESCE(${p}first_name, '') NOT ILIKE '%test%'
      AND COALESCE(${p}first_name, '') NOT ILIKE '%teste%'
      AND COALESCE(${p}first_name, '') NOT ILIKE '%jardelkahne%'
      AND COALESCE(${p}instagram, '')  NOT ILIKE '%test%'
      AND COALESCE(${p}instagram, '')  NOT ILIKE '%teste%'
      AND COALESCE(${p}instagram, '')  NOT ILIKE '%jardelkahne%'
      AND LOWER(TRIM(COALESCE(${p}utm_source, '')))   NOT IN ('test','teste','test_campaign','ad_test_01','test_term')
      AND LOWER(TRIM(COALESCE(${p}utm_medium, '')))   NOT IN ('test','teste','test_campaign','ad_test_01','test_term')
      AND LOWER(TRIM(COALESCE(${p}utm_campaign, ''))) NOT IN ('test','teste','test_campaign','ad_test_01','test_term')
      AND LOWER(TRIM(COALESCE(${p}utm_content, '')))  NOT IN ('test','teste','test_campaign','ad_test_01','test_term')
      AND LOWER(TRIM(COALESCE(${p}utm_term, '')))     NOT IN ('test','teste','test_campaign','ad_test_01','test_term')
      AND COALESCE(${p}utm_source, '')   NOT ILIKE '%jardelkahne%'
      AND COALESCE(${p}utm_medium, '')   NOT ILIKE '%jardelkahne%'
      AND COALESCE(${p}utm_campaign, '') NOT ILIKE '%jardelkahne%'
      AND COALESCE(${p}utm_content, '')  NOT ILIKE '%jardelkahne%'
      AND COALESCE(${p}utm_term, '')     NOT ILIKE '%jardelkahne%'
      AND COALESCE(${p}page_url, '') NOT ILIKE '%test_campaign%'
      AND COALESCE(${p}page_url, '') NOT ILIKE '%ad_test_01%'
      AND COALESCE(${p}page_url, '') NOT ILIKE '%test_term%'
      AND COALESCE(${p}page_url, '') NOT ILIKE '%jardelkahne%'`;
}

// Periodo inclusivo por DATE (evita perder leads do ultimo dia por timezone).
// p = prefixo de coluna ('' ou 'l.').
function sqlPeriodoLeads(p = '') {
  return `
      AND COALESCE(${p}created_at::date, ${p}"timestamp"::date) >= $1::date
      AND COALESCE(${p}created_at::date, ${p}"timestamp"::date) <= $2::date`;
}

// Associa ab_entrada do lead via quiz_sessoes. Preferencia:
//   1) sessoes com ab_entrada valida (a/b/c) apenas
//   2) entre essas, match por session_id antes de email
//   3) evento mais antigo
// Match por session_id nao exige email na sessao; match por email sim.
// lr = alias da CTE de leads (ex.: 'lr').
function sqlJoinEntradaLead(lr = 'lr') {
  return `
    LEFT JOIN LATERAL (
      SELECT LOWER(TRIM(qs.ab_entrada)) AS entrada
      FROM funil_quiz.quiz_sessoes qs
      WHERE LOWER(TRIM(qs.ab_entrada)) IN ('a', 'b', 'c')
        AND (
          (NULLIF(TRIM(${lr}.session_id), '') IS NOT NULL AND qs.session_id = ${lr}.session_id)
          OR (
            NULLIF(TRIM(qs.email), '') IS NOT NULL
            AND LOWER(TRIM(qs.email)) = ${lr}.email_norm
          )
        )
      ORDER BY
        CASE
          WHEN NULLIF(TRIM(${lr}.session_id), '') IS NOT NULL AND qs.session_id = ${lr}.session_id THEN 0
          ELSE 1
        END,
        COALESCE(qs.primeiro_evento, qs.ultimo_evento) ASC NULLS LAST
      LIMIT 1
    ) ent ON true`;
}

module.exports = { sqlFiltroTesteLeads, sqlPeriodoLeads, sqlJoinEntradaLead };
