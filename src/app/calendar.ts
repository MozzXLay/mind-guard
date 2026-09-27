export type CalendarDay = { date: string; zone: string; key: string; shortLabel: string; longLabel: string };

export function fromDays(days: number, anchor: string) {
  const date = new Date(`${anchor}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days + 1);
  return date.toISOString().slice(0, 10);
}

export function calendarDay(now: Date): CalendarDay {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return {
    date, zone, key: `${date}|${zone}`,
    shortLabel: new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(now),
    longLabel: new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full' }).format(now),
  };
}

// Checks the inexpensive calendar clock at midnight and at most once a minute.
// Focus and visibility handlers call check immediately after a suspend or zone change.
export function createCalendarWatch(
  onChange: (day: CalendarDay) => void,
  now: () => Date = () => new Date(),
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> = setTimeout,
  cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout,
) {
  let current = calendarDay(now());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const check = () => {
    if (stopped) return;
    if (timer !== undefined) cancel(timer);
    const instant = now();
    const next = calendarDay(instant);
    if (next.key !== current.key) { current = next; onChange(next); }
    const midnight = new Date(instant.getFullYear(), instant.getMonth(), instant.getDate() + 1).getTime();
    const delay = Math.max(1, Math.min(60_000, midnight - instant.getTime()));
    timer = schedule(check, delay);
  };
  check();
  return { check, stop: () => { stopped = true; if (timer !== undefined) cancel(timer); } };
}
