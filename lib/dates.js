function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

export function weekdayJa(date) {
  return WEEKDAY_JA[date.getDay()];
}

export function formatDateJa(date) {
  return `${formatDate(date)}(${weekdayJa(date)})`;
}

export function formatTimestamp(date) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${formatDate(date)}-${hh}${mm}${ss}`;
}

export const OBSERVATION_WEEK_COUNT = 4;

// 観測週: 実行日を起点に7日刻みで4週間（直近1週目〜直近4週目）
export function getObservationWeeks(baseDate = new Date()) {
  const today = new Date(baseDate);
  today.setHours(0, 0, 0, 0);

  return Array.from({ length: OBSERVATION_WEEK_COUNT }, (_, i) => {
    const offsetDays = i * 7;
    const weekStart = addDays(today, offsetDays);
    const days = Array.from({ length: 7 }, (_, j) => addDays(weekStart, j));
    return { offsetDays, label: `直近${i + 1}週目`, weekStart, weekEnd: days[6], days };
  });
}

export function formatMonthDay(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `${Number(m)}/${Number(d)}`;
}
