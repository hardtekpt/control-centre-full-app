/**
 * Normalizes monitor input values for matching and display logic.
 */
export function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function inputTokens(value: string | null | undefined): string[] {
  const raw = normalizeText(value);
  if (!raw) {
    return [];
  }
  const compact = raw.replace(/[\s_]+/g, "");
  const tokens = new Set<string>([raw, compact]);
  const hexPrefixed = compact.match(/^0x([0-9a-f]+)$/);
  if (hexPrefixed) {
    const hex = hexPrefixed[1].replace(/^0+/, "") || "0";
    tokens.add(`hex:${hex}`);
    tokens.add(`num:${parseInt(hex, 16)}`);
  }
  if (/^[0-9a-f]+$/.test(compact)) {
    const hex = compact.replace(/^0+/, "") || "0";
    tokens.add(`hex:${hex}`);
    tokens.add(`num:${parseInt(hex, 16)}`);
  }
  if (/^\d+$/.test(compact)) {
    tokens.add(`num:${parseInt(compact, 10)}`);
  }
  return [...tokens];
}

/**
 * Compares monitor input source values using numeric, hex, and literal forms.
 */
export function sameInputSource(a: string | null | undefined, b: string | null | undefined): boolean {
  const tokensA = inputTokens(a);
  const tokensB = new Set(inputTokens(b));
  if (tokensA.length === 0 || tokensB.size === 0) {
    return false;
  }
  return tokensA.some((token) => tokensB.has(token));
}

/**
 * Resolves a display label for an input source code from the configured name map.
 */
export function resolveInputName(inputCode: string, inputNameMap: Record<string, string>): string {
  const target = normalizeText(inputCode);
  if (!target) {
    return "";
  }
  for (const [key, value] of Object.entries(inputNameMap ?? {})) {
    if (normalizeText(key) === target) {
      return String(value ?? "").trim();
    }
  }
  return "";
}
