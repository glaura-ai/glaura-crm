"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireInstagramAdmin } from "@/lib/access";
import { getOutreachSettings, outreachSettingsSchema, saveOutreachSettings } from "./settings";

const str = (fd: FormData, key: string) => (typeof fd.get(key) === "string" ? String(fd.get(key)) : "");
function refresh() { revalidatePath("/automatisations"); revalidatePath("/instagram"); }

export async function saveAutomationSettings(fd: FormData) {
  const user = await requireInstagramAdmin();
  const parsed = outreachSettingsSchema.safeParse({
    enabled: str(fd, "enabled") === "true",
    autoStart: fd.get("autoStart") === "on",
    step0Text: str(fd, "step0Text"), step1Text: str(fd, "step1Text"), askPhoneText: str(fd, "askPhoneText"),
    step1DelayHours: str(fd, "step1DelayHours"), step2DelayDays: str(fd, "step2DelayDays"), step3DelayDays: str(fd, "step3DelayDays"),
    sendHourStart: str(fd, "sendHourStart"), sendHourEnd: str(fd, "sendHourEnd"),
    template1: str(fd, "template1"), template2: str(fd, "template2"), templateLang: str(fd, "templateLang"),
    calendarUrl: str(fd, "calendarUrl").trim() || null,
  });
  if (!parsed.success) redirect(`/automatisations?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Réglages invalides.")}`);
  await saveOutreachSettings(parsed.data, user.id);
  refresh();
  redirect("/automatisations?saved=1");
}

export async function toggleAutomation() {
  const user = await requireInstagramAdmin();
  const current = await getOutreachSettings();
  await saveOutreachSettings({ ...current, enabled: !current.enabled }, user.id);
  refresh();
  redirect("/automatisations");
}
