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

module.exports = { sqlFiltroTesteLeads };
