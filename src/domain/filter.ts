// Filtro de mensajes (FR-001, FR-002). Pendiente de implementar (T022).

export function isAlertText(_text: string): boolean {
  throw new Error('filter: no implementado');
}

export function normalizeSender(_id: string): string {
  throw new Error('filter: no implementado');
}

export function isAuthorized(_sender: string, _authorized: readonly string[]): boolean {
  throw new Error('filter: no implementado');
}
