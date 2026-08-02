import fs from 'node:fs';
import path from 'node:path';
import { formatTimestamp } from './lib/dates.js';
import { uploadMarkdownToDrive } from './lib/drive.js';
import { DRIVE_INBOX_FOLDER_ID, REPORT_RECIPIENT } from './config/properties.js';
import { yen, computeWeeklyPropertyStats, buildSubject, GROUPS } from './lib/stats.js';
import { buildHtmlReport } from './lib/html-report.js';
import { buildDashboardHtml } from './lib/dashboard-html.js';

const __dirname = import.meta.dirname;
const DATA_DIR = path.join(__dirname, 'data');
const REPORTS_DIR = path.join(__dirname, 'reports');

function findLatestResultsFile() {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith('results-') && f.endsWith('.json'))
    .sort();
  if (files.length === 0) {
    throw new Error('data/results-*.json が見つかりません。先に scraper.js を実行してください。');
  }
  return path.join(DATA_DIR, files[files.length - 1]);
}

function buildGroupSection(group, offsetDays, weeklyStats) {
  const rows = weeklyStats.filter((s) => s.offsetDays === offsetDays && s.group === group);
  const own = rows.filter((r) => r.own);
  const competitors = rows.filter((r) => !r.own);

  const lines = [];
  lines.push(`### ${group}グループ`);
  lines.push('');
  lines.push('| 物件 | 平日平均 | 土曜・連休平均 | 取得日数 | 満室除外日数 |');
  lines.push('|---|---|---|---|---|');

  for (const r of [...own, ...competitors]) {
    const prefix = r.own ? '★ ' : '';
    const weekday = r.noDataFlag ? 'データなし' : yen(r.weekdayAverage);
    const weekendHoliday = r.weekendHolidayAverage == null ? 'データなし' : yen(r.weekendHolidayAverage);
    lines.push(`| ${prefix}${r.name} | ${weekday} | ${weekendHoliday} | ${r.fetchedDays} | ${r.soldOutExcludedDays} |`);
  }

  lines.push('');
  return lines.join('\n');
}

function buildSection(week, weeklyStats) {
  const lines = [];
  lines.push(`## +${week.offsetDays}日後の週: ${week.weekStart} 〜 ${week.weekEnd}`);
  lines.push('');
  for (const group of GROUPS) {
    lines.push(buildGroupSection(group, week.offsetDays, weeklyStats));
  }
  lines.push('');
  return lines.join('\n');
}

function buildReport(data) {
  const generatedAt = new Date();
  const weeklyStats = computeWeeklyPropertyStats(data);
  const subject = buildSubject(weeklyStats, data.observationWeeks);

  const lines = [];
  lines.push(`# ${subject}`);
  lines.push('');
  lines.push(`- 実行日時: ${generatedAt.toLocaleString('ja-JP')}`);
  lines.push(`- 取得日時(scraper): ${new Date(data.scrapedAt).toLocaleString('ja-JP')}`);
  lines.push('- 宿泊人数: 大人2名（1泊）');
  lines.push('');

  for (const week of data.observationWeeks) {
    lines.push(buildSection(week, weeklyStats));
  }

  return { markdown: lines.join('\n'), generatedAt, subject, weeklyStats };
}

function buildFrontMatter({ to, subject, html, dashboardHtml }) {
  const htmlBodyBase64 = Buffer.from(html, 'utf8').toString('base64');
  const dashboardBase64 = Buffer.from(dashboardHtml, 'utf8').toString('base64');
  return ['---', `to: ${to}`, `subject: ${subject}`, `htmlBody: ${htmlBodyBase64}`, `dashboardHtml: ${dashboardBase64}`, '---', ''].join('\n');
}

async function main() {
  const latestFile = findLatestResultsFile();
  const data = JSON.parse(fs.readFileSync(latestFile, 'utf8'));

  const { markdown, generatedAt, subject, weeklyStats } = buildReport(data);
  const html = buildHtmlReport(data, weeklyStats, subject);
  const dashboardHtml = data.calendarData ? buildDashboardHtml(data) : null;
  const frontMatter = buildFrontMatter({ to: REPORT_RECIPIENT, subject, html, dashboardHtml: dashboardHtml ?? '' });

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const fileName = `${formatTimestamp(generatedAt)}.md`;
  const outFile = path.join(REPORTS_DIR, fileName);
  fs.writeFileSync(outFile, frontMatter + markdown, 'utf8');
  console.log(`レポートを保存しました: ${outFile}`);

  const uploaded = await uploadMarkdownToDrive(outFile, DRIVE_INBOX_FOLDER_ID);
  console.log(`Driveにアップロードしました: ${uploaded.name} (${uploaded.id})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
