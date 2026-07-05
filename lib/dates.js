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

function startOfWeek(date) {
  return addDays(date, -date.getDay());
}

// 観測週: 実行日から+15/+30/+45日後を含む週（日〜土の7日間）
export function getObservationWeeks(baseDate = new Date()) {
  const today = new Date(baseDate);
  today.setHours(0, 0, 0, 0);

  return [15, 30, 45].map((offsetDays) => {
    const target = addDays(today, offsetDays);
    const weekStart = startOfWeek(target);
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    return { offsetDays, weekStart, weekEnd: days[6], days };
  });
}
