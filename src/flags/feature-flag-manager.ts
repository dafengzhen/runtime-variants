import { EventBus } from '@dafengzhen/event-bus';

import type { EvalContext, FeatureMap, FlagEvents, Gate } from './types.ts';

import { compareVersion, hash } from '../utils.ts';

/**
 * FeatureFlagManager
 *
 * A lightweight feature flag evaluator with:
 * - global enable/disable switch per flag
 * - ordered gate evaluation by priority (desc)
 * - fail-safe behavior (any unexpected error => disabled)
 * - evaluation event emission for observability
 *
 * @example
 * const ff = new FeatureFlagManager({
 *   newUI: { enabled: true, gates: [{ type: 'env', allow: ['prod'] }] }
 * });
 *
 * ff.onEvaluate(e => console.log(e.feature, e.result));
 *
 * if (ff.isEnabled('newUI', { env: 'prod', version: '1.2.3', userId: 'u1' })) {
 *   // ...
 * }
 *
 * @author dafengzhen
 */
export class FeatureFlagManager<F extends FeatureMap> {
  /**
   * Event bus for emitting evaluation results.
   */
  private readonly bus = new EventBus<FlagEvents>();

  /**
   * Current flags snapshot.
   * Use {@link setFlags} to update partially.
   */
  private flags: F;

  /**
   * Create a FeatureFlagManager.
   *
   * @param flags - Initial feature flags configuration.
   */
  constructor(flags: F) {
    this.flags = flags;
  }

  /**
   * Evaluate whether a feature is enabled for the given context.
   *
   * Evaluation rules:
   * 1) If flag is missing or `enabled === false`, returns false.
   * 2) Gates are evaluated in descending `priority` order (higher first).
   * 3) All gates must pass (AND). First failure short-circuits to false.
   * 4) Any unexpected error => returns false (fail-safe).
   * 5) Emits an `evaluated` event with the final result.
   *
   * @typeParam K - Feature key type.
   * @param key - Feature name key.
   * @param ctx - Evaluation context (env/version/userId/experiments...).
   * @returns `true` if enabled, otherwise `false`.
   */
  isEnabled<K extends keyof F>(key: K, ctx: EvalContext): boolean {
    const flag = this.flags[key];

    // Fast-path: missing or globally disabled
    if (!flag?.enabled) {
      this.emitEvaluated(String(key), false, ctx);
      return false;
    }

    const gates = flag.gates ?? [];
    // Only sort when needed: if there are 2+ gates and some has priority set.
    const orderedGates =
      gates.length > 1 && gates.some((g) => g.priority != null)
        ? [...gates].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
        : gates;

    let result = true;

    try {
      for (const gate of orderedGates) {
        if (!this.evaluateGate(gate, ctx)) {
          result = false;
          break;
        }
      }
    } catch {
      // Fail-safe: any evaluation error disables the flag.
      result = false;
    }

    this.emitEvaluated(String(key), result, ctx);
    return result;
  }

  /**
   * Subscribe to evaluation events.
   *
   * @param fn - Callback invoked after each evaluation.
   */
  onEvaluate(fn: (e: FlagEvents['evaluated']) => void): void {
    this.bus.on('evaluated', fn);
  }

  /**
   * Run a callback only when the feature is enabled in the given context.
   *
   * @param key - Feature name key.
   * @param ctx - Evaluation context.
   * @param fn - Callback to execute if enabled.
   */
  run<K extends keyof F>(key: K, ctx: EvalContext, fn: () => void): void {
    if (this.isEnabled(key, ctx)) {
      fn();
    }
  }

  /**
   * Merge-in new flags config (partial update).
   *
   * @param next - Partial feature flags to merge into current config.
   */
  setFlags(next: Partial<F>): void {
    this.flags = { ...this.flags, ...next } as F;
  }

  /**
   * Emit an evaluation event.
   *
   * @param feature - Feature name.
   * @param result - Evaluation result.
   * @param ctx - Evaluation context.
   */
  private emitEvaluated(feature: string, result: boolean, ctx: EvalContext): void {
    this.bus.emit('evaluated', { ctx, feature, result });
  }

  /**
   * Evaluate a single gate against the context.
   *
   * Notes:
   * - Any unrecognized gate type returns false.
   * - Keep this function side-effect free.
   *
   * @param gate - Gate configuration.
   * @param ctx - Evaluation context.
   * @returns Whether the gate passes.
   */
  private evaluateGate(gate: Gate, ctx: EvalContext): boolean {
    switch (gate.type) {
      /**
       * Custom evaluator.
       * Delegate to user-provided function.
       */
      case 'custom': {
        return gate.evaluate(ctx);
      }

      /**
       * Environment allow-list.
       * Passes if `ctx.env` is included in `gate.allow`.
       */
      case 'env': {
        return gate.allow.includes(ctx.env);
      }

      /**
       * Experiment bucket allow-list.
       * Passes if:
       * - assignment exists (even if bucket is 0 / ''), and
       * - assigned bucket is included in allowBuckets
       */
      case 'experiment': {
        const assignments = ctx.experimentAssignments;
        if (!assignments) {
          return false;
        }

        // Use `in` to avoid falsy bucket (0/'') being treated as missing
        if (!(gate.experimentKey in assignments)) {
          return false;
        }

        const bucket = assignments[gate.experimentKey];
        return gate.allowBuckets.includes(bucket);
      }

      /**
       * Percentage rollout by hashing userId into [0..99].
       * Fail-safe: if userId is missing/empty, do NOT enroll.
       */
      case 'percentage': {
        const userId = ctx.userId;
        if (!userId) {
          return false;
        }
        return hash(userId) % 100 < gate.value;
      }

      /**
       * User allow/deny list.
       * - deny has precedence
       * - if allow is provided, user must be included
       * - otherwise passes
       */
      case 'user': {
        const userId = ctx.userId ?? '';
        if (gate.deny?.includes(userId)) {
          return false;
        }
        if (gate.allow) {
          return gate.allow.includes(userId);
        }
        return true;
      }

      /**
       * Semantic version range check.
       * - If `min` is set, ctx.version must be >= min
       * - If `max` is set, ctx.version must be <= max
       */
      case 'version': {
        if (gate.min && compareVersion(ctx.version, gate.min) < 0) {
          return false;
        }
        if (gate.max && compareVersion(ctx.version, gate.max) > 0) {
          return false;
        }
        return true;
      }

      default:
        return false;
    }
  }
}
