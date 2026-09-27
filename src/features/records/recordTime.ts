function wallParts(utcMs: number, zone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(utcMs));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute') };
}

export function wallTime(utcMs: number, zone: string) {
  const p = wallParts(utcMs, zone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

function offsetMinutes(utcMs: number, zone: string) {
  const p = wallParts(utcMs, zone);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - utcMs) / 60_000);
}

export function utcOffsetLabel(utcMs: number, zone: string) {
  const offset = offsetMinutes(utcMs, zone);
  const sign = offset < 0 ? '−' : '+';
  return `UTC${sign}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`;
}

// A local clock reading can have zero, one or two matching instants at a DST change.
export function matchingInstants(value: string, zone: string): number[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return [];
  const [, y, mo, d, h, mi] = match.map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 16) !== value) return [];
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) offsets.add(offsetMinutes(naive + hours * 3_600_000, zone));
  return [...offsets].map((offset) => naive - offset * 60_000)
    .filter((instant) => wallTime(instant, zone) === value)
    .sort((a, b) => a - b);
}

export function resolveRecordTime(
  original: { occurredAtUtcMs: number; zoneId: string } | null,
  value: string,
  editZone: string,
  chosenInstant = '',
) {
  if (original && value === wallTime(original.occurredAtUtcMs, editZone)) {
    return { occurredAtUtcMs: original.occurredAtUtcMs, zoneId: original.zoneId };
  }
  const candidates = matchingInstants(value, editZone);
  if (candidates.length === 0) throw new Error('此当地时间不存在或无效；请改选有效时间。');
  if (candidates.length > 1 && !candidates.includes(Number(chosenInstant))) {
    throw new Error('此当地时间出现两次；请选择明确的 UTC 偏移。');
  }
  return { occurredAtUtcMs: candidates.length === 1 ? candidates[0] : Number(chosenInstant), zoneId: editZone };
}
