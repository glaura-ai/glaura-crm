import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Sidebar } from "@/components/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar user={session.user} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
