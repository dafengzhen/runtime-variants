/**
 * Environment identifier used for flag evaluation and rollout control.
 *
 * - `dev`: Local/dev environment, usually unrestricted for testing.
 * - `staging`: Pre-production environment for QA / validation.
 * - `prod`: Production environment, where rollouts are controlled.
 */
export type Env = 'dev' | 'staging' | 'prod';

/**
 * Context passed into flag/gate evaluation.
 *
 * - `version` is typically an app version (e.g. "1.2.3") or backend build version.
 *   If you use semver-like strings, ensure your version comparator matches your format.
 * - `experimentAssignments` should represent a stable assignment result, ideally derived
 *   deterministically from user/device identifiers.
 */
export interface EvalContext {
  /** Current runtime environment (dev/staging/prod). */
  env: Env;

  /**
   * Current application/service version.
   *
   * @example "1.2.3"
   * @example "2026.02.04"
   *
   * Version comparisons are only meaningful if your comparator understands the format.
   * Avoid plain string comparison if using semver (e.g. "1.10.0" vs "1.2.0").
   */
  version: string;

  /**
   * Unique identifier for the current user (optional).
   *
   * If `userId` is missing, user-based gates should generally be treated as "not matched"
   * unless you explicitly decide otherwise in your evaluator.
   */
  userId?: string;

  /**
   * Experiment assignments for the current context.
   *
   * Maps experiment key -> bucket value, e.g. `{ "new_onboarding": "treatment" }`.
   * Bucket naming is up to your experimentation platform (e.g. "A"/"B", "control"/"treatment").
   */
  experimentAssignments?: Record<string, string>; // expKey -> bucket
}

/**
 * Common gate properties shared by all gate types.
 */
export interface BaseGate {
  /**
   * Gate evaluation priority (higher runs earlier).
   *
   * Use this when multiple gates exist and you want deterministic ordering.
   * Common patterns:
   * - Higher priority gates short-circuit earlier (e.g. denylist/user allowlist).
   * - If omitted, evaluator may fall back to list order or a default priority.
   */
  priority?: number;
}

/**
 * Gate that allows a flag only in specific environments.
 *
 * @example
 * `{ type: 'env', allow: ['dev', 'staging'] }`
 */
export interface EnvGate extends BaseGate {
  /** Discriminator for EnvGate. */
  type: 'env';

  /**
   * Environments in which the feature is allowed.
   *
   * If the current `ctx.env` is not included, the gate fails.
   */
  allow: Env[];
}

/**
 * Gate that allows a flag only within a version range.
 *
 * - `min` is inclusive lower bound, `max` is inclusive upper bound unless your evaluator defines otherwise.
 * - Ensure you use a proper version comparator (semver or your custom scheme).
 *
 * @example
 * `{ type: 'version', min: '1.5.0' }` // enable from 1.5.0+
 * @example
 * `{ type: 'version', max: '2.0.0' }` // enable up to 2.0.0
 */
export interface VersionGate extends BaseGate {
  /** Discriminator for VersionGate. */
  type: 'version';

  /** Minimum allowed version (inclusive). */
  min?: string;

  /** Maximum allowed version (inclusive). */
  max?: string;
}

/**
 * Gate that allows/denies by user id.
 *
 * - If both `allow` and `deny` exist, a common rule is: `deny` wins.
 * - If `userId` is missing from context, this gate typically fails (no match).
 *
 * @example
 * `{ type: 'user', allow: ['u1', 'u2'] }`
 * @example
 * `{ type: 'user', deny: ['bad_user'] }`
 */
export interface UserGate extends BaseGate {
  /** Discriminator for UserGate. */
  type: 'user';

  /**
   * Allowlist of user ids.
   *
   * If provided, `ctx.userId` must be included to pass the gate.
   */
  allow?: string[];

  /**
   * Denylist of user ids.
   *
   * If provided and `ctx.userId` is included, gate fails regardless of allowlist.
   */
  deny?: string[];
}

/**
 * Gate that rolls out a feature to a percentage of traffic.
 *
 * - `value` should be between 0 and 100 (inclusive) unless your evaluator defines otherwise.
 * - Percentage gating should be deterministic: hash a stable identifier (e.g. userId/deviceId)
 *   to a 0..99 bucket so the user experience is consistent across sessions.
 *
 * @example
 * `{ type: 'percentage', value: 10 }` // ~10% rollout
 */
export interface PercentageGate extends BaseGate {
  /** Discriminator for PercentageGate. */
  type: 'percentage';

  /**
   * Rollout percentage.
   */
  value: number;
}

/**
 * Gate that enables a feature for specific experiment buckets.
 *
 * - Requires `ctx.experimentAssignments` to be present.
 * - `experimentKey` should match your experimentation system key.
 *
 * @example
 * `{ type: 'experiment', experimentKey: 'new_nav', allowBuckets: ['B', 'treatment'] }`
 */
export interface ExperimentGate extends BaseGate {
  /** Discriminator for ExperimentGate. */
  type: 'experiment';

  /** Experiment identifier/key. */
  experimentKey: string;

  /**
   * Buckets that are allowed.
   *
   * Example buckets: ['control', 'treatment'] or ['A', 'B'].
   */
  allowBuckets: string[];
}

/**
 * Custom gate with arbitrary evaluation logic.
 *
 * This is not serializable (functions cannot be transported over network),
 * so it is typically only used in local/in-process flag definitions.
 *
 * @example
 * `{ type: 'custom', evaluate: (ctx) => ctx.env !== 'prod' }`
 */
export interface CustomGate extends BaseGate {
  /** Discriminator for CustomGate. */
  type: 'custom';

  /**
   * Evaluate the gate against the context.
   * @returns `true` if the gate passes and the feature can be enabled.
   */
  evaluate(ctx: EvalContext): boolean;
}

/**
 * Union of all supported gate types.
 *
 * Use the `type` field as the discriminant for narrowing.
 */
export type Gate = EnvGate | VersionGate | UserGate | PercentageGate | ExperimentGate | CustomGate;

/**
 * A feature flag definition.
 *
 * Evaluation is commonly:
 * 1) If `enabled` is false -> result is false.
 * 2) If no gates -> result is true (because globally enabled).
 * 3) If gates exist -> apply gates in priority/order according to your evaluator.
 */
export interface FeatureFlag {
  /**
   * Base switch for the feature.
   *
   * When `false`, the feature is disabled regardless of gates.
   */
  enabled: boolean;

  /**
   * Optional list of gates to further restrict enablement.
   *
   * The exact semantics (AND/OR, priority, short-circuiting) should be documented
   * by your evaluator implementation. A common model is:
   * - Sort by `priority` desc (or keep original order)
   * - Combine with AND: all gates must pass
   * Alternative model:
   * - OR within same priority group, AND across groups, etc.
   */
  gates?: Gate[];
}

/**
 * Map of feature key -> flag definition.
 *
 * @example
 * `{ "newCheckout": { enabled: true, gates: [{ type: "env", allow: ["prod"] }] } }`
 */
export type FeatureMap = Record<string, FeatureFlag>;

/**
 * Events emitted by the flag evaluation system.
 */
export interface FlagEvents {
  /**
   * Fired after a feature flag is evaluated.
   */
  evaluated: {
    /** Feature key evaluated. */
    feature: string;
    /** Final evaluation result. */
    result: boolean;
    /** Context used for evaluation. */
    ctx: EvalContext;
  };
}

/**
 * Payload format for remotely delivered flags (e.g. from a config service).
 *
 * This payload is intentionally restricted to JSON-serializable gates.
 * Notably, `user` and `custom` gates are not included here.
 */
export interface RemoteFlagPayload {
  /**
   * Payload schema version.
   *
   * Used to support migrations when the remote flag format evolves.
   */
  version: number;

  /**
   * Unix timestamp (milliseconds) indicating when flags were updated.
   */
  updatedAt: number;

  /**
   * Remote flags map. Each entry is a serializable flag definition.
   */
  flags: Record<
    string,
    {
      /**
       * Base switch for the feature.
       *
       * When `false`, the feature is disabled regardless of gates.
       */
      enabled: boolean;

      /**
       * Serializable gates supported by remote config.
       *
       * The remote format excludes non-serializable gates (e.g. `custom`).
       * If you need `user` gating remotely, add it to the union explicitly.
       */
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
