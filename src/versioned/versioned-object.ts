import type {
  AsyncCacheEntry,
  CacheEntry,
  VersionContext,
  VersionedObjectOptions,
  VersionRule,
} from './types.ts';

import { defaultCacheKey, getPriority, isPromise } from './helpers.ts';
import {
  AsyncPredicateError,
  AsyncRuleValueError,
  InvalidContextError,
  InvalidRuleError,
} from './version-error.ts';

type RequiredOptions<T extends object> = Required<VersionedObjectOptions<T>>;

const ruleSort = <T extends object>(a: VersionRule<T>, b: VersionRule<T>) => {
  return getPriority(b) - getPriority(a);
};

/**
 * VersionedObject.
 *
 * @author dafengzhen
 */
export class VersionedObject<T extends object> {
  private readonly asyncCache = new Map<string, AsyncCacheEntry<T>>();

  private readonly syncCache = new Map<string, CacheEntry<T>>();

  private readonly base: T;

  private readonly options: RequiredOptions<T>;

  private readonly rules: readonly VersionRule<T>[];

  constructor(
    base: T,
    rules: readonly VersionRule<T>[] = [],
    options: VersionedObjectOptions<T> = {},
  ) {
    this.base = base;
    this.rules = [...rules].sort(ruleSort);
    this.options = {
      cache: options.cache ?? true,
      cacheKey: options.cacheKey ?? defaultCacheKey,
      cacheTTL: options.cacheTTL ?? Infinity,
      defaultContext: options.defaultContext ?? { version: 'default' },
      freeze: options.freeze ?? false,
      maxCacheSize: options.maxCacheSize ?? 100,
      strictMode: options.strictMode ?? false,
    };
  }

  addRule(rule: VersionRule<T>): VersionedObject<T> {
    this.validateRule(rule);
    return new VersionedObject(this.base, [...this.rules, rule], this.options);
  }

  addRules(rules: VersionRule<T>[]): VersionedObject<T> {
    rules.forEach((r) => this.validateRule(r));
    return new VersionedObject(this.base, [...this.rules, ...rules], this.options);
  }

  clearCache(): VersionedObject<T> {
    return new VersionedObject(this.base, this.rules, this.options);
  }

  clone(): VersionedObject<T> {
    return new VersionedObject(this.base, this.rules, { ...this.options });
  }

  async explain(ctx?: VersionContext): Promise<{ base: T; matched: VersionRule<T>[]; result: T }> {
    const realCtx = this.getContext(ctx);
    this.validateContext(realCtx);

    const matched = await this.matchRulesAsync(realCtx);
    const result = await this.applyRulesAsync(matched);
    return { base: this.base, matched, result };
  }

  getCacheStats() {
    const sumHits = <E extends { hits: number }>(m: Map<any, E>) =>
      [...m.values()].reduce((s, e) => s + e.hits, 0);

    return {
      async: { hits: sumHits(this.asyncCache), size: this.asyncCache.size },
      sync: { hits: sumHits(this.syncCache), size: this.syncCache.size },
    };
  }

  getRuleCount(): number {
    return this.rules.length;
  }

  resolve(ctx?: VersionContext): T {
    const realCtx = this.getContext(ctx);
    this.validateContext(realCtx);

    const key = this.options.cacheKey(realCtx);

    if (this.options.cache) {
      const cached = this.getFromSyncCache(key);
      if (cached !== undefined) {
        this.syncCache.get(key)!.hits++;
        return cached;
      }
    }

    const matched = this.matchRulesSync(realCtx);
    const result = this.applyRulesSync(matched);

    this.saveSyncCache(key, result);
    return result;
  }

  async resolveAsync(ctx?: VersionContext): Promise<T> {
    const realCtx = this.getContext(ctx);
    this.validateContext(realCtx);

    const key = this.options.cacheKey(realCtx);

    if (this.options.cache) {
      const cached = this.getFromAsyncCache(key);
      if (cached) {
        cached.hits++;
        return cached.promise;
      }
    }

    const task = (async () => {
      const matched = await this.matchRulesAsync(realCtx);
      return this.applyRulesAsync(matched);
    })();

    if (this.options.cache) {
      this.asyncCache.set(key, { hits: 0, promise: task, timestamp: Date.now() });
      this.trimCache(this.asyncCache);
    }

    return task;
  }

  withOptions(options: Partial<VersionedObjectOptions<T>>): VersionedObject<T> {
    return new VersionedObject(this.base, this.rules, { ...this.options, ...options });
  }

  private async applyRulesAsync(rules: VersionRule<T>[]): Promise<T> {
    const result = { ...this.base };

    for (const rule of rules) {
      Object.assign(result, await rule.value);
    }

    return this.options.freeze ? Object.freeze(result) : result;
  }

  private applyRulesSync(rules: VersionRule<T>[]): T {
    const result = { ...this.base };

    for (const rule of rules) {
      if (isPromise(rule.value)) {
        throw new AsyncRuleValueError();
      }
      Object.assign(result, rule.value);
    }

    return this.options.freeze ? Object.freeze(result) : result;
  }

  private getContext(ctx?: VersionContext): VersionContext {
    const resolved = ctx ?? this.options.defaultContext;
    if (!resolved) {
      throw new InvalidContextError('Context is required. Provide ctx or defaultContext.');
    }
    return resolved;
  }

  private getFromSyncCache(key: string): T | undefined {
    const entry = this.syncCache.get(key);
    if (!entry) {
      return;
    }

    if (Date.now() - entry.timestamp > this.options.cacheTTL) {
      this.syncCache.delete(key);
      return;
    }

    return entry.value;
  }

  private getFromAsyncCache(key: string): AsyncCacheEntry<T> | undefined {
    const entry = this.asyncCache.get(key);
    if (!entry) {
      return;
    }

    if (Date.now() - entry.timestamp > this.options.cacheTTL) {
      this.asyncCache.delete(key);
      return;
    }

    return entry;
  }

  private async matchRulesAsync(ctx: VersionContext): Promise<VersionRule<T>[]> {
    const matched: VersionRule<T>[] = [];
    for (const rule of this.rules) {
      if (await rule.when(ctx)) {
        matched.push(rule);
      }
    }
    return matched;
  }

  private matchRulesSync(ctx: VersionContext): VersionRule<T>[] {
    const matched: VersionRule<T>[] = [];

    for (const rule of this.rules) {
      const res = rule.when(ctx);
      if (isPromise(res)) {
        throw new AsyncPredicateError();
      }
      if (res) {
        matched.push(rule);
      }
    }

    return matched;
  }

  private saveSyncCache(key: string, value: T): void {
    if (!this.options.cache) {
      return;
    }

    this.syncCache.set(key, { hits: 0, timestamp: Date.now(), value });
    this.trimCache(this.syncCache);
  }

  private trimCache<K, V extends { hits: number; timestamp: number }>(map: Map<K, V>): void {
    const excess = map.size - this.options.maxCacheSize;
    if (excess <= 0) {
      return;
    }

    const entries = [...map.entries()].sort(
      ([, a], [, b]) => a.hits - b.hits || a.timestamp - b.timestamp,
    );

    for (let i = 0; i < excess; i++) {
      map.delete(entries[i][0]);
    }
  }

  private validateContext(ctx: VersionContext): void {
    if (!ctx || typeof ctx !== 'object') {
      throw new InvalidContextError('Context must be an object.');
    }

    if (!('version' in ctx) || !ctx.version) {
      throw new InvalidContextError('Context must include a version.');
    }

    if (this.options.strictMode) {
      const invalid = Object.keys(ctx).filter((k) => k.startsWith('$'));
      if (invalid.length) {
        console.warn(`Reserved context keys: ${invalid.join(', ')}`);
      }
    }
  }

  private validateRule(rule: VersionRule<T>): void {
    if (!rule || typeof rule !== 'object') {
      throw new InvalidRuleError('Rule must be an object.');
    }
    if (typeof rule.when !== 'function') {
      throw new InvalidRuleError('Rule must define when().');
    }
    if (rule.value === undefined) {
      throw new InvalidRuleError('Rule must define value.');
    }
    if (rule.priority !== undefined && !Number.isInteger(rule.priority)) {
      throw new InvalidRuleError('Rule priority must be an integer.');
    }
  }
}
