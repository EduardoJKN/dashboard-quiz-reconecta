// ============================================================================
// periodo.js — normaliza { inicio, fim } vindos da query string.
// Formato esperado: YYYY-MM-DD. Se ausente ou invalido, cai no padrao:
//   inicio = primeiro dia do mes atual
//   fim    = data de hoje
// Nunca lanca. Nao imprime nada sensivel.
// ============================================================================

function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }

function normalizarPeriodo(query = {}) {
  const now = new Date();
  const inicioDefault = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  const fimDefault = ymd(now);
  const inicio = isYmd(query.inicio) ? query.inicio : inicioDefault;
  const fim = isYmd(query.fim) ? query.fim : fimDefault;
  // Se datas trocadas, cai no default (mais seguro do que trocar silenciosamente)
  if (new Date(fim) < new Date(inicio)) {
    return { inicio: inicioDefault, fim: fimDefault };
  }
  return { inicio, fim };
}

// entrada = null (todas) | 'a' | 'b' | 'c'
function normalizarEntrada(v) {
  const s = String(v == null ? '' : v).toLowerCase().trim();
  if (s === 'a' || s === 'b' || s === 'c') return s;
  return null;
}

function normalizarFiltros(query = {}) {
  return {
    ...normalizarPeriodo(query),
    entrada: normalizarEntrada(query.entrada),
  };
}

module.exports = { normalizarPeriodo, normalizarEntrada, normalizarFiltros };
