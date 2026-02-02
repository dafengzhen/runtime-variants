import { describe, expect, test } from '@jest/globals';

import { compareVersion } from './helpers.ts';
import { InvalidVersionError } from './version-error.ts';
import { Version } from './version.ts';

/**
 * compareVersion.
 *
 * @author dafengzhen
 */
describe('compareVersion', () => {
  test('throws on empty version', () => {
    expect(() => compareVersion('', '1.0.0')).toThrow(InvalidVersionError);
    expect(() => compareVersion('1.0.0', '')).toThrow(InvalidVersionError);
  });

  test('throws on invalid numeric parts', () => {
    expect(() => compareVersion('1.a.0', '1.0.0')).toThrow(InvalidVersionError);
    expect(compareVersion('1.2.3.4', '1.2.3')).toBe(0);
  });

  test('treats "-..." as prerelease suffix and ignores it', () => {
    expect(() => compareVersion('1.-1.0', '1.0.0')).not.toThrow();
    expect(compareVersion('1.-1.0', '1.0.0')).toBe(0);
  });

  test('pads missing parts to 3 segments', () => {
    expect(compareVersion('1', '1.0.0')).toBe(0);
    expect(compareVersion('1.2', '1.2.0')).toBe(0);
    expect(compareVersion('1.2', '1.2.1')).toBeLessThan(0);
  });

  test('ignores prerelease suffix after "-"', () => {
    expect(compareVersion('1.2.3-alpha', '1.2.3')).toBe(0);
    expect(compareVersion('1.2.4-beta', '1.2.3')).toBeGreaterThan(0);
  });

  test('compares lexicographically by major/minor/patch', () => {
    expect(compareVersion('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersion('1.10.0', '1.2.9')).toBeGreaterThan(0);
    expect(compareVersion('1.2.3', '1.2.4')).toBeLessThan(0);
  });
});

/**
 * Version predicates.
 *
 * @author dafengzhen
 */
describe('Version predicates', () => {
  const baseCtx = { env: 'prod' as const, platform: 'ios' as const, version: '1.2.3' };

  test('eq / gt / gte / lt / lte', () => {
    expect(Version.eq('1.2.3')(baseCtx)).toBe(true);
    expect(Version.gt('1.2.2')(baseCtx)).toBe(true);
    expect(Version.gte('1.2.3')(baseCtx)).toBe(true);
    expect(Version.lt('2.0.0')(baseCtx)).toBe(true);
    expect(Version.lte('1.2.3')(baseCtx)).toBe(true);

    expect(Version.eq('1.2.4')(baseCtx)).toBe(false);
    expect(Version.gt('1.2.3')(baseCtx)).toBe(false);
    expect(Version.lt('1.2.3')(baseCtx)).toBe(false);
  });

  test('between is inclusive', () => {
    expect(Version.between('1.0.0', '2.0.0')(baseCtx)).toBe(true);
    expect(Version.between('1.2.3', '1.2.3')(baseCtx)).toBe(true);
    expect(Version.between('1.2.4', '2.0.0')(baseCtx)).toBe(false);
  });

  test('env / platform', () => {
    expect(Version.env('prod')(baseCtx)).toBe(true);
    expect(Version.env('dev')(baseCtx)).toBe(false);

    expect(Version.platform('ios')(baseCtx)).toBe(true);
    expect(Version.platform('android')(baseCtx)).toBe(false);
  });

  test('not()', async () => {
    const p = Version.not(Version.eq('1.2.3'));
    await expect(p(baseCtx)).resolves.toBe(false);

    const asyncPred = Version.not(async (ctx) => ctx.env === 'prod');
    await expect(asyncPred(baseCtx)).resolves.toBe(false);
  });

  test('and() works with sync + async predicates (short-circuit false)', async () => {
    const p = Version.and(
      Version.gte('1.0.0'),
      async (ctx) => ctx.platform === 'ios',
      Version.lt('1.0.0'), // false
      async () => {
        throw new Error('should not run');
      },
    );

    await expect(p(baseCtx)).resolves.toBe(false);
  });

  test('or() works with sync + async predicates (short-circuit true)', async () => {
    const p = Version.or(
      Version.lt('1.0.0'), // false
      async (ctx) => ctx.env === 'prod', // true
      async () => {
        throw new Error('should not run');
      },
    );

    await expect(p(baseCtx)).resolves.toBe(true);
  });

  test('custom() returns the predicate as-is', async () => {
    const pred = Version.custom(async (ctx) => ctx.version === '1.2.3');
    await expect(pred(baseCtx)).resolves.toBe(true);
  });
});
