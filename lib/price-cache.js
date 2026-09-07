import fs from 'node:fs';
import path from 'node:path';

const __dirname = import.meta.dirname;
const CACHE_FILE = path.join(__dirname, '..', 'data', 'price-cache.json');

// 取得後この日数までは最新とみなし再取得しない
export const PRICE_MAX_AGE_DAYS = 5;

export function cacheKey(name, dateStr) {
  return `${name}|${dateStr}`;
}

export function loadPriceCache() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    return parsed.entries ?? {};
  } catch {
    return {};
  }
}

export function savePriceCache(entries) {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  const tmp = `${CACHE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), entries }, null, 2));
  fs.renameSync(tmp, CACHE_FILE);
}

export function pruneBefore(entries, todayStr) {
  for (const key of Object.keys(entries)) {
    const dateStr = key.slice(key.indexOf('|') + 1);
    if (dateStr < todayStr) delete entries[key];
  }
}

export function ageInDays(fetchedAt, now = new Date()) {
  const t = Date.parse(fetchedAt);
  if (Number.isNaN(t)) return Infinity;
  return (now.getTime() - t) / 86400000;
}

// 空室日の価格を取りに行くべきか。有効な価格は約5日ごと、満室・失敗だったものは翌日以降に再確認する
export function needsFetch(entry, now = new Date()) {
  if (!entry) return true;
  const age = ageInDays(entry.fetchedAt, now);
  if (entry.status === 'available' && entry.price) return age >= PRICE_MAX_AGE_DAYS - 0.5;
  return age >= 0.5;
}

export function isStale(entry, now = new Date()) {
  return ageInDays(entry.fetchedAt, now) > PRICE_MAX_AGE_DAYS;
}
