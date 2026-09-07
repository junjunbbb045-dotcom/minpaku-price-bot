// Airbnbの物件ページが内部で呼ぶ空室カレンダーAPI(GraphQL)を傍受して、
// 未来12ヶ月分の日別空室状況を1リクエストで取得する。価格はこのAPIには含まれない。
// Airbnbはセッション単位のA/Bで旧API(PdpAvailabilityCalendar)と新API
// (StaysPdpAtomicAvailabilityCalendarQuery)を出し分けており、レスポンス構造は同一。
// どちらも自動発火しないセッションもあるため、その場合は呼び出し側でブラウザを作り直して再試行する。
const CALENDAR_OPERATIONS = ['PdpAvailabilityCalendar', 'StaysPdpAtomicAvailabilityCalendarQuery'];

export async function fetchAvailabilityCalendar(page, propertyUrl, navTimeoutMs = 30000, calendarTimeoutMs = 20000) {
  // goto より先に待ち受けを登録しないと、早く返ってきたレスポンスを取りこぼす
  const responsePromise = page.waitForResponse(
    (res) => CALENDAR_OPERATIONS.some((op) => res.url().includes(op)),
    { timeout: calendarTimeoutMs },
  );
  responsePromise.catch(() => {});

  await page.goto(propertyUrl, { waitUntil: 'domcontentloaded', timeout: navTimeoutMs });

  // カレンダー部分は遅延読み込みされることがあるため、応答が遅い場合はスクロールして描画を促す
  (async () => {
    try {
      await page.waitForTimeout(5000);
      await page.mouse.wheel(0, 1500);
    } catch {
      // ページが既に閉じられた等。応答待ちの結果には影響しない
    }
  })();

  let calendarBody;
  try {
    const res = await responsePromise;
    calendarBody = await res.text();
  } catch {
    throw new Error('空室カレンダーAPIのレスポンスを取得できませんでした');
  }

  const json = JSON.parse(calendarBody);
  const months = json?.data?.merlin?.pdpAvailabilityCalendar?.calendarMonths ?? [];
  const days = months.flatMap((m) => m.days);

  return days.map((d) => ({
    date: d.calendarDate,
    available: Boolean(d.availableForCheckin),
    minNights: d.minNights ?? 1,
  }));
}
