const UNAVAILABLE_PATTERNS = [
  '予約できません',
  '空いていません',
  '満室',
  '予約不可',
  'no longer available',
  "isn't available",
  'not available for',
];

const NOT_FOUND_PATTERNS = ['お探しのページが見つかりません', 'エラーコード: 404'];

function toNumber(s) {
  return Number(s.replace(/,/g, ''));
}

// Airbnbのページ構造は頻繁に変わるため、テキスト全体からの正規表現抽出をベストエフォートで行う。
export function parsePriceFromText(rawText) {
  const text = rawText.replace(/\s+/g, ' ');

  const isUnavailable = UNAVAILABLE_PATTERNS.some((p) => text.includes(p));
  const isNotFound = NOT_FOUND_PATTERNS.some((p) => text.includes(p));

  // チェックイン/チェックアウト指定時の実際の表示形式: "¥132,644 JPY （2泊）"
  // 割引時は間に「料金の内訳を表示」等のUI文言が挟まるため、¥を含まない範囲で柔軟に許容する
  const totalMatch =
    text.match(/¥\s?([\d,]+)\s*JPY[^¥]{0,40}?[（(]\s*\d+\s*泊\s*[）)]/) ||
    text.match(/合計\s*[:：]?\s*¥\s?([\d,]+)/) ||
    text.match(/¥\s?([\d,]+)\s*合計/) ||
    text.match(/Total\s*¥\s?([\d,]+)/i);

  const perNightMatch =
    text.match(/¥\s?([\d,]+)\s*\/\s*泊/) || text.match(/¥\s?([\d,]+)\s*泊\b/);

  return {
    isUnavailable,
    isNotFound,
    totalPrice: totalMatch ? toNumber(totalMatch[1]) : null,
    perNightPrice: perNightMatch ? toNumber(perNightMatch[1]) : null,
  };
}
