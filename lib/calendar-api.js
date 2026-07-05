// Airbnbの物件ページが内部で呼ぶPdpAvailabilityCalendar(GraphQL)を傍受して、
// 未来12ヶ月分の日別空室状況を1リクエストで取得する。価格はこのAPIには含まれない。
export async function fetchAvailabilityCalendar(page, propertyUrl, navTimeoutMs = 30000) {
  let calendarBody = null;

  const onResponse = async (res) => {
    if (calendarBody) return;
    if (res.url().includes('PdpAvailabilityCalendar')) {
      try {
        calendarBody = await res.text();
      } catch {
        // レスポンス本文が読めない場合は無視し、後続のリトライ/エラー処理に委ねる
      }
    }
  };
  page.on('response', onResponse);

  try {
    await page.goto(propertyUrl, { waitUntil: 'domcontentloaded', timeout: navTimeoutMs });
    await page.waitForTimeout(4000);
    await page
      .waitForFunction(() => document.body.innerText.length > 0, null, { timeout: 5000 })
      .catch(() => {});
  } finally {
    page.off('response', onResponse);
  }

  if (!calendarBody) {
    throw new Error('PdpAvailabilityCalendarレスポンスを取得できませんでした');
  }

  const json = JSON.parse(calendarBody);
  const months = json?.data?.merlin?.pdpAvailabilityCalendar?.calendarMonths ?? [];
  const days = months.flatMap((m) => m.days);

  return days.map((d) => ({
    date: d.calendarDate,
    available: Boolean(d.available),
    minNights: d.minNights ?? 1,
  }));
}
