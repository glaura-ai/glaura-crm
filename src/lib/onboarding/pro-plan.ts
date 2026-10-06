import { z } from "zod";

/** Compatibility identities; this module never enables sales or a trial. */
export const proPlanCodeSchema = z.enum(["basic", "reservation", "essentiel_v2", "solo_v2", "salon_v2"]);
export type ProPlanCode = z.infer<typeof proPlanCodeSchema>;
export function recognizedProPlan(value: unknown): ProPlanCode | null {
  const result = proPlanCodeSchema.safeParse(value);
  return result.success ? result.data : null;
}
export function proPlanTrialDays(code: ProPlanCode): number {
  return code === "basic" ? 7 : code === "reservation" ? 14 : 0;
}
/** Explicit unknown codes fail rather than silently becoming Reservation. */
export function queuedProPlan(value: unknown): ProPlanCode {
  if (value == null) return "reservation"; // Legacy jobs omitted this field.
  const code = recognizedProPlan(value);
  if (!code) throw new Error("Unknown Pro onboarding plan");
  return code;
}

export function proPreviewJobContract(input: { planCode?: unknown; trialPeriodDays?: number | null }): { planCode: ProPlanCode; trialPeriodDays: number } {
  const planCode = queuedProPlan(input.planCode);
  return { planCode, trialPeriodDays: proPlanTrialDays(planCode) === 0 ? 0 : input.trialPeriodDays ?? 14 };
}
