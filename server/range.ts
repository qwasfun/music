export function parseRange(header: string | null, size: number): { offset: number; length: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw new Error('INVALID_RANGE');
  let start: number, end: number;
  if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new Error('INVALID_RANGE'); start = Math.max(0,size-suffix); end=size-1; }
  else { start=Number(match[1]); end=match[2] ? Math.min(Number(match[2]),size-1) : size-1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start<0 || start>=size || end<start) throw new Error('INVALID_RANGE');
  return { offset:start, length:end-start+1 };
}
