import { PROPERTIES } from '../config/properties.js';
import { WEEKDAY, WEEKEND_HOLIDAY } from './day-classifier.js';

export const GROUPS = ['大箱', '小箱'];

export function average(values) {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function yen(n) {
  return n == null ? '—' : `¥${Math.round(n).toLocaleString('ja-JP')}`;
}

// 物件×週ごとに、平日平均・土曜・連休平均（満室日は除外）と取得状況をまとめる
export function computeWeeklyPropertyStats(data) {
  const weeks = data.observationWeeks;
  const statsByKey = new Map();

  for (const week of weeks) {
    for (const property of PROPERTIES) {
      const key = `${property.name}__${week.offsetDays}`;
      const meta = data.weeklyMeta.find((m) => m.name === property.name && m.offsetDays === week.offsetDays);
      const records = data.dayRecords.filter((r) => r.name === property.name && r.offsetDays === week.offsetDays);

      const weekdayRecords = records.filter((r) => r.category === WEEKDAY);
      const weekendRecords = records.filter((r) => r.category === WEEKEND_HOLIDAY);

      const weekdayPrices = weekdayRecords.filter((r) => r.status === 'available').map((r) => r.price);
      const weekendPrices = weekendRecords.filter((r) => r.status === 'available').map((r) => r.price);

      const fetchedDays = records.filter((r) => r.status === 'available').length;
      const soldOutExcludedDays = records.filter((r) => r.status === 'sold_out').length;

      statsByKey.set(key, {
        name: property.name,
        own: property.own,
        group: property.group,
        offsetDays: week.offsetDays,
        weekStart: week.weekStart,
        weekEnd: week.weekEnd,
        weekdayAverage: average(weekdayPrices),
        weekendHolidayAverage: average(weekendPrices),
        fetchedDays,
        soldOutExcludedDays,
        noDataFlag: weekdayPrices.length === 0 && weekendPrices.length === 0,
        occupancy: meta ? { weekday: meta.weekday, weekendHoliday: meta.weekendHoliday } : null,
      });
    }
  }

  return [...statsByKey.values()];
}

export function buildSubject(weeklyStats, observationWeeks) {
  const nearest = observationWeeks[0];
  if (!nearest) return '📬 今週の相場まとめ';
  return `📬 競合価格まとめ｜${nearest.weekStart}〜${nearest.weekEnd}の週`;
}
