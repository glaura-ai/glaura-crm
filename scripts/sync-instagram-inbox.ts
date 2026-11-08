import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
async function main() {
  const { syncInstagramHistory } = await import("../src/lib/instagram-inbox/sync");
  const { syncFirebaseInbox } = await import("../src/lib/instagram-inbox/firebase-sync");
  const { prisma } = await import("../src/lib/db");
  try {
    const history = await syncInstagramHistory();
    const live = await syncFirebaseInbox();
    console.log(JSON.stringify({ conversations: history.conversations, historyMessages: history.messages, webhookMessages: live.messages }));
  } finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error("La synchronisation Instagram a échoué. Aucun jeton ni message privé n’a été journalisé."); process.exitCode = 1; });
