export interface AdaptiveQualitySample {
  samples: number;
  receiveJitterP95Ms: number;
  decodeP95Ms: number;
}
/** Monotonic, transport-independent hysteresis. Low/medium/high never exceed user limits. */
export class AdaptiveQualityPolicy {
  level = 2;
  private previous = -Infinity;
  private changed = -Infinity;
  private poor = 0;
  private good = 0;
  observe(sample: AdaptiveQualitySample, now: number): number | undefined {
    if (
      !Number.isFinite(now) ||
      now < 0 ||
      now - this.previous < 1000 ||
      !Number.isInteger(sample.samples) ||
      sample.samples < 12 ||
      sample.samples > 10000 ||
      ![sample.receiveJitterP95Ms, sample.decodeP95Ms].every(
        (v) => Number.isFinite(v) && v >= 0 && v <= 60000,
      )
    )
      return;
    this.previous = now;
    const poor = sample.receiveJitterP95Ms >= 80 || sample.decodeP95Ms >= 50;
    const good = sample.receiveJitterP95Ms <= 20 && sample.decodeP95Ms <= 20;
    this.poor = poor ? this.poor + 1 : 0;
    this.good = good ? this.good + 1 : 0;
    const next =
      this.poor >= 3 && now - this.changed >= 15000
        ? Math.max(0, this.level - 1)
        : this.good >= 10 && now - this.changed >= 30000
          ? Math.min(2, this.level + 1)
          : this.level;
    if (next === this.level) return;
    this.level = next;
    this.changed = now;
    this.poor = 0;
    this.good = 0;
    return next;
  }
}
