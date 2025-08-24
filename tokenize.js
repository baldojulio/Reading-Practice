// Tokenizer and normalization for M1
import { doubleMetaphone } from "double-metaphone";

/**
 * Preprocess text to join hyphenated words split across line breaks
 * - Joins words like "under-\nstanding" → "understanding"
 * - Handles various hyphen types: -, –, —, −
 * 
 * Examples:
 * - "under-\nstanding" → "understanding"
 * - "co-\nordinate" → "coordinate"
 * - "self-\ncontained" → "selfcontained"
 * - "re-\nevaluate" → "reevaluate"
 */
function preprocessHyphenatedWords(text) {
  // Match hyphen + optional whitespace + line break + word continuation
  // This handles cases like "under-\nstanding", "co-\nordinate", etc.
  return text.replace(/([a-zA-Z])[-–—−]\s*\n\s*([a-zA-Z])/g, '$1$2');
}

/**
 * Normalize a word for matching/comparison
 * - lowercase
 * - strip surrounding punctuation
 * - collapse apostrophes/hyphens (simple heuristic for contractions)
 * - handle various Unicode apostrophes and dashes
 * 
 * Examples:
 * - "society's" → "societys"
 * - "co-operate" → "cooperate"
 * - "self–contained" → "selfcontained"
 * - "re—evaluate" → "reevaluate"
 * - "don't" → "dont"
 * - "mother-in-law" → "motherinlaw"
 */
export function normalizeWord(w) {
  if (!w) return "";
  const lower = w.toLowerCase();
  // Remove leading/trailing punctuation
  const stripped = lower.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  // Collapse various apostrophes and hyphens inside words
  // Handle: ', ', `, ´, -, –, —, −
  const collapsed = stripped.replace(/[''`´-–—−]/g, "");
  return collapsed;
}

/**
 * Tokenize text into an array of tokens preserving separators.
 * Tokens: { id, text, norm, isWord, status }
 * 
 * The tokenizer handles:
 * - Hyphenated words split across line breaks (joined during preprocessing)
 * - Various Unicode apostrophes and hyphens inside words
 * - Normalization for consistent matching
 */
export function tokenize(text) {
  const tokens = [];
  if (!text) return tokens;

  // Preprocess to join hyphenated words split across lines
  // This ensures "under-\nstanding" becomes a single token "understanding"
  const preprocessedText = preprocessHyphenatedWords(text);

  // Split on word boundaries but keep separators
  // Updated regex to handle various apostrophes and hyphens inside words
  // Match words (letters with optional internal apostrophes/hyphens) or numbers
  const re = /([\p{L}]+(?:[''`´-–—−][\p{L}]+)*|\d+)|([^\p{L}\d]+)/gu;
  let id = 0;
  let match;
  while ((match = re.exec(preprocessedText)) !== null) {
    const [full, word, sep] = match;
    if (word !== undefined) {
      const norm = normalizeWord(word);
      // Precompute phonetic codes (primary, secondary)
      let phonetic = ["", ""];
      try {
        const codes = doubleMetaphone(norm);
        if (Array.isArray(codes)) phonetic = [codes[0] || "", codes[1] || ""];
      } catch (_) {}
      tokens.push({ id: id++, text: word, norm, isWord: true, status: "pending", phonetic });
    } else if (sep !== undefined) {
      tokens.push({ id: id++, text: sep, norm: "", isWord: false, status: "sep" });
    }
  }
  return tokens;
}

export function firstWordIndex(tokens) {
  return tokens.findIndex(t => t.isWord);
}

export function nextWordIndex(tokens, fromIndex) {
  for (let i = fromIndex + 1; i < tokens.length; i++) {
    if (tokens[i].isWord) return i;
  }
  return -1;
}

export function prevWordIndex(tokens, fromIndex) {
  for (let i = fromIndex - 1; i >= 0; i--) {
    if (tokens[i].isWord) return i;
  }
  return -1;
}

export function resetWordStatuses(tokens) {
  for (const t of tokens) {
    if (t.isWord) t.status = "pending";
  }
}

/**
 * Compute sentence boundaries from tokens. Returns an array of
 * { id, startIndex, endIndex, preview } where indices are for token positions
 * and startIndex/endIndex are word-token indices (inclusive bounds).
 */
export function computeSentences(tokens) {
  const sentences = [];
  let currentStart = -1;
  let lastWordIdx = -1;
  const isEndSep = (text) => /[.!?]+|\n\s*\n/.test(text);
  const firstWordFrom = (from) => {
    for (let i = from; i < tokens.length; i++) if (tokens[i].isWord) return i;
    return -1;
  };
  const nextWordFrom = (from) => {
    for (let i = from + 1; i < tokens.length; i++) if (tokens[i].isWord) return i;
    return -1;
  };

  currentStart = firstWordFrom(0);
  let idx = currentStart;
  while (idx >= 0) {
    lastWordIdx = idx;
    // Advance until end sep or no more tokens
    let j = idx + 1;
    let ended = false;
    for (; j < tokens.length; j++) {
      const t = tokens[j];
      if (!t.isWord && isEndSep(t.text)) { ended = true; break; }
      if (t.isWord) lastWordIdx = j;
    }
    // Close sentence if we have words.
    if (currentStart >= 0 && lastWordIdx >= currentStart) {
      const preview = tokens
        .slice(currentStart, Math.min(tokens.length, lastWordIdx + 6))
        .filter(t => t.isWord)
        .slice(0, 8)
        .map(t => t.text)
        .join(' ');
      sentences.push({ id: sentences.length, startIndex: currentStart, endIndex: lastWordIdx, preview });
    }
    if (ended) {
      // Start next after this separator
      const startAfter = j + 1;
      currentStart = firstWordFrom(startAfter);
      idx = currentStart;
    } else {
      break; // reached end
    }
  }

  // If no explicit sentence ending, but we had words, ensure last sentence
  if (sentences.length === 0 && currentStart >= 0 && lastWordIdx >= currentStart) {
    const preview = tokens
      .slice(currentStart, Math.min(tokens.length, lastWordIdx + 6))
      .filter(t => t.isWord)
      .slice(0, 8)
      .map(t => t.text)
      .join(' ');
    sentences.push({ id: 0, startIndex: currentStart, endIndex: lastWordIdx, preview });
  }
  return sentences;
}
