export function notice(message: string) { window.dispatchEvent(new CustomEvent('music:notice',{detail:message})); }
