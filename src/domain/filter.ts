// Filtro de mensajes (FR-001, FR-002). Primero el disparador: la charla del grupo se ignora sin
// dejar rastro; recién después se mira el remitente.

/** Minúsculas y sin tildes: "ALERTA DE TRADÍNG" → "alerta de trading". */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export function isAlertText(text: string): boolean {
  return normalize(text).includes('alerta de trading');
}

/** "5491100000001:1@c.us" → "5491100000001": el mismo remitente desde cualquier dispositivo. */
export function normalizeSender(id: string): string {
  return id.trim().replace(/@.*$/, '').replace(/:\d+$/, '');
}

export function isAuthorized(sender: string, authorized: readonly string[]): boolean {
  const s = normalizeSender(sender);
  return authorized.some((a) => normalizeSender(a) === s);
}
