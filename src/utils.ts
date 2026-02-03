/**
 * Check whether a value is a "plain object".
 *
 * A "plain object" here means a value whose internal `[[Class]]` tag equals
 * `"[object Object]"`, typically created by `{}`, `new Object()`, or with
 * a prototype chain that still identifies as `Object`.
 *
 * Notes:
 * - Arrays, functions, Dates, Maps/Sets, RegExps, and class instances are not plain objects.
 * - Objects created with `Object.create(null)` are **not** considered plain objects by this check
 *   because their tag is usually `"[object Object]"`? (It can vary; but in many engines it still is
 *   `"[object Object]"` even with null-prototype. If you rely on that distinction, test your target runtime.)
 *
 * @param v - Any value.
 * @returns `true` if `v` is a plain object, otherwise `false`.
 *
 * @example
 * isPlainObject({ a: 1 }) // true
 * isPlainObject([]) // false
 * isPlainObject(new Date()) // false
 */
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  Object.prototype.toString.call(v) === '[object Object]';

/**
 * Compare two version strings in the form "MAJOR[.MINOR][.PATCH][-SUFFIX]".
 *
 * Behavior:
 * - Ignores any pre-release/build suffix by cutting at the first `-`
 *   (e.g. "1.2.3-beta.1" is treated as "1.2.3").
 * - Accepts 1 to 3 dot-separated numeric segments; missing segments are treated as 0:
 *   - "1"      -> [1, 0, 0]
 *   - "1.2"    -> [1, 2, 0]
 *   - "1.2.3"  -> [1, 2, 3]
 * - All segments must be non-negative integers (no "+", "-", spaces, or decimals).
 *
 * Return value:
 * - `< 0` if `a < b`
 * - `= 0` if `a == b`
 * - `> 0` if `a > b`
 *
 * @param a - Version string A.
 * @param b - Version string B.
 * @returns A signed number representing ordering (`a - b` in lexicographic numeric order).
 *
 * @throws Error If `a` or `b` is empty/whitespace.
 * @throws Error If either version has an invalid format (wrong segment count, non-numeric, negative, etc.).
 *
 * @example
 * compareVersion("1", "1.0.0") // 0
 * compareVersion("1.2", "1.2.3") // -3 (negative => a < b)
 * compareVersion("2.0.0-alpha", "1.9.9") // > 0 (suffix ignored)
 */
export const compareVersion = (a: string, b: string): number => {
  if (!a.trim() || !b.trim()) {
    throw new Error(`compareVersion: version string cannot be empty (received a="${a}", b="${b}")`);
  }

  const normalize = (v: string): [number, number, number] => {
    const main = v.split('-', 1)[0].trim();
    const segs = main.split('.');

    if (segs.length < 1 || segs.length > 3) {
      throw new Error(
        `compareVersion: invalid version "${v}". Expected format MAJOR[.MINOR][.PATCH]`,
      );
    }

    const nums = segs.map((s) => {
      if (s === '') {
        throw new Error(`compareVersion: invalid version "${v}". Empty segment detected`);
      }

      if (!/^\d+$/.test(s)) {
        throw new Error(
          `compareVersion: invalid version "${v}". Segment "${s}" is not a non-negative integer`,
        );
      }

      const n = Number(s);

      if (!Number.isSafeInteger(n) || n < 0) {
        throw new Error(
          `compareVersion: invalid version "${v}". Segment "${s}" must be a safe non-negative integer`,
        );
      }

      return n;
    });

    while (nums.length < 3) {
      nums.push(0);
    }

    return [nums[0], nums[1], nums[2]];
  };

  const pa = normalize(a);
  const pb = normalize(b);

  if (pa[0] !== pb[0]) {
    return pa[0] - pb[0];
  }

  if (pa[1] !== pb[1]) {
    return pa[1] - pb[1];
  }

  return pa[2] - pb[2];
};

/**
 * Check whether a value is "thenable" (Promise-like), and narrow it to `Promise<T>`.
 *
 * This is a lightweight runtime check:
 * - `v` is truthy
 * - `typeof v.then === 'function'`
 *
 * Caveat:
 * - This treats any thenable as a Promise, even if it is not a real native `Promise`.
 *
 * @param v - Any value.
 * @returns `true` if `v` is promise-like, otherwise `false`.
 *
 * @example
 * isPromise(Promise.resolve(1)) // true
 * isPromise({ then() {} }) // true (thenable)
 * isPromise(null) // false
 */
export const isPromise = <T>(v: any): v is Promise<T> => !!v && typeof v.then === 'function';

/**
 * Create a "stable" version of a JSON-like value by:
 * - Recursively processing arrays and plain objects
 * - Sorting plain object keys in ascending lexicographic order
 * - Removing object fields whose values are `null` or `undefined`
 *
 * This is commonly used to make objects deterministic for:
 * - stable JSON stringification / hashing
 * - snapshot testing
 *
 * Rules:
 * - Arrays: order is preserved; each element is stabilized.
 * - Plain objects: keys are sorted; values are stabilized; `null/undefined` fields are omitted.
 * - Other values (Date, Map, Set, class instances, functions, primitives): returned as-is.
 *
 * @param v - Any value (typically JSON-like).
 * @returns A new stabilized structure for arrays/plain objects; otherwise returns the original value.
 *
 * @example
 * stable({ b: 1, a: 2 }) // { a: 2, b: 1 }
 * stable({ a: null, b: undefined, c: 1 }) // { c: 1 }
 * stable([{ z: 1, a: 2 }]) // [{ a: 2, z: 1 }]
 */
export const stable = (v: any): any => {
  if (Array.isArray(v)) {
    return v.map(stable);
  }

  if (isPlainObject(v)) {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) {
      const val = (v as Record<string, any>)[k];
      if (val !== null && val !== undefined) {
        out[k] = stable(val);
      }
    }
    return out;
  }

  return v;
};

/**
 * Compute a fast deterministic unsigned 32-bit hash for a string.
 *
 * This function uses a classic polynomial rolling hash algorithm:
 *
 *   hash = hash * 31 + charCode
 *
 * Key characteristics:
 * - Deterministic: identical input always produces the same hash
 * - Fast: runs in O(n) time where n is string length
 * - Produces an unsigned 32-bit integer (`0 ~ 2^32 - 1`)
 *
 * Implementation details:
 * - `| 0` forces intermediate results into a signed 32-bit integer range
 * - `>>> 0` converts the final value into an unsigned 32-bit integer
 *
 * Limitations:
 * - Not cryptographically secure
 * - Hash collisions are possible
 * - Intended only for lightweight internal hashing (e.g. caching, bucketing)
 *
 * Typical use cases:
 * - Stable map keys
 * - Cache identifiers
 * - Sharding/bucketing strings into numeric ranges
 *
 * @param str - Input string to hash.
 * @returns Unsigned 32-bit hash value.
 *
 * @example
 * hash("hello") // => 99162322
 * hash("world") // => different number
 *
 * @example
 * // Same input always yields the same output
 * hash("abc") === hash("abc") // true
 */
export const hash = (str: string): number => {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
};
