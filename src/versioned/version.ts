import type { VersionContext, VersionPredicate } from './types.ts';
import { compareVersion } from './helpers.ts';

/**
 * Version predicates.
 *
 * @author dafengzhen
 */
export const Version = {
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

  not:
    (predicate: VersionPredicate): VersionPredicate =>
    async (ctx) =>
      !(await predicate(ctx)),

  custom: (predicate: VersionPredicate): VersionPredicate => predicate,

  env:
    (env: VersionContext['env']): VersionPredicate =>
    (ctx) =>
      ctx.env === env,

  platform:
    (platform: VersionContext['platform']): VersionPredicate =>
    (ctx) =>
      ctx.platform === platform,

  eq:
    (v: string): VersionPredicate =>
    (ctx) =>
      compareVersion(ctx.version, v) === 0,

  gt:
    (v: string): VersionPredicate =>
    (ctx) =>
      compareVersion(ctx.version, v) > 0,

  gte:
    (v: string): VersionPredicate =>
    (ctx) =>
      compareVersion(ctx.version, v) >= 0,

  lt:
    (v: string): VersionPredicate =>
    (ctx) =>
      compareVersion(ctx.version, v) < 0,

  lte:
    (v: string): VersionPredicate =>
    (ctx) =>
      compareVersion(ctx.version, v) <= 0,

  between:
    (min: string, max: string): VersionPredicate =>
    (ctx) => {
      const v = ctx.version;
      return compareVersion(v, min) >= 0 && compareVersion(v, max) <= 0;
    },
} as const;
