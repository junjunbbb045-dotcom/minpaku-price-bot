import { PROPERTIES } from '../config/properties.js';
import { WEEKDAY, WEEKEND_HOLIDAY } from './day-classifier.js';
import { formatMonthDay } from './dates.js';

export const GROUPS = ['大箱', '小箱'];

export function average(values) {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function yen(n) {
  return n == null ? '—' : `¥${Math.round(n).toLocaleString('ja-JP')}`;
}

// 価格が1件もないとき、その理由（全日満室 or まだ取得できていない）を返す
function summarizeCategory(records) {
  const prices = records.filter((r) => r.status === 'available' && r.price).map((r) => r.price);
  const soldOutDays = records.filter((r) => r.status === 'sold_out').length;
  const unfetchedDays = records.filter((r) => r.status === 'unfetched').length;

  let note = null;
  if (prices.length === 0 && records.length > 0) {
    note = soldOutDays === records.length ? '満室' : '未取得';
  }

  return { average: average(prices), note, priceDays: prices.length, soldOutDays, unfetchedDays };
}

// 物件×週ごとに、平日平均・土曜・連休平均（空室日すべての価格から算出）と取得状況をまとめる
export function computeWeeklyPropertyStats(data) {
  const weeks = data.observationWeeks;
  const stats = [];

  for (const week of weeks) {
    for (const property of PROPERTIES) {
      const meta = data.weeklyMeta.find((m) => m.name === property.name && m.offsetDays === week.offsetDays);
      const records = data.dayRecords.filter((r) => r.name === property.name && r.offsetDays === week.offsetDays);

      const weekday = summarizeCategory(records.filter((r) => r.category === WEEKDAY));
      const weekend = summarizeCategory(records.filter((r) => r.category === WEEKEND_HOLIDAY));
      const fetchedDays = weekday.priceDays + weekend.priceDays;

      stats.push({
        name: property.name,
        own: property.own,
        group: property.group,
        offsetDays: week.offsetDays,
        label: week.label,
        weekStart: week.weekStart,
        weekEnd: week.weekEnd,
        weekdayAverage: weekday.average,
        weekdayNote: weekday.note,
        weekendHolidayAverage: weekend.average,
        weekendHolidayNote: weekend.note,
        fetchedDays,
        soldOutDays: weekday.soldOutDays + weekend.soldOutDays,
        unfetchedDays: weekday.unfetchedDays + weekend.unfetchedDays,
        noDataFlag: fetchedDays === 0,
        occupancy: meta ? { weekday: meta.weekday, weekendHoliday: meta.weekendHoliday } : null,
      });
    }
  }

  return stats;
}

export function buildSubject(weeklyStats, observationWeeks) {
  const first = observationWeeks[0];
  const last = observationWeeks[observationWeeks.length - 1];
  if (!first || !last) return '📬 競合価格まとめ';
  return `📬 競合価格まとめ｜直近${observationWeeks.length}週間（${formatMonthDay(first.weekStart)}〜${formatMonthDay(last.weekEnd)}）`;
}
