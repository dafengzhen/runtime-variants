/**
 * A cache entry used when the cached payload is still being computed.
 *
 * @template T The resolved value type of the async computation.
 */
export interface AsyncCacheEntry<T> {
  /**
   * How many times this cache entry has been requested (hit count).
   * Useful for LRU/LFU eviction strategies and observability.
   */
  hits: number;

  /**
   * The in-flight promise representing the ongoing computation.
   * When it resolves, the cache may be promoted to a {@link CacheEntry}.
   */
  promise: Promise<T>;

  /**
   * Unix epoch milliseconds when this entry was created or last updated.
   * Typically used together with TTL logic.
   */
  timestamp: number;
}

/**
 * A cache entry containing a fully resolved value.
 *
 * @template T The cached value type.
 */
export interface CacheEntry<T> {
  /**
   * How many times this cache entry has been requested (hit count).
   * Useful for eviction strategies and observability.
   */
  hits: number;

  /**
   * Unix epoch milliseconds when this entry was created or last updated.
   * Typically used together with TTL logic.
   */
  timestamp: number;

  /**
   * The resolved value stored in the cache.
   */
  value: T;
}

/**
 * Represents either an immediate value or a promise that resolves to that value.
 *
 * @template T The underlying value type.
 */
export type MaybePromise<T> = Promise<T> | T;

/**
 * Convenience helper type that represents all options as required.
 *
 * Typically used after applying defaults.
 *
 * @template T The target object type being versioned.
 */
export type RequiredOptions<T extends object> = Required<VersionedObjectOptions<T>>;

/**
 * Context passed to version predicates and cache key builders.
 *
 * This is the primary input used to decide which rule applies.
 * Implementations may include additional arbitrary fields.
 */
export interface VersionContext {
  /**
   * Arbitrary context fields.
   * Prefer using stable, JSON-serializable values if they may affect caching.
   */
  [key: string]: any;

  /**
   * Runtime environment identifier.
   * Common values: 'dev' | 'prod' | 'test'.
   */
  env?: 'dev' | 'prod' | 'test' | string;

  /**
   * Platform identifier (e.g., runtime target).
   * Common values: 'android' | 'ios' | 'web'.
   */
  platform?: 'android' | 'ios' | 'web' | string;

  /**
   * The required version string used by predicates/rules.
   *
   * Semantics depend on the library: it may be a semver string, build number,
   * or a custom version format, but it must be present and valid per your validator.
   */
  version: string;
}

/**
 * Options for building a versioned object (rule-based partial overlays).
 *
 * @template _T The target object type being versioned.
 */
export interface VersionedObjectOptions<_T extends object> {
  /**
   * Enables internal caching of rule evaluation results / computed objects.
   *
   * When enabled, results may be memoized by {@link cacheKey} for {@link cacheTTL}
   * and may be limited by {@link maxCacheSize}.
   */
  cache?: boolean;

  /**
   * Builds the cache key for a given context.
   *
   * - If omitted, an implementation-defined default key strategy may be used.
   * - Ensure the key changes whenever the context fields that affect rule selection change.
   *
   * @param ctx Context used to evaluate version rules.
   * @returns A stable string key used for memoization.
   */
  cacheKey?: (ctx?: VersionContext) => string;

  /**
   * Cache time-to-live in milliseconds.
   *
   * After TTL expires, cached entries may be recomputed on next access.
   */
  cacheTTL?: number;

  /**
   * Default context merged with/used when no context is provided by the caller.
   *
   * Must include a {@link VersionContext.version} when used to evaluate rules,
   * unless your implementation supplies one elsewhere.
   */
  defaultContext?: VersionContext;

  /**
   * Whether to freeze the produced object to prevent further mutation.
   *
   * Intended to enforce immutability guarantees for consumers.
   * Implementations may perform shallow freeze or deep freeze depending on design.
   */
  freeze?: boolean;

  /**
   * Maximum number of cached entries retained in memory.
   *
   * Implementations may evict entries based on LRU/LFU or other heuristics.
   */
  maxCacheSize?: number;

  /**
   * Enables stricter validation and enforcement behavior.
   *
   * In strict mode, invalid contexts/rules may throw errors instead of being ignored,
   * and async behavior may be rejected more aggressively (see {@link VersionErrorCode}).
   */
  strictMode?: boolean;
}

/**
 * Canonical error codes used by the versioning system.
 *
 * These can be used for programmatic handling and user-friendly messaging.
 */
export type VersionErrorCode =
  /**
   * An async predicate was provided/encountered in a code path that requires sync predicates.
   */
  | 'ASYNC_PREDICATE'

  /**
   * An async rule value was provided/encountered in a code path that requires sync values.
   */
  | 'ASYNC_RULE_VALUE'

  /**
   * The provided context is invalid (missing required fields, wrong types, etc.).
   */
  | 'INVALID_CONTEXT'

  /**
   * A rule is invalid (missing required properties, malformed shapes, etc.).
   */
  | 'INVALID_RULE'

  /**
   * The provided version string is invalid or cannot be parsed/compared.
   */
  | 'INVALID_VERSION';

/**
 * Predicate that decides whether a rule applies for a given context.
 *
 * Some implementations require this predicate to be synchronous. If an async predicate
 * is used where not supported, an {@link VersionErrorCode} of 'ASYNC_PREDICATE'
 * may be raised.
 */
export type VersionPredicate = (ctx: VersionContext) => MaybePromise<boolean>;

/**
 * A single rule that conditionally contributes a partial overlay to the final object.
 *
 * @template T The target object shape.
 */
export interface VersionRule<T extends object> {
  /**
   * Optional metadata for documentation, debugging, and rule introspection.
   */
  metadata?: {
    /**
     * Human-readable description of what the rule changes and why.
     */
    description?: string;

    /**
     * A stable identifier or short name for the rule.
     */
    name?: string;

    /**
     * Tags to group or filter rules (e.g., feature flags, teams, experiments).
     */
    tags?: string[];
  };

  /**
   * Rule priority used to order application when multiple rules match.
   *
   * Higher values typically indicate higher precedence, but the exact ordering
   * semantics should be defined by the implementation (e.g., ascending vs descending).
   */
  priority?: number;

  /**
   * The partial object (overlay) contributed by this rule.
   *
   * Some implementations require rule values to be synchronous. If an async value
   * is used where not supported, an {@link VersionErrorCode} of 'ASYNC_RULE_VALUE'
   * may be raised.
   */
  value: MaybePromise<Partial<T>>;

  /**
   * Predicate that determines whether this rule applies for the given context.
   *
   * @param ctx Context including at minimum a {@link VersionContext.version}.
   */
  when: VersionPredicate;
}
