import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { PROPERTIES } from './config/properties.js';
import { getObservationWeeks, formatDate, weekdayJa, formatTimestamp } from './lib/dates.js';
import { parsePriceFromText } from './lib/extract-price.js';
import { classifyDay, WEEKDAY, WEEKEND_HOLIDAY } from './lib/day-classifier.js';
import { fetchAvailabilityCalendar } from './lib/calendar-api.js';

const __dirname = import.meta.dirname;
const DATA_DIR = path.join(__dirname, 'data');
const DEBUG_DIR = path.join(DATA_DIR, 'debug');
const PROFILE_DIR = path.join(__dirname, '.pw-profile');

const HEADLESS = process.env.HEADLESS !== 'false';
const NAV_TIMEOUT_MS = 30000;
const WEEKDAY_SAMPLE_SIZE = 2;
const WEEKEND_SAMPLE_SIZE = 1;

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

function sampleWithoutReplacement(items, n) {
  const pool = [...items];
  const picked = [];
  while (pool.length > 0 && picked.length < n) {
    const i = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(i, 1)[0]);
  }
  return picked;
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
  const result = {
    name: property.name,
    own: property.own,
    group: property.group,
    date: formatDate(date),
    dayOfWeek: weekdayJa(date),
    status: 'error',
    price: null,
  };

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
        const debugFile = path.join(DEBUG_DIR, `${property.name}-${result.date}.png`);
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

function pickSampleDates(week, calendarMap) {
  const weekdayAvailable = [];
  const weekendAvailable = [];

  for (const date of week.days) {
    const dateStr = formatDate(date);
    if (calendarMap.get(dateStr)?.available !== true) continue;
    const category = classifyDay(date);
    if (category === WEEKDAY) weekdayAvailable.push(date);
    else weekendAvailable.push(date);
  }

  return [
    ...sampleWithoutReplacement(weekdayAvailable, WEEKDAY_SAMPLE_SIZE),
    ...sampleWithoutReplacement(weekendAvailable, WEEKEND_SAMPLE_SIZE),
  ];
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const observationWeeks = getObservationWeeks();

  let { browser, context, page } = await createBrowserContext();

  const dayRecords = [];
  const weeklyMeta = [];
  const calendarData = {};

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = formatDate(today);

  for (const property of PROPERTIES) {
    console.log(`Fetching calendar: ${property.name}...`);
    let calendarMap = new Map();
    try {
      const calendarDays = await withTimeout(fetchAvailabilityCalendar(page, property.url), 30000);
      calendarMap = new Map(calendarDays.map((d) => [d.date, { available: d.available, minNights: d.minNights }]));
      // 今日以降の日程のみ保存（ダッシュボード用）
      calendarData[property.name] = Object.fromEntries(
        [...calendarMap.entries()].filter(([date]) => date >= todayStr)
      );
    } catch (err) {
      console.log(`  -> カレンダー取得失敗 (${err.message}). ブラウザを再起動して続行します。`);
      await browser.close().catch(() => {});
      ({ browser, context, page } = await createBrowserContext());
    }

    for (const week of observationWeeks) {
      const meta = buildWeekCategoryMeta(week, calendarMap);
      weeklyMeta.push({
        name: property.name,
        own: property.own,
        group: property.group,
        offsetDays: week.offsetDays,
        weekStart: formatDate(week.weekStart),
        weekEnd: formatDate(week.weekEnd),
        ...meta,
      });

      const sampleDates = pickSampleDates(week, calendarMap);
      for (const date of sampleDates) {
        const nights = calendarMap.get(formatDate(date))?.minNights ?? 1;
        const label = `${property.name} (${formatDate(date)}, ${nights}泊)`;
        console.log(`Scraping ${label}...`);

        let r;
        try {
          r = await withTimeout(scrapeOneNight(page, property, date, nights, property.group), 60000);
          console.log(`  -> ${r.status} price=${r.price}`);
        } catch (err) {
          console.log(`  -> HUNG (${err.message}). ブラウザを再起動して続行します。`);
          r = {
            name: property.name,
            own: property.own,
            group: property.group,
            date: formatDate(date),
            dayOfWeek: weekdayJa(date),
            status: 'error',
            price: null,
            error: err.message,
          };
          await browser.close().catch(() => {});
          ({ browser, context, page } = await createBrowserContext());
        }
        dayRecords.push({ ...r, offsetDays: week.offsetDays, category: classifyDay(date) });
        await randomDelay(2000, 5000);
      }
    }
  }

  await browser.close();

  const timestamp = formatTimestamp(new Date());
  const outFile = path.join(DATA_DIR, `results-${timestamp}.json`);
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        scrapedAt: new Date().toISOString(),
        observationWeeks: observationWeeks.map((w) => ({
          offsetDays: w.offsetDays,
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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
