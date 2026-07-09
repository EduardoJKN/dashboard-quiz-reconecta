// ============================================================================
// filtroTesteLeadsSql.js — helpers SQL compartilhados para excluir testes/
// internos e montar a base do funil.
//
// Identificacao (email, nome, instagram, customer_*): filtro AMPLO
//   test | teste | reconecta | jardelkahne | jardelahne
//
// UTMs / page_url: filtro CIRURGICO (nao exclui campanha real com "Teste")
//   test_campaign | ad_test_01 | test_term | jardel*
//
// Funil: so conta sessao com ab_entrada IN ('a','b','c').
// ============================================================================

function sqlNormIdent(p, col) {
  return `LOWER(REGEXP_REPLACE(COALESCE(${p}${col}, ''), '[^a-z0-9]', '', 'g'))`;
}

// Tokens de teste/interno em campo normalizado (sem espacos/pontos).
// '%test%' ja cobre 'teste'; mantemos os demais explicitos.
function sqlBloqueioNorm(nExpr) {
  return `
      AND ${nExpr} NOT LIKE '%test%'
      AND ${nExpr} NOT LIKE '%reconecta%'
      AND ${nExpr} NOT LIKE '%jardelkahne%'
      AND ${nExpr} NOT LIKE '%jardelahne%'`;
}

function sqlBloqueioRaw(rawExpr) {
  return `
      AND ${rawExpr} NOT ILIKE '%test%'
      AND ${rawExpr} NOT ILIKE '%teste%'
      AND ${rawExpr} NOT ILIKE '%reconecta%'
      AND ${rawExpr} NOT ILIKE '%jardelkahne%'
      AND ${rawExpr} NOT ILIKE '%jardelahne%'`;
}

// Email preenchido: aplica filtro amplo. Email vazio: permite (sessao anonima).
function sqlFiltroEmailOpcional(p = '', col = 'email') {
  const raw = `COALESCE(${p}${col}, '')`;
  const n = sqlNormIdent(p, col);
  return `
      AND (
        NULLIF(TRIM(${p}${col}), '') IS NULL
        OR (
          TRUE
          ${sqlBloqueioRaw(raw)}
          ${sqlBloqueioNorm(n)}
        )
      )`;
}

// Email obrigatorio (leads / guru): sempre aplica filtro amplo.
function sqlFiltroEmailObrigatorio(p = '', col = 'email') {
  const raw = `COALESCE(${p}${col}, '')`;
  const n = sqlNormIdent(p, col);
  return `
      AND NULLIF(TRIM(${p}${col}), '') IS NOT NULL
      ${sqlBloqueioRaw(raw)}
      ${sqlBloqueioNorm(n)}`;
}

function sqlFiltroNomeIdent(p = '', col = 'first_name') {
  const raw = `COALESCE(${p}${col}, '')`;
  const n = sqlNormIdent(p, col);
  return `
      ${sqlBloqueioRaw(raw)}
      ${sqlBloqueioNorm(n)}`;
}

function sqlFiltroIdentCampo(expr) {
  const n = `LOWER(REGEXP_REPLACE(COALESCE(${expr}, ''), '[^a-z0-9]', '', 'g'))`;
  return sqlBloqueioNorm(n);
}

// UTMs / page_url — cirurgico (nao corta campanha real com "Teste" no nome).
function sqlFiltroUtmCirurgico(p = '') {
  return `
      AND LOWER(TRIM(COALESCE(${p}utm_source, '')))   NOT IN ('test','teste','test_campaign','ad_test_01','test_term')
      AND LOWER(TRIM(COALESCE(${p}utm_medium, '')))   NOT IN ('test','teste','test_campaign','ad_test_01','test_term')
      AND LOWER(TRIM(COALESCE(${p}utm_campaign, ''))) NOT IN ('test','teste','test_campaign','ad_test_01','test_term')
      AND LOWER(TRIM(COALESCE(${p}utm_content, '')))  NOT IN ('test','teste','test_campaign','ad_test_01','test_term')
      AND LOWER(TRIM(COALESCE(${p}utm_term, '')))     NOT IN ('test','teste','test_campaign','ad_test_01','test_term')
      AND COALESCE(${p}utm_source, '')   NOT ILIKE '%jardelkahne%'
      AND COALESCE(${p}utm_source, '')   NOT ILIKE '%jardelahne%'
      AND COALESCE(${p}utm_medium, '')   NOT ILIKE '%jardelkahne%'
      AND COALESCE(${p}utm_medium, '')   NOT ILIKE '%jardelahne%'
      AND COALESCE(${p}utm_campaign, '') NOT ILIKE '%jardelkahne%'
      AND COALESCE(${p}utm_campaign, '') NOT ILIKE '%jardelahne%'
      AND COALESCE(${p}utm_content, '')  NOT ILIKE '%jardelkahne%'
      AND COALESCE(${p}utm_content, '')  NOT ILIKE '%jardelahne%'
      AND COALESCE(${p}utm_term, '')     NOT ILIKE '%jardelkahne%'
      AND COALESCE(${p}utm_term, '')     NOT ILIKE '%jardelahne%'
      AND COALESCE(${p}page_url, '') NOT ILIKE '%test_campaign%'
      AND COALESCE(${p}page_url, '') NOT ILIKE '%ad_test_01%'
      AND COALESCE(${p}page_url, '') NOT ILIKE '%test_term%'
      AND COALESCE(${p}page_url, '') NOT ILIKE '%jardelkahne%'
      AND COALESCE(${p}page_url, '') NOT ILIKE '%jardelahne%'`;
}

// Filtro completo para lp_form.leads.
function sqlFiltroTesteLeads(p = '') {
  return `
      ${sqlFiltroEmailObrigatorio(p, 'email')}
      ${sqlFiltroNomeIdent(p, 'first_name')}
      ${sqlFiltroNomeIdent(p, 'instagram')}
      ${sqlFiltroUtmCirurgico(p)}`;
}

// Filtro para guru customer_email (+ customer_name se existir na query).
function sqlFiltroTesteGuru(p = '', { comNome = false } = {}) {
  let sql = sqlFiltroEmailObrigatorio(p, 'customer_email');
  if (comNome) sql += sqlFiltroNomeIdent(p, 'customer_name');
  return sql;
}

function sqlPeriodoLeads(p = '') {
  return `
      AND COALESCE(${p}created_at::date, ${p}"timestamp"::date) >= $1::date
      AND COALESCE(${p}created_at::date, ${p}"timestamp"::date) <= $2::date`;
}

// Resolve entrada a/b/c do lead: quiz_sessoes (session_id > email), depois eventos.
// So casa com sessoes cujo email (se preenchido) nao e teste.
function sqlJoinEntradaLead(lr = 'lr') {
  return `
    LEFT JOIN LATERAL (
      SELECT x.entrada
      FROM (
        SELECT
          LOWER(TRIM(qs.ab_entrada)) AS entrada,
          0 AS prio,
          CASE
            WHEN NULLIF(TRIM(${lr}.session_id), '') IS NOT NULL AND qs.session_id = ${lr}.session_id THEN 0
            ELSE 1
          END AS match_prio,
          COALESCE(qs.primeiro_evento, qs.ultimo_evento) AS ts
        FROM funil_quiz.quiz_sessoes qs
        WHERE LOWER(TRIM(qs.ab_entrada)) IN ('a', 'b', 'c')
          ${sqlFiltroEmailOpcional('qs.', 'email')}
          AND (
            (NULLIF(TRIM(${lr}.session_id), '') IS NOT NULL AND qs.session_id = ${lr}.session_id)
            OR (
              NULLIF(TRIM(qs.email), '') IS NOT NULL
              AND LOWER(TRIM(qs.email)) = ${lr}.email_norm
            )
          )
        UNION ALL
        SELECT
          LOWER(TRIM(e.ab_entrada)) AS entrada,
          1 AS prio,
          0 AS match_prio,
          e.criado_em AS ts
        FROM funil_quiz.quiz_eventos e
        WHERE NULLIF(TRIM(${lr}.session_id), '') IS NOT NULL
          AND e.session_id = ${lr}.session_id
          AND LOWER(TRIM(e.ab_entrada)) IN ('a', 'b', 'c')
      ) x
      ORDER BY x.prio, x.match_prio, x.ts ASC NULLS LAST
      LIMIT 1
    ) ent ON true`;
}

function sqlCteLeadsValidos() {
  return `
  leads_validos AS (
    SELECT DISTINCT ON (LOWER(TRIM(l.email)))
      LOWER(TRIM(l.email)) AS email_norm,
      l.session_id,
      COALESCE(l.created_at::timestamp, l."timestamp"::timestamp) AS lead_ts
    FROM lp_form.leads l
    WHERE UPPER(TRIM(COALESCE(l.funil_origem, ''))) = 'QUIZ'
      ${sqlFiltroTesteLeads('l.')}
      ${sqlPeriodoLeads('l.')}
    ORDER BY LOWER(TRIM(l.email)),
      COALESCE(l.created_at::timestamp, l."timestamp"::timestamp) DESC NULLS LAST
  )`;
}

// Base oficial do funil: quiz_sessoes com ab_entrada obrigatoria a/b/c.
// email_resolvido = COALESCE(qs.email, lead.email) — diagnostico/perfil
// nao dependem so de qs.email (pode estar vazio com lead associado).
// Parametros: $1=inicio, $2=fim.
function sqlCteSessoesFunil() {
  return `
  leads_teste_sid AS (
    SELECT DISTINCT NULLIF(TRIM(l.session_id), '') AS session_id
    FROM lp_form.leads l
    WHERE UPPER(TRIM(COALESCE(l.funil_origem, ''))) = 'QUIZ'
      AND NULLIF(TRIM(l.session_id), '') IS NOT NULL
      AND COALESCE(l.created_at::date, l."timestamp"::date) >= ($1::date - interval '7 days')
      AND COALESCE(l.created_at::date, l."timestamp"::date) <= $2::date
      AND (
        LOWER(REGEXP_REPLACE(COALESCE(l.email, ''), '[^a-z0-9]', '', 'g')) LIKE '%test%'
        OR LOWER(REGEXP_REPLACE(COALESCE(l.email, ''), '[^a-z0-9]', '', 'g')) LIKE '%reconecta%'
        OR LOWER(REGEXP_REPLACE(COALESCE(l.email, ''), '[^a-z0-9]', '', 'g')) LIKE '%jardelkahne%'
        OR LOWER(REGEXP_REPLACE(COALESCE(l.email, ''), '[^a-z0-9]', '', 'g')) LIKE '%jardelahne%'
        OR LOWER(REGEXP_REPLACE(COALESCE(l.first_name, ''), '[^a-z0-9]', '', 'g')) LIKE '%test%'
        OR LOWER(REGEXP_REPLACE(COALESCE(l.first_name, ''), '[^a-z0-9]', '', 'g')) LIKE '%reconecta%'
        OR LOWER(REGEXP_REPLACE(COALESCE(l.first_name, ''), '[^a-z0-9]', '', 'g')) LIKE '%jardelkahne%'
        OR LOWER(REGEXP_REPLACE(COALESCE(l.first_name, ''), '[^a-z0-9]', '', 'g')) LIKE '%jardelahne%'
        OR LOWER(REGEXP_REPLACE(COALESCE(l.instagram, ''), '[^a-z0-9]', '', 'g')) LIKE '%test%'
        OR LOWER(REGEXP_REPLACE(COALESCE(l.instagram, ''), '[^a-z0-9]', '', 'g')) LIKE '%reconecta%'
        OR LOWER(REGEXP_REPLACE(COALESCE(l.instagram, ''), '[^a-z0-9]', '', 'g')) LIKE '%jardelkahne%'
        OR LOWER(REGEXP_REPLACE(COALESCE(l.instagram, ''), '[^a-z0-9]', '', 'g')) LIKE '%jardelahne%'
      )
  ),
  leads_validos_periodo AS (
    SELECT DISTINCT ON (LOWER(TRIM(l.email)))
      LOWER(TRIM(l.email)) AS email_norm,
      NULLIF(TRIM(l.session_id), '') AS session_id
    FROM lp_form.leads l
    WHERE UPPER(TRIM(COALESCE(l.funil_origem, ''))) = 'QUIZ'
      ${sqlFiltroTesteLeads('l.')}
      AND COALESCE(l.created_at::date, l."timestamp"::date) >= ($1::date - interval '7 days')
      AND COALESCE(l.created_at::date, l."timestamp"::date) <= $2::date
    ORDER BY LOWER(TRIM(l.email)),
      COALESCE(l.created_at::timestamp, l."timestamp"::timestamp) DESC NULLS LAST
  ),
  leads_por_sid AS (
    SELECT DISTINCT ON (session_id)
      session_id,
      email_norm
    FROM leads_validos_periodo
    WHERE session_id IS NOT NULL
    ORDER BY session_id, email_norm
  ),
  sessoes_enriquecidas AS (
    SELECT
      qs.session_id,
      qs.iniciou,
      qs.chegou_formulario,
      qs.virou_lead,
      qs.clicou_comprar,
      qs.max_pergunta,
      qs.perfil,
      qs.email,
      qs.primeiro_evento,
      qs.ultimo_evento,
      LOWER(TRIM(qs.ab_entrada)) AS entrada_resolvida,
      COALESCE(
        NULLIF(TRIM(qs.email), ''),
        lps.email_norm,
        lve.email_norm
      ) AS email_resolvido,
      (lps.email_norm IS NOT NULL OR lve.email_norm IS NOT NULL OR COALESCE(qs.virou_lead, FALSE)) AS tem_lead,
      COALESCE(qs.primeiro_evento, qs.ultimo_evento)::date AS data_ref
    FROM funil_quiz.quiz_sessoes qs
    LEFT JOIN leads_por_sid lps ON lps.session_id = qs.session_id
    LEFT JOIN leads_validos_periodo lve
      ON NULLIF(TRIM(qs.email), '') IS NOT NULL
      AND lve.email_norm = LOWER(TRIM(qs.email))
    WHERE LOWER(TRIM(qs.ab_entrada)) IN ('a', 'b', 'c')
      ${sqlFiltroEmailOpcional('qs.', 'email')}
      AND NOT EXISTS (
        SELECT 1 FROM leads_teste_sid lt
        WHERE lt.session_id = qs.session_id
      )
      AND COALESCE(qs.primeiro_evento, qs.ultimo_evento) >= $1::date
      AND COALESCE(qs.primeiro_evento, qs.ultimo_evento) < ($2::date + interval '1 day')
  )`;
}

function sqlCteSessoesEnriquecidas() {
  return sqlCteSessoesFunil();
}

function sqlCteJornadaSessao() {
  return sqlCteSessoesFunil();
}

module.exports = {
  sqlNormIdent,
  sqlFiltroIdentCampo,
  sqlFiltroEmailOpcional,
  sqlFiltroEmailObrigatorio,
  sqlFiltroNomeIdent,
  sqlFiltroUtmCirurgico,
  sqlFiltroTesteLeads,
  sqlFiltroTesteGuru,
  sqlPeriodoLeads,
  sqlJoinEntradaLead,
  sqlCteLeadsValidos,
  sqlCteSessoesEnriquecidas,
  sqlCteSessoesFunil,
  sqlCteJornadaSessao,
};
