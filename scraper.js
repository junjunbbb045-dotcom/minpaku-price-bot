import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { PROPERTIES } from './config/properties.js';
import { getObservationWeeks, formatDate, weekdayJa, formatTimestamp } from './lib/dates.js';
import { parsePriceFromText } from './lib/extract-price.js';
import { classifyDay, WEEKDAY, WEEKEND_HOLIDAY } from './lib/day-classifier.js';
import { fetchAvailabilityCalendar } from './lib/calendar-api.js';
import {
  PRICE_MAX_AGE_DAYS,
  cacheKey,
  loadPriceCache,
  savePriceCache,
  pruneBefore,
  needsFetch,
  isStale,
} from './lib/price-cache.js';

const __dirname = import.meta.dirname;
const DATA_DIR = path.join(__dirname, 'data');
const DEBUG_DIR = path.join(DATA_DIR, 'debug');

const HEADLESS = process.env.HEADLESS !== 'false';
const CALENDAR_MAX_ATTEMPTS = 3;
const NAV_TIMEOUT_MS = 30000;
// 1回の実行で価格ページを開く上限。初回は数日かけて埋まり、以降は差分のみになる
const MAX_FETCH_PER_RUN = Number(process.env.MAX_FETCH_PER_RUN ?? 200);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(minMs, maxMs) {
  return sleep(minMs + Math.random() * (maxMs - minMs));
}

function withTimeout(promise, ms) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`hard timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

async function createBrowserContext() {
  const browser = await chromium.launch({
    headless: HEADLESS,
  });
  const context = await browser.newContext({
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    viewport: { width: 1366, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  return { browser, context, page };
}

function buildStayUrl(baseUrl, date, nights, group) {
  const url = new URL(baseUrl);
  const checkOut = new Date(date);
  checkOut.setDate(checkOut.getDate() + nights);
  url.searchParams.set('check_in', formatDate(date));
  url.searchParams.set('check_out', formatDate(checkOut));
  url.searchParams.set('adults', group === '小箱' ? '4' : '6');
  return url.toString();
}

// 繁忙期は最低泊数(minNights)が2以上に設定されることがあり、1泊指定だと
// Airbnbが価格を表示しないため、その日のminNightsに合わせて宿泊数を指定する
async function scrapeOneNight(page, property, date, nights, group) {
  const url = buildStayUrl(property.url, date, nights, group);
  const result = { status: 'error', price: null };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      await page.waitForTimeout(3000);

      const closeBtn = page.getByRole('button', { name: /閉じる|close/i }).first();
      if ((await closeBtn.count()) > 0) {
        await closeBtn.click().catch(() => {});
      }
      await page.keyboard.press('Escape').catch(() => {});

      await page
        .waitForFunction(
          () => {
            const t = document.body.innerText;
            return t.includes('JPY') || t.includes('予約できません') || t.includes('満室') || t.includes('404');
          },
          null,
          { timeout: 15000 },
        )
        .catch(() => {});
      await page.waitForTimeout(1000 + Math.random() * 1000);

      const text = await page.locator('body').innerText();
      const parsed = parsePriceFromText(text);

      if (parsed.isNotFound) {
        result.status = 'not_found';
      } else if (parsed.totalPrice || parsed.perNightPrice) {
        result.status = 'available';
        result.price = parsed.perNightPrice ?? Math.round(parsed.totalPrice / nights);
      } else if (parsed.isUnavailable) {
        result.status = 'sold_out';
      } else {
        result.status = 'unknown';
        fs.mkdirSync(DEBUG_DIR, { recursive: true });
        const debugFile = path.join(DEBUG_DIR, `${property.name}-${formatDate(date)}.png`);
        await page.screenshot({ path: debugFile }).catch(() => {});
      }
      delete result.error;
      return result;
    } catch (err) {
      result.status = 'error';
      result.error = String(err.message || err).slice(0, 200);
      await sleep(2000);
    }
  }
  return result;
}

function buildWeekCategoryMeta(week, calendarMap) {
  const byCategory = { [WEEKDAY]: { total: 0, available: 0 }, [WEEKEND_HOLIDAY]: { total: 0, available: 0 } };

  for (const date of week.days) {
    const category = classifyDay(date);
    const dateStr = formatDate(date);
    const isAvailable = calendarMap.get(dateStr)?.available === true;
    byCategory[category].total += 1;
    if (isAvailable) byCategory[category].available += 1;
  }

  return {
    weekday: { ...byCategory[WEEKDAY], soldOut: byCategory[WEEKDAY].total - byCategory[WEEKDAY].available },
    weekendHoliday: {
      ...byCategory[WEEKEND_HOLIDAY],
      soldOut: byCategory[WEEKEND_HOLIDAY].total - byCategory[WEEKEND_HOLIDAY].available,
    },
  };
}

// 観測期間内の全日について、カレンダー(空室/満室)とキャッシュ(価格)から日別レコードを組み立てる
function buildDayRecords(weeks, calendarByName, cache, now) {
  const records = [];
  for (const property of PROPERTIES) {
    const calendarMap = calendarByName.get(property.name);
    for (const week of weeks) {
      for (const date of week.days) {
        const dateStr = formatDate(date);
        const base = {
          name: property.name,
          own: property.own,
          group: property.group,
          date: dateStr,
          dayOfWeek: weekdayJa(date),
          offsetDays: week.offsetDays,
          category: classifyDay(date),
        };

        const cal = calendarMap?.get(dateStr);
        if (!calendarMap || !cal) {
          records.push({ ...base, status: 'unfetched', price: null, reason: 'no_calendar' });
          continue;
        }
        if (cal.available !== true) {
          records.push({ ...base, status: 'sold_out', price: null });
          continue;
        }

        const entry = cache[cacheKey(property.name, dateStr)];
        if (entry?.status === 'available' && entry.price) {
          records.push({
            ...base,
            status: 'available',
            price: entry.price,
            nights: entry.nights,
            fetchedAt: entry.fetchedAt,
            stale: isStale(entry, now),
          });
        } else if (entry?.status === 'sold_out') {
          records.push({ ...base, status: 'sold_out', price: null, fetchedAt: entry.fetchedAt });
        } else {
          records.push({ ...base, status: 'unfetched', price: null, reason: entry?.status ?? 'never' });
        }
      }
    }
  }
  return records;
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayStr = formatDate(today);

  const observationWeeks = getObservationWeeks(today);
  const windowDates = observationWeeks.flatMap((w) => w.days);

  const cache = loadPriceCache();
  pruneBefore(cache, todayStr);

  let { browser, context, page } = await createBrowserContext();

  const weeklyMeta = [];
  const calendarData = {};
  const calendarByName = new Map();

  // 1. 全物件の空室カレンダーを取得（1物件1リクエストで12ヶ月分）
  for (const property of PROPERTIES) {
    console.log(`Fetching calendar: ${property.name}...`);
    let calendarDays = null;
    for (let attempt = 1; attempt <= CALENDAR_MAX_ATTEMPTS && !calendarDays; attempt++) {
      try {
        calendarDays = await withTimeout(fetchAvailabilityCalendar(page, property.url), 45000);
      } catch (err) {
        const isLast = attempt === CALENDAR_MAX_ATTEMPTS;
        console.log(
          `  -> カレンダー取得失敗 (${attempt}/${CALENDAR_MAX_ATTEMPTS}: ${err.message}). ブラウザを再起動して${isLast ? '続行' : '再試行'}します。`,
        );
        await browser.close().catch(() => {});
        ({ browser, context, page } = await createBrowserContext());
        if (!isLast) await randomDelay(3000, 6000);
      }
    }

    let calendarMap = new Map();
    if (calendarDays) {
      calendarMap = new Map(calendarDays.map((d) => [d.date, { available: d.available, minNights: d.minNights }]));
      calendarByName.set(property.name, calendarMap);
      // 今日以降の日程のみ保存（ダッシュボード用）
      calendarData[property.name] = Object.fromEntries(
        [...calendarMap.entries()].filter(([date]) => date >= todayStr),
      );
    }

    for (const week of observationWeeks) {
      weeklyMeta.push({
        name: property.name,
        own: property.own,
        group: property.group,
        offsetDays: week.offsetDays,
        weekStart: formatDate(week.weekStart),
        weekEnd: formatDate(week.weekEnd),
        ...buildWeekCategoryMeta(week, calendarMap),
      });
    }
    await randomDelay(1500, 3000);
  }

  // 2. 空室日のうち、価格が未取得または古いものだけを近い日付から取りに行く
  const targets = [];
  let skippedFresh = 0;
  for (const date of windowDates) {
    const dateStr = formatDate(date);
    for (const property of PROPERTIES) {
      const cal = calendarByName.get(property.name)?.get(dateStr);
      if (cal?.available !== true) continue;
      const entry = cache[cacheKey(property.name, dateStr)];
      if (needsFetch(entry, now)) {
        targets.push({ property, date, dateStr, nights: cal.minNights ?? 1, isNew: !entry });
      } else {
        skippedFresh++;
      }
    }
  }
  const planned = targets.slice(0, MAX_FETCH_PER_RUN);
  console.log(
    `価格取得対象: ${targets.length}件（新規 ${targets.filter((t) => t.isNew).length} / 更新 ${targets.filter((t) => !t.isNew).length}）、` +
      `キャッシュ有効で省略 ${skippedFresh}件、今回取得 ${planned.length}件（上限 ${MAX_FETCH_PER_RUN}）`,
  );

  let fetched = 0;
  for (const t of planned) {
    const label = `${t.property.name} (${t.dateStr}, ${t.nights}泊)`;
    console.log(`Scraping ${label}...`);
    let r;
    try {
      r = await withTimeout(scrapeOneNight(page, t.property, t.date, t.nights, t.property.group), 60000);
      console.log(`  -> ${r.status} price=${r.price}`);
    } catch (err) {
      console.log(`  -> HUNG (${err.message}). ブラウザを再起動して続行します。`);
      r = { status: 'error', price: null, error: err.message };
      await browser.close().catch(() => {});
      ({ browser, context, page } = await createBrowserContext());
    }
    cache[cacheKey(t.property.name, t.dateStr)] = {
      status: r.status,
      price: r.price,
      nights: t.nights,
      fetchedAt: new Date().toISOString(),
      ...(r.error ? { error: r.error } : {}),
    };
    savePriceCache(cache);
    fetched++;
    await randomDelay(3000, 6000);
  }

  await browser.close();

  const dayRecords = buildDayRecords(observationWeeks, calendarByName, cache, new Date());

  const timestamp = formatTimestamp(new Date());
  const outFile = path.join(DATA_DIR, `results-${timestamp}.json`);
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        scrapedAt: new Date().toISOString(),
        priceMaxAgeDays: PRICE_MAX_AGE_DAYS,
        fetchStats: {
          targets: targets.length,
          fetched,
          skippedFresh,
          remaining: targets.length - planned.length,
        },
        observationWeeks: observationWeeks.map((w) => ({
          offsetDays: w.offsetDays,
          label: w.label,
          weekStart: formatDate(w.weekStart),
          weekEnd: formatDate(w.weekEnd),
        })),
        dayRecords,
        weeklyMeta,
        calendarData,
      },
      null,
      2,
    ),
  );
  console.log(`Saved: ${outFile}`);
  if (targets.length > planned.length) {
    console.log(`未取得が ${targets.length - planned.length} 件残っています。次回の実行で続きを取得します。`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
