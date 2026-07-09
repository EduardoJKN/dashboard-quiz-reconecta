// ============================================================================
// filtroTesteLeadsSql.js — clausulas SQL compartilhadas para excluir leads de
// teste/interno em lp_form.leads. Usado por leadsQuiz.js, leadsUtm.js e
// funilQuiz.js (jornada por sessao).
//
// Regra (combinada com o time):
//   (a) email / first_name / instagram — filtro amplo por substring
//   (b) UTMs / page_url — filtro cirurgico (nao remove campanhas reais com
//       "Teste" no nome, ex.: "Diagnóstico | Teste | CBO | Purchase...")
// ============================================================================

function sqlNormIdent(p, col) {
  return `LOWER(REGEXP_REPLACE(COALESCE(${p}${col}, ''), '[^a-z0-9]', '', 'g'))`;
}

function sqlFiltroTesteLeads(p = '') {
  const nEmail = sqlNormIdent(p, 'email');
  const nNome = sqlNormIdent(p, 'first_name');
  const nInsta = sqlNormIdent(p, 'instagram');
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
      AND ${nEmail} NOT LIKE '%jardelkahne%'
      AND ${nEmail} NOT LIKE '%jardelahne%'
      AND ${nNome} NOT LIKE '%jardelkahne%'
      AND ${nNome} NOT LIKE '%jardelahne%'
      AND ${nInsta} NOT LIKE '%jardelkahne%'
      AND ${nInsta} NOT LIKE '%jardelahne%'
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
function sqlPeriodoLeads(p = '') {
  return `
      AND COALESCE(${p}created_at::date, ${p}"timestamp"::date) >= $1::date
      AND COALESCE(${p}created_at::date, ${p}"timestamp"::date) <= $2::date`;
}

// Associa ab_entrada do lead via quiz_sessoes (bloco UTM/origem).
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

// Leads oficiais do QUIZ no periodo (dedup por email) — UTM/origem/card leads.
function sqlCteLeadsValidos() {
  return `
  leads_validos AS (
    SELECT DISTINCT ON (LOWER(TRIM(l.email)))
      LOWER(TRIM(l.email)) AS email_norm,
      l.session_id,
      COALESCE(l.created_at::timestamp, l."timestamp"::timestamp) AS lead_ts
    FROM lp_form.leads l
    WHERE UPPER(TRIM(COALESCE(l.funil_origem, ''))) = 'QUIZ'
      AND NULLIF(TRIM(l.email), '') IS NOT NULL
      ${sqlFiltroTesteLeads('l.')}
      ${sqlPeriodoLeads('l.')}
    ORDER BY LOWER(TRIM(l.email)),
      COALESCE(l.created_at::timestamp, l."timestamp"::timestamp) DESC NULLS LAST
  )`;
}

// Jornada por session_id a partir de quiz_eventos (fonte das etapas P1→P15).
// data_ref: data do lead se houver lead associado; senao ultimo_evento.
// Parametros: $1=inicio, $2=fim.
function sqlCteJornadaSessao() {
  return `
  leads_jornada AS (
    SELECT DISTINCT ON (LOWER(TRIM(l.email)))
      LOWER(TRIM(l.email)) AS email_norm,
      NULLIF(TRIM(l.session_id), '') AS session_id,
      COALESCE(l.created_at::timestamp, l."timestamp"::timestamp) AS lead_ts
    FROM lp_form.leads l
    WHERE UPPER(TRIM(COALESCE(l.funil_origem, ''))) = 'QUIZ'
      AND NULLIF(TRIM(l.email), '') IS NOT NULL
      ${sqlFiltroTesteLeads('l.')}
      AND COALESCE(l.created_at::date, l."timestamp"::date) >= $1::date
      AND COALESCE(l.created_at::date, l."timestamp"::date) <= $2::date
    ORDER BY LOWER(TRIM(l.email)),
      COALESCE(l.created_at::timestamp, l."timestamp"::timestamp) DESC NULLS LAST
  ),
  lead_session_ids AS (
    SELECT DISTINCT session_id
    FROM leads_jornada
    WHERE session_id IS NOT NULL
  ),
  jornada_eventos AS (
    SELECT
      e.session_id,
      MIN(e.criado_em) AS primeiro_evento,
      MAX(e.criado_em) AS ultimo_evento,
      BOOL_OR(LOWER(TRIM(e.event)) = 'visita') AS visitou,
      BOOL_OR(LOWER(TRIM(e.event)) = 'iniciou') AS iniciou_evento,
      BOOL_OR(LOWER(TRIM(e.event)) = 'passo') AS teve_passo,
      MAX(e.passo) FILTER (WHERE LOWER(TRIM(e.event)) = 'passo') AS max_passo_evento,
      BOOL_OR(LOWER(TRIM(e.event)) IN ('captura', 'lead')) AS evento_form,
      BOOL_OR(LOWER(TRIM(e.event)) = 'lead') AS evento_lead,
      BOOL_OR(LOWER(TRIM(e.event)) = 'resultado') AS evento_resultado,
      BOOL_OR(LOWER(TRIM(e.event)) = 'compra') AS clicou_comprar_evento,
      BOOL_OR(
        LOWER(TRIM(e.event)) IN (
          'iniciou', 'passo', 'captura', 'lead', 'resultado',
          'compra', 'intersticio', 'compromisso', 'oferta_view'
        )
      ) AS entrou_quiz,
      (
        ARRAY_AGG(LOWER(TRIM(e.ab_entrada)) ORDER BY e.criado_em ASC)
          FILTER (WHERE LOWER(TRIM(e.ab_entrada)) IN ('a', 'b', 'c'))
      )[1] AS entrada_eventos
    FROM funil_quiz.quiz_eventos e
    WHERE NULLIF(TRIM(e.session_id), '') IS NOT NULL
      AND (
        (
          e.criado_em >= $1::date
          AND e.criado_em < ($2::date + interval '1 day')
        )
        OR e.session_id IN (SELECT session_id FROM lead_session_ids)
      )
    GROUP BY e.session_id
  ),
  jornada_base AS (
    SELECT
      je.session_id,
      je.primeiro_evento,
      je.ultimo_evento,
      je.visitou,
      je.iniciou_evento,
      je.teve_passo,
      je.evento_form,
      je.evento_lead,
      je.evento_resultado,
      je.clicou_comprar_evento,
      je.entrou_quiz,
      je.entrada_eventos,
      GREATEST(
        COALESCE(je.max_passo_evento, 0),
        COALESCE(qs.max_pergunta, 0)
      ) AS max_passo,
      COALESCE(je.iniciou_evento, FALSE)
        OR COALESCE(qs.iniciou, FALSE)
        OR COALESCE(je.max_passo_evento, 0) >= 1
        OR COALESCE(qs.max_pergunta, 0) >= 1 AS iniciou,
      COALESCE(je.evento_form, FALSE)
        OR COALESCE(qs.chegou_formulario, FALSE)
        OR COALESCE(qs.virou_lead, FALSE) AS chegou_formulario,
      COALESCE(je.clicou_comprar_evento, FALSE)
        OR COALESCE(qs.clicou_comprar, FALSE) AS clicou_comprar,
      qs.perfil,
      CASE
        WHEN je.entrada_eventos IN ('a', 'b', 'c') THEN je.entrada_eventos
        WHEN LOWER(TRIM(qs.ab_entrada)) IN ('a', 'b', 'c') THEN LOWER(TRIM(qs.ab_entrada))
        ELSE NULL
      END AS entrada_resolvida,
      lv.email_norm AS lead_email_norm,
      lv.lead_ts,
      (lv.email_norm IS NOT NULL) AS tem_lead,
      CASE
        WHEN lv.lead_ts IS NOT NULL THEN lv.lead_ts::date
        ELSE je.ultimo_evento::date
      END AS data_ref
    FROM jornada_eventos je
    LEFT JOIN funil_quiz.quiz_sessoes qs ON qs.session_id = je.session_id
    LEFT JOIN LATERAL (
      SELECT lj.email_norm, lj.lead_ts
      FROM leads_jornada lj
      WHERE (
        lj.session_id IS NOT NULL AND lj.session_id = je.session_id
      ) OR (
        NULLIF(TRIM(qs.email), '') IS NOT NULL
        AND LOWER(TRIM(qs.email)) = lj.email_norm
      )
      ORDER BY
        CASE
          WHEN lj.session_id IS NOT NULL AND lj.session_id = je.session_id THEN 0
          ELSE 1
        END,
        lj.lead_ts DESC NULLS LAST
      LIMIT 1
    ) lv ON TRUE
    WHERE (
      NULLIF(TRIM(qs.email), '') IS NULL
      OR (
        COALESCE(qs.email, '') NOT ILIKE '%teste%'
        AND COALESCE(qs.email, '') NOT ILIKE '%reconecta%'
        AND COALESCE(qs.email, '') NOT ILIKE '%test%'
      )
    )
  ),
  sessoes_enriquecidas AS (
    SELECT *
    FROM jornada_base
    WHERE data_ref >= $1::date
      AND data_ref <= $2::date
      AND (
        visitou
        OR entrou_quiz
        OR iniciou
        OR max_passo > 0
        OR tem_lead
      )
  )`;
}

// Compat: nome antigo usado por funilQuiz — agora aponta para jornada por eventos.
function sqlCteSessoesEnriquecidas() {
  return sqlCteJornadaSessao();
}

module.exports = {
  sqlFiltroTesteLeads,
  sqlPeriodoLeads,
  sqlJoinEntradaLead,
  sqlCteLeadsValidos,
  sqlCteSessoesEnriquecidas,
  sqlCteJornadaSessao,
};
