import fs from 'node:fs';
import path from 'node:path';
import { buildDashboardHtml } from './lib/dashboard-html.js';

const __dirname = import.meta.dirname;
const DATA_DIR = path.join(__dirname, 'data');

function latestResultsFile() {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith('results-') && f.endsWith('.json'))
    .sort();
  if (files.length === 0) throw new Error('data/ に results-*.json が見つかりません。先に scraper.js を実行してください。');
  return path.join(DATA_DIR, files.at(-1));
}

const file = latestResultsFile();
console.log(`読み込み: ${path.basename(file)}`);
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

if (!data.calendarData) {
  console.error('calendarData がありません。最新版の scraper.js で取得し直してください。');
  process.exit(1);
}

const html = buildDashboardHtml(data);
const outFile = path.join(__dirname, 'dashboard.html');
fs.writeFileSync(outFile, html, 'utf8');
console.log(`生成完了: ${outFile}`);
