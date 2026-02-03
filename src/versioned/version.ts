import type { VersionContext, VersionPredicate } from './types.ts';
import { compareVersion } from '../utils.ts';

/**
 * A collection of composable predicates for version-based filtering.
 *
 * These helpers allow you to build flexible conditions on:
 * - runtime environment
 * - platform type
 * - semantic version comparisons
 *
 * Each predicate receives a {@link VersionContext} and returns a boolean
 * (or Promise<boolean>) indicating whether the condition matches.
 *
 * @example
 * ```ts
 * const predicate = Version.and(
 *   Version.env('prod'),
 *   Version.gte('1.2.0'),
 *   Version.in('1.2.0', '1.2.1', '1.3.0')
 * );
 *
 * if (await predicate(ctx)) {
 *   console.log('matched');
 * }
 * ```
 *
 * @author dafengzhen
 */
export const Version = {
  /**
   * Combines multiple predicates using logical AND.
   * Returns true only if **all** predicates match.
   *
   * Predicates are evaluated sequentially and may be async.
   *
   * @param predicates - List of predicates to combine.
   * @returns A new predicate representing the AND condition.
   */
  and:
    (...predicates: VersionPredicate[]): VersionPredicate =>
    async (ctx) => {
      for (const p of predicates) {
        if (!(await p(ctx))) {
          return false;
        }
      }
      return true;
    },

  /**
   * Combines multiple predicates using logical OR.
   * Returns true if **any** predicate matches.
   *
   * Predicates are evaluated sequentially and may be async.
   *
   * @param predicates - List of predicates to combine.
   * @returns A new predicate representing the OR condition.
   */
  or:
    (...predicates: VersionPredicate[]): VersionPredicate =>
    async (ctx) => {
      for (const p of predicates) {
        if (await p(ctx)) {
          return true;
        }
      }
      return false;
    },

  /**
   * Negates a predicate using logical NOT.
   *
   * @param predicate - Predicate to invert.
   * @returns A predicate returning the opposite result.
   */
  not:
    (predicate: VersionPredicate): VersionPredicate =>
    async (ctx) =>
      !(await predicate(ctx)),

  /**
   * Wraps a custom predicate directly.
   *
   * Useful as an explicit API for user-defined rules.
   *
   * @param predicate - Custom predicate implementation.
   * @returns The same predicate.
   */
  custom: (predicate: VersionPredicate): VersionPredicate => predicate,

  /**
   * Alias of {@link Version.custom}.
   *
   * "match" reads more naturally when used as:
   * `Version.match(ctx => ...)`.
   *
   * @param predicate - Custom predicate implementation.
   * @returns The same predicate.
   */
  match: (predicate: VersionPredicate): VersionPredicate => predicate,

  /**
   * Matches when the context environment equals the specified value.
   *
   * @param env - Target environment (e.g. "prod", "dev").
   * @returns Predicate checking environment equality.
   */
  env:
    (env: VersionContext['env']): VersionPredicate =>
    (ctx) =>
      ctx.env === env,

  /**
   * Matches when the context platform equals the specified platform.
   *
   * @param platform - Target platform identifier.
   * @returns Predicate checking platform equality.
   */
  platform:
    (platform: VersionContext['platform']): VersionPredicate =>
    (ctx) =>
      ctx.platform === platform,

  /**
   * Matches when the current version is exactly equal to `v`.
   *
   * @param v - Version string to compare.
   * @returns Predicate checking version equality.
   */
  eq:
    (v: string): VersionPredicate =>
    (ctx) =>
      compareVersion(ctx.version, v) === 0,

  /**
   * Matches when the current version is strictly greater than `v`.
   *
   * @param v - Minimum version (exclusive).
   * @returns Predicate checking version > v.
   */
  gt:
    (v: string): VersionPredicate =>
    (ctx) =>
      compareVersion(ctx.version, v) > 0,

  /**
   * Matches when the current version is greater than or equal to `v`.
   *
   * @param v - Minimum version (inclusive).
   * @returns Predicate checking version ≥ v.
   */
  gte:
    (v: string): VersionPredicate =>
    (ctx) =>
      compareVersion(ctx.version, v) >= 0,

  /**
   * Matches when the current version is strictly less than `v`.
   *
   * @param v - Maximum version (exclusive).
   * @returns Predicate checking version < v.
   */
  lt:
    (v: string): VersionPredicate =>
    (ctx) =>
      compareVersion(ctx.version, v) < 0,

  /**
   * Matches when the current version is less than or equal to `v`.
   *
   * @param v - Maximum version (inclusive).
   * @returns Predicate checking version ≤ v.
   */
  lte:
    (v: string): VersionPredicate =>
    (ctx) =>
      compareVersion(ctx.version, v) <= 0,

  /**
   * Matches when the current version falls within the inclusive range:
   *
   * `min <= version <= max`
   *
   * @param min - Minimum version (inclusive).
   * @param max - Maximum version (inclusive).
   * @returns Predicate checking version range.
   */
  between:
    (min: string, max: string): VersionPredicate =>
    (ctx) => {
      const v = ctx.version;
      return compareVersion(v, min) >= 0 && compareVersion(v, max) <= 0;
    },

  /**
   * Matches when the current version equals **any** of the provided versions.
   *
   * This is equivalent to:
   * `Version.or(...versions.map(Version.eq))`
   *
   * @param versions - Accepted version list.
   * @returns Predicate checking version membership.
   */
  in:
    (...versions: string[]): VersionPredicate =>
    (ctx) => {
      for (const v of versions) {
        if (compareVersion(ctx.version, v) === 0) {
          return true;
        }
      }
      return false;
    },
} as const;
