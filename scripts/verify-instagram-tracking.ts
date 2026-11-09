import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/db";
import { conversationWhere } from "../src/lib/instagram-inbox/tracking";
import { storeInstagramMessage } from "../src/lib/instagram-inbox/store";
const key = `tracking-check-${Date.now()}`;
const now = new Date();
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/glaura_crm") throw new Error("Local glaura_crm database required.");
  const u = await prisma.user.create({ data: { email: `${key}@example.invalid`, name: "QA local", role: "COMMERCIAL" } });
  try {
    const salons = await Promise.all([0, 1, 2].map(i => prisma.salon.create({ data: { name: key, slug: `${key}-${i}`, status: "INTERESSE", assignedToId: i === 0 ? null : u.id, nextActionAt: new Date(now.getTime() - 86400000) } })));
    await prisma.salesTask.create({ data: { title: key, salonId: salons[1].id, assignedToId: u.id, dueAt: new Date(now.getTime() + 86400000) } });
    for (let i = 0; i < 4; i++) await prisma.instagramConversation.create({ data: { id: `${key}:${i}`, participantId: `${i}`, salonId: i ? salons[i - 1].id : null, lastMessageAt: now, waitingAt: i === 3 ? now : null } });
    const matching = async (sp: Record<string, string>) => (await prisma.instagramConversation.findMany({ where: { AND: [{ id: { startsWith: `${key}:` } }, conversationWhere(sp, now)] }, orderBy: { id: "asc" } })).map(c => c.participantId);
    assert.deepEqual(await matching({ filter: "unlinked", view: "all" }), ["0"]);
    assert.deepEqual(await matching({ filter: "unassigned", view: "all" }), ["0", "1"]);
    assert.deepEqual(await matching({ filter: "overdue", view: "all" }), ["1", "3"]);
    assert.deepEqual(await matching({ filter: "overdue", view: "waiting", status: "INTERESSE", owner: u.id }), ["3"]);
    await storeInstagramMessage(key, { id: `${key}-old`, participantId: "3", incoming: true, text: "QA", sentAt: new Date(now.getTime() - 1000) });
    assert.ok((await prisma.instagramConversation.findUniqueOrThrow({ where: { id: `${key}:3` } })).waitingAt);
    await storeInstagramMessage(key, { id: `${key}-new`, participantId: "3", incoming: true, text: "QA", sentAt: new Date(now.getTime() + 1000) });
    assert.equal((await prisma.instagramConversation.findUniqueOrThrow({ where: { id: `${key}:3` } })).waitingAt, null);
    assert.equal((await prisma.salon.findUniqueOrThrow({ where: { id: salons[2].id } })).status, "INTERESSE");
    console.log("Local DB: lead filters, task precedence, waiting state, replay safety and incoming reopening PASS");
  } finally {
    await prisma.instagramConversation.deleteMany({ where: { id: { startsWith: `${key}:` } } });
    await prisma.salesTask.deleteMany({ where: { title: key } });
    await prisma.salon.deleteMany({ where: { name: key } });
    await prisma.user.delete({ where: { id: u.id } });
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
