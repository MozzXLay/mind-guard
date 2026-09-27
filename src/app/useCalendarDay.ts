import { useEffect, useState } from 'react';
import { calendarDay, createCalendarWatch } from './calendar';

export function useCalendarDay() {
  const [day, setDay] = useState(() => calendarDay(new Date()));
  useEffect(() => {
    const watch = createCalendarWatch(setDay);
    const check = () => watch.check();
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      watch.stop();
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);
  return day;
}
