// Minimal ESM wrapper that exposes a `get(a, b)` function
// using the ESM build of `fastest-levenshtein`, which is a dependency of fast-levenshtein.
export { distance as get } from '../node_modules/fastest-levenshtein/esm/mod.js';

