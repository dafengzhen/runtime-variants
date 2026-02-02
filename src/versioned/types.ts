export interface AsyncCacheEntry<T> {
  hits: number;
  promise: Promise<T>;
  timestamp: number;
}

export interface CacheEntry<T> {
  hits: number;
  timestamp: number;
  value: T;
}

export type MaybePromise<T> = Promise<T> | T;

export interface VersionContext {
  [key: string]: any;
  env?: 'dev' | 'prod' | 'test' | string;
  platform?: 'android' | 'ios' | 'web' | string;
  version: string;
}

export interface VersionedObjectOptions<_T extends object> {
  cache?: boolean;
  cacheKey?: (ctx?: VersionContext) => string;
  cacheTTL?: number;
  defaultContext?: VersionContext;
  freeze?: boolean;
  maxCacheSize?: number;
  strictMode?: boolean;
}

export type VersionPredicate = (ctx: VersionContext) => MaybePromise<boolean>;

export interface VersionRule<T extends object> {
  metadata?: {
    description?: string;
    name?: string;
    tags?: string[];
  };
  priority?: number;
  value: MaybePromise<Partial<T>>;
  when: VersionPredicate;
}
