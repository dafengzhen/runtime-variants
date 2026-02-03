import type {
  AsyncCacheEntry,
  CacheEntry,
  RequiredOptions,
  VersionContext,
  VersionedObjectOptions,
  VersionRule,
} from './types.ts';
import { isPromise, stable } from '../utils.ts';

/**
 * A small utility to produce a "versioned" object by applying a set of rules
 * to a base object under a given context.
 *
 * Rules are evaluated in descending `priority` order, and every matched rule's
 * `value` is shallow-merged into the result (later merges override earlier keys).
 *
 * Supports:
 * - **Sync resolve**: predicates and values must be sync
 * - **Async resolve**: predicates and/or values may be async
 * - **Caching** with TTL and LFU-ish eviction (hits, then timestamp)
 * - **Freeze** final result (optional)
 *
 * @author dafengzhen
 */
export class VersionedObject<T extends object> {
  /** Cache for async resolutions. */
  private readonly asyncCache = new Map<string, AsyncCacheEntry<T>>();

  /** Cache for sync resolutions. */
  private readonly syncCache = new Map<string, CacheEntry<T>>();

  /** Base object (never mutated). */
  private readonly base: T;

  /** Normalized options with defaults. */
  private readonly options: RequiredOptions<T>;

  /** Version rules sorted by priority (desc). */
  private readonly rules: readonly VersionRule<T>[];

  /**
   * Create a VersionedObject.
   *
   * @param base - The base object to start from (will be shallow-copied when resolving).
   * @param rules - Rules to apply. They will be sorted by `priority` (desc).
   * @param options - Behavior options (cache, TTL, key, freeze, etc.).
   */
  constructor(
    base: T,
    rules: readonly VersionRule<T>[] = [],
    options: VersionedObjectOptions<T> = {},
  ) {
    this.base = base;
    this.rules = [...rules].sort(this.ruleSort);
    this.options = {
      cache: options.cache ?? true,
      cacheKey: options.cacheKey ?? this.defaultCacheKey,
      cacheTTL: options.cacheTTL ?? Infinity,
      defaultContext: options.defaultContext ?? { version: 'default' },
      freeze: options.freeze ?? false,
      maxCacheSize: options.maxCacheSize ?? 100,
      strictMode: options.strictMode ?? false,
    };
  }

  /**
   * Return a new VersionedObject with a rule appended.
   *
   * @param rule - The rule to add.
   */
  addRule(rule: VersionRule<T>): VersionedObject<T> {
    this.validateRule(rule);
    return new VersionedObject(this.base, [...this.rules, rule], this.options);
  }

  /**
   * Return a new VersionedObject with rules appended.
   *
   * @param rules - Rules to add.
   */
  addRules(rules: VersionRule<T>[]): VersionedObject<T> {
    rules.forEach((r) => this.validateRule(r));
    return new VersionedObject(this.base, [...this.rules, ...rules], this.options);
  }

  /**
   * Return a new VersionedObject with empty caches (rules/options unchanged).
   */
  clearCache(): VersionedObject<T> {
    return new VersionedObject(this.base, this.rules, this.options);
  }

  /**
   * Clone the current VersionedObject (rules/options copied).
   */
  clone(): VersionedObject<T> {
    return new VersionedObject(this.base, this.rules, { ...this.options });
  }

  /**
   * Explain how a context is resolved (async).
   *
   * This will:
   * 1) Validate and normalize context
   * 2) Collect matched rules (async predicates allowed)
   * 3) Apply rule values (async values allowed)
   *
   * @param ctx - Context for rule matching. If omitted, uses `defaultContext`.
   * @returns Object containing base, matched rules, and final result.
   */
  async explain(ctx?: VersionContext): Promise<{ base: T; matched: VersionRule<T>[]; result: T }> {
    const realCtx = this.getContext(ctx);
    this.validateContext(realCtx);

    const matched = await this.matchRulesAsync(realCtx);
    const result = await this.applyRulesAsync(matched);
    return { base: this.base, matched, result };
  }

  /**
   * Get cache statistics (hits/size) for sync + async caches.
   */
  getCacheStats() {
    const sumHits = <E extends { hits: number }>(m: Map<any, E>) =>
      [...m.values()].reduce((s, e) => s + e.hits, 0);

    return {
      async: { hits: sumHits(this.asyncCache), size: this.asyncCache.size },
      sync: { hits: sumHits(this.syncCache), size: this.syncCache.size },
    };
  }

  /**
   * Get total number of rules.
   */
  getRuleCount(): number {
    return this.rules.length;
  }

  /**
   * Resolve synchronously.
   *
   * Requirements:
   * - `rule.when(ctx)` must be **sync** (boolean)
   * - `rule.value` must be **non-Promise**
   *
   * If caching is enabled, uses `cacheKey(ctx)` and returns cached result
   * when valid (within TTL).
   *
   * @param ctx - Context for rule matching. If omitted, uses `defaultContext`.
   * @throws {Error} If a predicate returns a Promise.
   * @throws {Error} If a matched rule's value is a Promise.
   */
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

  /**
   * Resolve asynchronously.
   *
   * Allows:
   * - async predicates: `await rule.when(ctx)`
   * - async values: `await rule.value`
   *
   * If caching is enabled, in-flight promises are cached too, so concurrent
   * requests for the same key share the same work.
   *
   * @param ctx - Context for rule matching. If omitted, uses `defaultContext`.
   */
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

  /**
   * Return a new VersionedObject with merged options.
   *
   * @param options - Partial options to override.
   */
  withOptions(options: Partial<VersionedObjectOptions<T>>): VersionedObject<T> {
    return new VersionedObject(this.base, this.rules, { ...this.options, ...options });
  }

  /**
   * Default cache key generator: stable JSON stringification of context.
   *
   * @param ctx - Context.
   */
  private defaultCacheKey(ctx?: VersionContext): string {
    if (!ctx) {
      return '__default__';
    }
    return JSON.stringify(stable(ctx));
  }

  /**
   * Get rule priority (defaults to 0).
   */
  private getPriority(r: VersionRule<any>) {
    return r.priority ?? 0;
  }

  /**
   * Sort rules by descending priority.
   */
  private ruleSort<T extends object>(a: VersionRule<T>, b: VersionRule<T>) {
    return this.getPriority(b) - this.getPriority(a);
  }

  /**
   * Apply rule values asynchronously (shallow merge).
   *
   * @param rules - Matched rules.
   */
  private async applyRulesAsync(rules: VersionRule<T>[]): Promise<T> {
    const result = { ...this.base };

    for (const rule of rules) {
      Object.assign(result, await rule.value);
    }

    return this.options.freeze ? Object.freeze(result) : result;
  }

  /**
   * Apply rule values synchronously (shallow merge).
   *
   * @param rules - Matched rules.
   * @throws {Error} If any rule value is a Promise.
   */
  private applyRulesSync(rules: VersionRule<T>[]): T {
    const result = { ...this.base };

    for (const rule of rules) {
      if (isPromise(rule.value)) {
        throw new Error(
          'Async rule value is not allowed in resolve(). Use resolveAsync() or ensure rule.value is synchronous.',
        );
      }
      Object.assign(result, rule.value);
    }

    return this.options.freeze ? Object.freeze(result) : result;
  }

  /**
   * Normalize context: uses provided ctx or `defaultContext`.
   *
   * @param ctx - Optional context.
   * @throws {Error} If neither ctx nor defaultContext is provided.
   */
  private getContext(ctx?: VersionContext): VersionContext {
    const resolved = ctx ?? this.options.defaultContext;
    if (!resolved) {
      throw new Error('Context is required. Provide ctx or defaultContext.');
    }
    return resolved;
  }

  /**
   * Read a valid (non-expired) entry from sync cache.
   */
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

  /**
   * Read a valid (non-expired) entry from async cache.
   */
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

  /**
   * Match rules asynchronously.
   *
   * @param ctx - Context.
   */
  private async matchRulesAsync(ctx: VersionContext): Promise<VersionRule<T>[]> {
    const matched: VersionRule<T>[] = [];
    for (const rule of this.rules) {
      if (await rule.when(ctx)) {
        matched.push(rule);
      }
    }
    return matched;
  }

  /**
   * Match rules synchronously.
   *
   * @param ctx - Context.
   * @throws {Error} If any predicate returns a Promise.
   */
  private matchRulesSync(ctx: VersionContext): VersionRule<T>[] {
    const matched: VersionRule<T>[] = [];

    for (const rule of this.rules) {
      const res = rule.when(ctx);
      if (isPromise(res)) {
        throw new Error(
          'Async predicate is not allowed in resolve(). Use resolveAsync() or ensure rule.when() is synchronous.',
        );
      }
      if (res) {
        matched.push(rule);
      }
    }

    return matched;
  }

  /**
   * Save a sync result to cache and enforce max size.
   */
  private saveSyncCache(key: string, value: T): void {
    if (!this.options.cache) {
      return;
    }

    this.syncCache.set(key, { hits: 0, timestamp: Date.now(), value });
    this.trimCache(this.syncCache);
  }

  /**
   * Trim cache to `maxCacheSize`.
   *
   * Eviction order:
   * 1) lower hits first
   * 2) older timestamp first
   */
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

  /**
   * Validate context structure.
   *
   * Required:
   * - ctx must be an object
   * - ctx must contain a truthy `version` field
   *
   * In `strictMode`, keys starting with `$` are treated as reserved (warning).
   *
   * @throws {TypeError|Error} If context is invalid.
   */
  private validateContext(ctx: VersionContext): void {
    if (!ctx || typeof ctx !== 'object') {
      throw new TypeError('Context must be an object.');
    }

    if (!('version' in ctx) || !(ctx as any).version) {
      throw new Error('Context must include a version.');
    }

    if (this.options.strictMode) {
      const invalid = Object.keys(ctx).filter((k) => k.startsWith('$'));
      if (invalid.length) {
        console.warn(`Reserved context keys: ${invalid.join(', ')}`);
      }
    }
  }

  /**
   * Validate a rule object.
   *
   * Required:
   * - rule must be an object
   * - rule.when must be a function
   * - rule.value must be provided (can be sync or async depending on resolve method)
   * - rule.priority (if provided) must be an integer
   *
   * @throws {TypeError|Error} If rule is invalid.
   */
  private validateRule(rule: VersionRule<T>): void {
    if (!rule || typeof rule !== 'object') {
      throw new TypeError('Rule must be an object.');
    }

    if (typeof rule.when !== 'function') {
      throw new Error('Rule must define when().');
    }

    if (rule.value === undefined) {
      throw new Error('Rule must define value.');
    }

    if (rule.priority !== undefined && !Number.isInteger(rule.priority)) {
      throw new TypeError('Rule priority must be an integer.');
    }
  }
}
