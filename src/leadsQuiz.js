// ============================================================================
// leadsQuiz.js — conta leads do formulario do quiz em lp_form.leads.
// Usa a mesma base deduplicada do bloco UTM (carregarLeadsUtm) para garantir
// consistencia com "Total de leads" e cards do dashboard.
// ============================================================================
const { carregarLeadsUtm } = require('./leadsUtm');

async function carregarLeads({ inicio, fim, entrada = null } = {}) {
  const { resumo } = await carregarLeadsUtm({ inicio, fim, entrada });
  return resumo.total_leads || 0;
}

module.exports = { carregarLeads };
