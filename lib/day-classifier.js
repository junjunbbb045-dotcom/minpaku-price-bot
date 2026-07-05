import jh from 'japanese-holidays';
import { formatDate } from './dates.js';
import { isInSpecialPeriod } from '../config/special-periods.js';

export const WEEKDAY = 'weekday';
export const WEEKEND_HOLIDAY = 'weekend_holiday';

function isOffDay(date) {
  const day = date.getDay();
  return day === 0 || day === 6 || Boolean(jh.isHoliday(date));
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// 土・日・祝日が3日以上連続するブロックに含まれる日を「連休中日」として扱う
function isInLongHolidayRun(date) {
  if (!isOffDay(date)) return false;

  let start = new Date(date);
  while (isOffDay(addDays(start, -1))) start = addDays(start, -1);

  let end = new Date(date);
  while (isOffDay(addDays(end, 1))) end = addDays(end, 1);

  const runLengthDays = Math.round((end - start) / 86400000) + 1;
  return runLengthDays >= 3;
}

// 平日: 日〜金（連休中日は除く） / 土曜・連休: 土曜・連休中日・お盆・年末年始・GW・シルバーウィーク
export function classifyDay(date) {
  if (date.getDay() === 6) return WEEKEND_HOLIDAY;
  if (isInSpecialPeriod(formatDate(date))) return WEEKEND_HOLIDAY;
  if (isInLongHolidayRun(date)) return WEEKEND_HOLIDAY;
  return WEEKDAY;
}
