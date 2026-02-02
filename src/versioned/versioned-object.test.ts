import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import {
  AsyncPredicateError,
  AsyncRuleValueError,
  InvalidContextError,
  InvalidRuleError,
} from './version-error.ts';
import { Version } from './version.ts';
import { VersionedObject } from './versioned-object.ts';

type Obj = {
  a: number;
  b: string;
  c?: boolean;
};

/**
 * VersionedObject (sync resolve).
 *
 * @author dafengzhen
 */
describe('VersionedObject (sync resolve)', () => {
  test('applies matched rules in priority-desc order', () => {
    const base: Obj = { a: 1, b: 'base' };

    const vo = new VersionedObject<Obj>(base, [
      {
        priority: 1,
        value: { b: 'p1' },
        when: Version.gte('1.0.0'),
      },
      {
        priority: 10,
        value: { b: 'p10', c: true },
        when: Version.gte('1.0.0'),
      },
      {
        priority: 5,
        value: { b: 'should-not-apply' },
        when: Version.lt('1.0.0'),
      },
    ]);

    const res = vo.resolve({ env: 'prod', version: '1.2.3' });

    expect(res).toEqual({ a: 1, b: 'p1', c: true });
  });

  test('throws InvalidContextError when ctx is invalid', () => {
    const vo = new VersionedObject<Obj>({ a: 1, b: 'x' });

    expect(() => vo.resolve(null as any)).not.toThrow();

    expect(() => vo.resolve({} as any)).toThrow(InvalidContextError);

    expect(() => vo.resolve({ env: 'prod' } as any)).toThrow(InvalidContextError);
  });

  test('strictMode warns on reserved keys starting with "$"', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const vo = new VersionedObject<Obj>({ a: 1, b: 'x' }, [], { strictMode: true });

    vo.resolve({ $foo: 1, version: '1.0.0' } as any);
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
  });

  test('throws AsyncPredicateError when predicate returns a Promise in resolve()', () => {
    const vo = new VersionedObject<Obj>({ a: 1, b: 'x' }, [
      {
        value: { b: 'y' },
        when: async () => true,
      },
    ]);

    expect(() => vo.resolve({ version: '1.0.0' })).toThrow(AsyncPredicateError);
  });

  test('throws AsyncRuleValueError when rule.value is a Promise in resolve()', () => {
    const vo = new VersionedObject<Obj>({ a: 1, b: 'x' }, [
      {
        value: Promise.resolve({ b: 'y' }),
        when: () => true,
      },
    ]);

    expect(() => vo.resolve({ version: '1.0.0' })).toThrow(AsyncRuleValueError);
  });

  test('freeze option freezes returned object', () => {
    const vo = new VersionedObject<Obj>(
      { a: 1, b: 'x' },
      [{ value: { b: 'y' }, when: () => true }],
      { freeze: true },
    );

    const res = vo.resolve({ version: '1.0.0' });
    expect(Object.isFrozen(res)).toBe(true);
  });

  test('addRule / addRules validates rules', () => {
    const vo = new VersionedObject<Obj>({ a: 1, b: 'x' });

    expect(() => vo.addRule({ value: { b: 'y' }, when: 123 as any } as any)).toThrow(
      InvalidRuleError,
    );
    expect(() => vo.addRule({ value: undefined as any, when: () => true } as any)).toThrow(
      InvalidRuleError,
    );
    expect(() =>
      vo.addRule({ priority: 1.2 as any, value: { b: 'y' }, when: () => true } as any),
    ).toThrow(InvalidRuleError);

    expect(() =>
      vo.addRules([
        { value: { b: 'y' }, when: () => true },
        { value: { b: 'z' }, when: 'bad' as any } as any,
      ]),
    ).toThrow(InvalidRuleError);
  });

  test('withOptions returns a new instance with merged options', () => {
    const vo = new VersionedObject<Obj>({ a: 1, b: 'x' }, [], { cache: true, maxCacheSize: 100 });
    const vo2 = vo.withOptions({ cache: false });

    expect(vo).not.toBe(vo2);

    const ctx = { version: '1.0.0' };

    const r1 = vo2.resolve(ctx);
    const r2 = vo2.resolve(ctx);

    expect(r1).toEqual(r2);

    expect(vo2.getCacheStats().sync.size).toBe(0);
  });
});

/**
 * VersionedObject (sync cache).
 *
 * @author dafengzhen
 */
describe('VersionedObject (sync cache)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('sync cache hits increments and respects cacheTTL', () => {
    const now = jest.spyOn(Date, 'now');

    now.mockReturnValueOnce(0);

    const vo = new VersionedObject<Obj>(
      { a: 1, b: 'base' },
      [{ value: { b: 'v1' }, when: () => true }],
      {
        cache: true,
        cacheTTL: 1000,
      },
    );

    const ctx = { version: '1.0.0' };
    const r1 = vo.resolve(ctx);
    expect(r1.b).toBe('v1');
    expect(vo.getCacheStats().sync.size).toBe(1);
    expect(vo.getCacheStats().sync.hits).toBe(0);

    now.mockReturnValueOnce(500);
    const r2 = vo.resolve(ctx);
    expect(r2.b).toBe('v1');
    expect(vo.getCacheStats().sync.hits).toBe(1);

    now.mockReturnValueOnce(1501);
    const r3 = vo.resolve(ctx);
    expect(r3.b).toBe('v1');

    expect(vo.getCacheStats().sync.size).toBe(1);
  });

  test('maxCacheSize evicts lowest hits then oldest timestamp', () => {
    const now = jest.spyOn(Date, 'now');

    const vo = new VersionedObject<Obj>(
      { a: 1, b: 'base' },
      [{ value: { b: 'ok' }, when: () => true }],
      {
        cache: true,
        maxCacheSize: 2,
      },
    );

    now.mockReturnValueOnce(1);
    vo.resolve({ env: 'a', version: '1.0.0' });

    now.mockReturnValueOnce(2);
    vo.resolve({ env: 'b', version: '1.0.0' });

    now.mockReturnValueOnce(3);
    vo.resolve({ env: 'a', version: '1.0.0' });

    now.mockReturnValueOnce(4);
    vo.resolve({ env: 'c', version: '1.0.0' });

    expect(vo.getCacheStats().sync.size).toBe(2);

    const beforeHits = vo.getCacheStats().sync.hits;

    now.mockReturnValueOnce(5);
    vo.resolve({ env: 'b', version: '1.0.0' });

    expect(vo.getCacheStats().sync.hits).toBe(beforeHits);
  });
});

/**
 * VersionedObject (async resolveAsync).
 *
 * @author dafengzhen
 */
describe('VersionedObject (async resolveAsync)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('resolveAsync supports async predicate + async value', async () => {
    const vo = new VersionedObject<Obj>({ a: 1, b: 'base' }, [
      {
        value: Promise.resolve({ b: 'async' }),
        when: async (ctx) => ctx.env === 'prod',
      },
    ]);

    await expect(vo.resolveAsync({ env: 'prod', version: '1.0.0' })).resolves.toEqual({
      a: 1,
      b: 'async',
    });
    await expect(vo.resolveAsync({ env: 'dev', version: '1.0.0' })).resolves.toEqual({
      a: 1,
      b: 'base',
    });
  });

  test('async cache returns the same in-flight promise and increments hits on existing entry', async () => {
    const vo = new VersionedObject<Obj>(
      { a: 1, b: 'base' },
      [
        {
          value: new Promise((resolve) => setTimeout(() => resolve({ b: 'done' }), 10)),
          when: async () => true,
        },
      ],
      { cache: true },
    );

    const ctx = { version: '1.0.0' };

    const p1 = vo.resolveAsync(ctx);
    const p2 = vo.resolveAsync(ctx);

    expect(p2).toStrictEqual(p1);

    jest.advanceTimersByTime(20);
    await expect(p1).resolves.toEqual({ a: 1, b: 'done' });

    expect(vo.getCacheStats().async.size).toBe(1);
    expect(vo.getCacheStats().async.hits).toBeGreaterThanOrEqual(1);
  });

  test('explain() returns base/matched/result', async () => {
    const base: Obj = { a: 1, b: 'base' };
    const rules = [
      { priority: 1, value: { b: 'p1' }, when: Version.gte('1.0.0') },
      { priority: 2, value: { c: true }, when: Version.gte('1.0.0') },
      { priority: 0, value: { b: 'nope' }, when: Version.lt('1.0.0') },
    ] as const;

    const vo = new VersionedObject<Obj>(base, rules);

    const exp = await vo.explain({ version: '1.2.3' });
    expect(exp.base).toEqual(base);
    expect(exp.matched.length).toBe(2);
    expect(exp.result).toEqual({ a: 1, b: 'p1', c: true });
  });

  test('clearCache() returns a new instance with empty caches', async () => {
    const vo = new VersionedObject<Obj>(
      { a: 1, b: 'base' },
      [{ value: { b: 'x' }, when: () => true }],
      {
        cache: true,
      },
    );

    vo.resolve({ version: '1.0.0' });
    expect(vo.getCacheStats().sync.size).toBe(1);

    const vo2 = vo.clearCache();
    expect(vo2).not.toBe(vo);
    expect(vo2.getCacheStats().sync.size).toBe(0);

    await vo.resolveAsync({ version: '1.0.0' });
    expect(vo.getCacheStats().async.size).toBe(1);
    const vo3 = vo.clearCache();
    expect(vo3.getCacheStats().async.size).toBe(0);
  });

  test('clone() returns a new instance (same behavior)', async () => {
    const vo = new VersionedObject<Obj>(
      { a: 1, b: 'base' },
      [{ value: { b: 'x' }, when: Version.gte('1.0.0') }],
      {
        cache: true,
        maxCacheSize: 10,
      },
    );

    const vo2 = vo.clone();
    expect(vo2).not.toBe(vo);

    expect(vo2.resolve({ version: '1.0.0' })).toEqual({ a: 1, b: 'x' });
    await expect(vo2.resolveAsync({ version: '1.0.0' })).resolves.toEqual({ a: 1, b: 'x' });
  });
});
