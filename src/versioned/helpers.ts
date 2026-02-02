import type { VersionContext, VersionRule } from './types.ts';
import { InvalidVersionError } from './version-error.ts';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  Object.prototype.toString.call(v) === '[object Object]';

export const compareVersion = (a: string, b: string): number => {
  if (!a.trim() || !b.trim()) {
    throw new InvalidVersionError('empty');
  }

  const normalize = (v: string): [number, number, number] => {
    const main = v.split('-', 1)[0].trim();
    const segs = main.split('.');

    if (segs.length < 1 || segs.length > 3) {
      throw new InvalidVersionError(main);
    }

    const nums = segs.map((s) => {
      if (s === '') {
        throw new InvalidVersionError(main);
      }
      if (!/^\d+$/.test(s)) {
        throw new InvalidVersionError(s);
      }
      const n = Number(s);
      if (!Number.isSafeInteger(n) || n < 0) {
        throw new InvalidVersionError(s);
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

export const isPromise = <T>(v: any): v is Promise<T> => !!v && typeof v.then === 'function';

const stable = (v: any): any => {
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

export const defaultCacheKey = (ctx?: VersionContext): string => {
  if (!ctx) {
    return '__default__';
  }
  return JSON.stringify(stable(ctx));
};

export const getPriority = (r: VersionRule<any>) => r.priority ?? 0;
