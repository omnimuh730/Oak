import { readControlValue } from './read-control-value';

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeLoose(text: string): string {
  return normalize(text).replace(/[^\p{L}\p{N}+]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** True when the live control already shows the intended answer (autofill / prior fill). */
export function controlAlreadyMatches(
  el: Element,
  intended: string | null | undefined,
  opts?: { fileName?: string | null },
): { matched: boolean; current: string } {
  const current = readControlValue(el);

  if (el instanceof HTMLInputElement && el.type === 'file') {
    if (!current) return { matched: false, current };
    const want = opts?.fileName?.trim();
    if (!want) return { matched: true, current };
    return {
      matched: normalize(current) === normalize(want) || normalize(current).includes(normalize(want)),
      current,
    };
  }

  if (intended == null || !String(intended).trim()) {
    return { matched: false, current };
  }

  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    const wantChecked = /^(true|yes|1|on|checked)$/i.test(String(intended).trim());
    const isChecked = el.checked;
    return { matched: isChecked === wantChecked, current: String(isChecked) };
  }

  const want = normalize(String(intended));
  const have = normalize(current);
  if (!have) return { matched: false, current };
  if (have === want) return { matched: true, current };

  const wantLoose = normalizeLoose(String(intended));
  const haveLoose = normalizeLoose(current);
  if (wantLoose && haveLoose && wantLoose === haveLoose) {
    return { matched: true, current };
  }

  // Combobox / select often store a longer display label that still starts with the intent.
  if (want.length >= 2 && (have.startsWith(want) || want.startsWith(have))) {
    return { matched: true, current };
  }

  return { matched: false, current };
}
