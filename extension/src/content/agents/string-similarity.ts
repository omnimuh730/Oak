/** Minimum similarity (0–1) required to accept a non-exact combobox option match. */
export const OPTION_SIMILARITY_THRESHOLD = 0.9;

function tokensOf(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * True when `option` contains all tokens of `target` as a contiguous run but also
 * has extra tokens (e.g. "Pacific University" ⊂ "Alaska Pacific University").
 * Those are not safe local matches — keep typing / AI-match instead.
 */
export function isProperTokenExtension(target: string, option: string): boolean {
  const want = tokensOf(target);
  const have = tokensOf(option);
  if (!want.length || have.length <= want.length) return false;
  for (let i = 0; i <= have.length - want.length; i++) {
    if (want.every((tok, j) => have[i + j] === tok)) return true;
  }
  return false;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Classic edit-distance DP matrix. */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i++) matrix[i][0] = i;
  for (let j = 0; j < cols; j++) matrix[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

/** 1 - distance / max(len). */
export function levenshteinSimilarity(a: string, b: string): number {
  const left = normalize(a);
  const right = normalize(b);
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  const maxLen = Math.max(left.length, right.length);
  if (!maxLen) return 1;
  return 1 - levenshteinDistance(left, right) / maxLen;
}

/** Sørensen–Dice coefficient on character bigrams. */
export function diceBigramSimilarity(a: string, b: string): number {
  const left = normalize(a);
  const right = normalize(b);
  if (!left && !right) return 1;
  if (left.length < 2 || right.length < 2) {
    return left === right ? 1 : 0;
  }

  const bigrams = (text: string): Map<string, number> => {
    const map = new Map<string, number>();
    for (let i = 0; i < text.length - 1; i++) {
      const gram = text.slice(i, i + 2);
      map.set(gram, (map.get(gram) || 0) + 1);
    }
    return map;
  };

  const aMap = bigrams(left);
  const bMap = bigrams(right);
  let overlap = 0;
  for (const [gram, count] of aMap) {
    const other = bMap.get(gram);
    if (other) overlap += Math.min(count, other);
  }
  const total = left.length - 1 + (right.length - 1);
  return total === 0 ? 0 : (2 * overlap) / total;
}

function tokenSortKey(text: string): string {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

/**
 * Best of full-string Levenshtein, token-sorted Levenshtein, and bigram Dice.
 * Suited for near-paraphrases like "I do not wish to answer" ≈ "I do not want to answer".
 */
export function stringSimilarity(a: string, b: string): number {
  const full = levenshteinSimilarity(a, b);
  const sorted = levenshteinSimilarity(tokenSortKey(a), tokenSortKey(b));
  const dice = diceBigramSimilarity(a, b);
  return Math.max(full, sorted, dice);
}

export function bestSimilarityMatch<T>(
  target: string,
  candidates: T[],
  getText: (item: T) => string,
  threshold: number = OPTION_SIMILARITY_THRESHOLD,
): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null;
  for (const item of candidates) {
    const text = getText(item);
    if (isProperTokenExtension(target, text)) continue;
    const score = stringSimilarity(target, text);
    if (score < threshold) continue;
    if (!best || score > best.score) best = { item, score };
  }
  return best;
}
