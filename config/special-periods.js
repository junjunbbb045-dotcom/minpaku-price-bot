// 法律上の祝日とは別に、観光需要が高まる季節の繁忙期を手動で定義する。
// 年が変わったら（特にGW・シルバーウィークは年によって日付がずれるため）この内容を見直すこと。
export const SPECIAL_PERIODS = [
  { name: 'GW', start: '2026-04-29', end: '2026-05-06' },
  { name: 'お盆', start: '2026-08-13', end: '2026-08-16' },
  { name: 'シルバーウィーク', start: '2026-09-19', end: '2026-09-23' },
  { name: '年末年始', start: '2026-12-29', end: '2027-01-03' },
];

export function isInSpecialPeriod(dateStr) {
  return SPECIAL_PERIODS.some((p) => dateStr >= p.start && dateStr <= p.end);
}
