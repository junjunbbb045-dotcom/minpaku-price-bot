import { yen, GROUPS } from './stats.js';
import { PROPERTIES } from '../config/properties.js';

const URL_BY_NAME = new Map(PROPERTIES.map((p) => [p.name, p.url]));

const COLORS = {
  headerBg: { '大箱': '#2e6da4', '小箱': '#3a7d52' },
  headerText: '#ffffff',
  ownRowBg: '#e8f0fa',
  ownText: '#0c447c',
  noDataBg: '#eeeeee',
  noDataText: '#555555',
};

function escapeHtml(s) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(s)
    .replace(/[&<>"']/g, (c) => map[c])
    // 絵文字等の補助平面文字はGAS側のUTF-8デコード経路で文字化けするため、
    // 数値文字参照に変換してプレーンASCIIとして埋め込む
    .replace(/[\u{10000}-\u{10FFFF}]/gu, (c) => `&#${c.codePointAt(0)};`);
}

function nameHtml(r) {
  const label = escapeHtml(r.name);
  const url = URL_BY_NAME.get(r.name);
  if (!url) return label;
  return `<a href="${escapeHtml(url)}" target="_blank" style="color: inherit; text-decoration: underline;">${label}</a>`;
}

function priceCellHtml(value) {
  if (value == null) {
    return `<span style="color:${COLORS.noDataText};">データなし</span>`;
  }
  return yen(value);
}

function rowHtml(r) {
  const rowBg = r.own ? COLORS.ownRowBg : '#ffffff';
  const nameStyle = r.own ? `color:${COLORS.ownText};font-weight:bold;` : 'color:#222222;';
  const namePrefix = r.own ? '★ ' : '';

  return `
      <tr style="background:${rowBg};">
        <td style="padding:10px 12px;border-bottom:1px solid #eeeeee;font-size:13px;${nameStyle}">${namePrefix}${nameHtml(r)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #eeeeee;text-align:right;font-size:13px;">${priceCellHtml(r.weekdayAverage)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #eeeeee;text-align:right;font-size:13px;">${priceCellHtml(r.weekendHolidayAverage)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #eeeeee;text-align:center;font-size:12px;color:#777777;">${r.fetchedDays}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #eeeeee;text-align:center;font-size:12px;color:#777777;">${r.soldOutExcludedDays}</td>
      </tr>`;
}

function groupTableHtml(group, offsetDays, weeklyStats) {
  const rows = weeklyStats.filter((s) => s.offsetDays === offsetDays && s.group === group);
  const own = rows.filter((r) => r.own);
  const competitors = rows.filter((r) => !r.own);

  const bodyRows = [...own, ...competitors].map(rowHtml).join('');

  const hBg = COLORS.headerBg[group] ?? '#444444';
  return `
      <h3 style="margin:14px 0 4px;font-size:13px;color:${hBg};">${escapeHtml(group)}グループ</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:8px;">
        <tr style="background:${hBg};">
          <th style="padding:8px 12px;color:${COLORS.headerText};text-align:left;font-size:12px;">物件</th>
          <th style="padding:8px 12px;color:${COLORS.headerText};text-align:right;font-size:12px;">平日平均</th>
          <th style="padding:8px 12px;color:${COLORS.headerText};text-align:right;font-size:12px;">土曜・連休平均</th>
          <th style="padding:8px 12px;color:${COLORS.headerText};text-align:center;font-size:12px;">取得日数</th>
          <th style="padding:8px 12px;color:${COLORS.headerText};text-align:center;font-size:12px;">満室除外日数</th>
        </tr>${bodyRows}
      </table>`;
}

function sectionHtml(week, weeklyStats) {
  const groupTables = GROUPS.map((group) => groupTableHtml(group, week.offsetDays, weeklyStats)).join('');

  return `
    <tr><td style="padding:24px 24px 8px;">
      <h2 style="margin:0 0 4px;font-size:15px;color:${COLORS.headerBg};">
        +${week.offsetDays}日後の週: ${week.weekStart} 〜 ${week.weekEnd}
      </h2>
      ${groupTables}
    </td></tr>`;
}

export function buildHtmlReport(data, weeklyStats, subject, sheetsUrl) {
  const sections = data.observationWeeks.map((w) => sectionHtml(w, weeklyStats)).join('');
  const sheetsBanner = sheetsUrl
    ? `<tr><td style="padding:16px 24px 0;">
        <a href="${escapeHtml(sheetsUrl)}" target="_blank"
           style="display:block;background:#e8f0fe;border:2px solid #1a73e8;color:#1a73e8;text-align:center;padding:14px 16px;border-radius:8px;font-size:15px;font-weight:bold;text-decoration:none;letter-spacing:0.03em;">
          競合カレンダー分析を開く &gt;&gt;
        </a>
      </td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="ja">
<body style="margin:0;padding:0;background:#f0f0ee;font-family:'Hiragino Kaku Gothic ProN','Hiragino Sans',Meiryo,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0ee;">
    <tr><td align="center" style="padding:24px 12px;">
      <table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e2e2;">
        <tr><td style="background:#1a3a5c;color:${COLORS.headerText};padding:20px 24px;font-size:17px;font-weight:bold;">
          ${escapeHtml(subject)}
        </td></tr>${sheetsBanner}${sections}
        <tr><td style="padding:8px 24px 24px;color:#999999;font-size:11px;">
          平日＝日〜金（連休中日除く）／土曜・連休＝土曜・連休中日・お盆・年末年始・GW・シルバーウィーク／満室日は平均から除外／宿泊人数: 大人2名（1泊）
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
