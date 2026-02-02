/* =====================
 * Types & Utilities
 * ===================== */

export type Env = 'dev' | 'staging' | 'prod';

export interface EvalContext {
  env: Env;
  version: string;
  userId?: string;
  experimentAssignments?: Record<string, string>; // expKey -> bucket
}

function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) {
      return da > db ? 1 : -1;
    }
  }
  return 0;
}

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/* =====================
 * Gate Definitions
 * ===================== */

export interface BaseGate {
  priority?: number; // higher first
}

export interface EnvGate extends BaseGate {
  type: 'env';
  allow: Env[];
}

export interface VersionGate extends BaseGate {
  type: 'version';
  min?: string;
  max?: string;
}

export interface UserGate extends BaseGate {
  type: 'user';
  allow?: string[];
  deny?: string[];
}

export interface PercentageGate extends BaseGate {
  type: 'percentage';
  value: number; // 0-100
}

export interface ExperimentGate extends BaseGate {
  type: 'experiment';
  experimentKey: string;
  allowBuckets: string[]; // A/B/C
}

export interface CustomGate extends BaseGate {
  type: 'custom';
  evaluate(ctx: EvalContext): boolean;
}

export type Gate = EnvGate | VersionGate | UserGate | PercentageGate | ExperimentGate | CustomGate;

/* =====================
 * Feature Flag
 * ===================== */

export interface FeatureFlag {
  enabled: boolean;
  gates?: Gate[];
}

export type FeatureMap = Record<string, FeatureFlag>;

/* =====================
 * Typed Event Bus (Minimal Integration)
 * ===================== */

export interface FlagEvents {
  evaluated: {
    feature: string;
    result: boolean;
    ctx: EvalContext;
  };
}

export class TypedEventBus<E extends Record<string, any>> {
  private handlers = new Map<keyof E, Set<(payload: any) => void>>();

  on<K extends keyof E>(event: K, fn: (payload: E[K]) => void): void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(fn);
    this.handlers.set(event, set);
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    const set = this.handlers.get(event);
    if (!set) {
      return;
    }
    for (const fn of set) {
      fn(payload);
    }
  }
}

/* =====================
 * Gate Evaluation
 * ===================== */

function evaluateGate(gate: Gate, ctx: EvalContext): boolean {
  switch (gate.type) {
    case 'env':
      return gate.allow.includes(ctx.env);

    case 'version':
      if (gate.min && compareVersion(ctx.version, gate.min) < 0) {
        return false;
      }
      if (gate.max && compareVersion(ctx.version, gate.max) > 0) {
        return false;
      }
      return true;

    case 'user':
      if (gate.deny?.includes(ctx.userId ?? '')) {
        return false;
      }
      if (gate.allow) {
        return gate.allow.includes(ctx.userId ?? '');
      }
      return true;

    case 'percentage':
      return hash(ctx.userId ?? '') % 100 < gate.value;

    case 'experiment':
      return (
        ctx.experimentAssignments?.[gate.experimentKey] &&
        gate.allowBuckets.includes(ctx.experimentAssignments[gate.experimentKey])
      );

    case 'custom':
      return gate.evaluate(ctx);

    default:
      return false;
  }
}

/* =====================
 * FeatureFlagManager
 * ===================== */

export class FeatureFlagManager<F extends FeatureMap> {
  private flags: F;
  private bus = new TypedEventBus<FlagEvents>();

  constructor(flags: F) {
    this.flags = flags;
  }

  onEvaluate(fn: (e: FlagEvents['evaluated']) => void): void {
    this.bus.on('evaluated', fn);
  }

  setFlags(next: Partial<F>): void {
    this.flags = { ...this.flags, ...next } as F;
  }

  isEnabled<K extends keyof F>(key: K, ctx: EvalContext): boolean {
    const flag = this.flags[key];
    if (!flag || !flag.enabled) {
      this.bus.emit('evaluated', { feature: String(key), result: false, ctx });
      return false;
    }

    const gates = [...(flag.gates ?? [])].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    let result = true;
    try {
      for (const gate of gates) {
        if (!evaluateGate(gate, ctx)) {
          result = false;
          break;
        }
      }
    } catch {
      result = false; // fail-safe
    }

    this.bus.emit('evaluated', { feature: String(key), result, ctx });
    return result;
  }

  run<K extends keyof F>(key: K, ctx: EvalContext, fn: () => void): void {
    if (this.isEnabled(key, ctx)) {
      fn();
    }
  }
}

/* =====================
 * Remote Protocol (JSON Shape)
 * ===================== */

export interface RemoteFlagPayload {
  version: number;
  updatedAt: number;
  flags: Record<
    string,
    {
      enabled: boolean;
      gates?: Array<
        | { type: 'env'; allow: Env[]; priority?: number }
        | { type: 'version'; min?: string; max?: string; priority?: number }
        | { type: 'percentage'; value: number; priority?: number }
        | {
            type: 'experiment';
            experimentKey: string;
            allowBuckets: string[];
            priority?: number;
          }
      >;
    }
  >;
}

/* =====================
 * Example Usage
 * ===================== */

const flags = new FeatureFlagManager({
  newSearch: {
    enabled: true,
    gates: [
      { type: 'env', allow: ['staging', 'prod'], priority: 100 },
      { type: 'version', min: '6.2.0', priority: 90 },
      { type: 'experiment', experimentKey: 'search_ui', allowBuckets: ['B'] },
    ],
  },
});

flags.onEvaluate((e) => {
  console.log('[feature]', e.feature, e.result);
});

flags.run(
  'newSearch',
  {
    env: 'prod',
    version: '6.3.0',
    userId: 'u123',
    experimentAssignments: { search_ui: 'B' },
  },
  () => {
    console.log('new search enabled');
  },
);
