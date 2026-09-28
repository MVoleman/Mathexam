import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import {
  BarChart3,
  FileText,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Plus,
  ScrollText,
  Settings,
  Users,
} from "lucide-react";
import { getTeacher } from "@/lib/auth";
import { signOut } from "@/actions/auth";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "DeepGrader — AI-rättning enligt Lgr22",
  description: "AI-driven rättning av matematikprov med lärargranskning.",
};

const navItems = [
  { href: "/", label: "Översikt", icon: LayoutDashboard },
  { href: "/exams", label: "Prov", icon: FileText },
  { href: "/exams/new", label: "Nytt prov", icon: Plus },
  { href: "/students", label: "Elever", icon: Users },
  { href: "/evals", label: "Utvärderingar", icon: FlaskConical },
] as const;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const teacher = await getTeacher();

  return (
    <html lang="sv">
      <body className={`${inter.className} bg-background text-foreground antialiased`}>
        {teacher ? (
          <div className="flex min-h-screen">
            <aside className="hidden w-60 shrink-0 flex-col border-r bg-muted/30 p-4 print:hidden md:flex">
              <Link href="/" className="mb-8 flex items-center gap-2 px-2">
                <BarChart3 className="h-6 w-6 text-primary" />
                <span className="text-lg font-semibold tracking-tight">DeepGrader</span>
              </Link>
              <nav className="space-y-1">
                {[
                  ...navItems,
                  ...(teacher.role === "admin"
                    ? ([
                        { href: "/audit", label: "Åtkomstlogg", icon: ScrollText },
                        { href: "/settings", label: "Inställningar", icon: Settings },
                      ] as const)
                    : []),
                ].map(({ href, label, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </Link>
                ))}
              </nav>
              <div className="mt-auto space-y-2 border-t pt-4">
                <p className="truncate px-3 text-xs text-muted-foreground">
                  {teacher.fullName}
                </p>
                <form action={signOut}>
                  <button
                    type="submit"
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <LogOut className="h-4 w-4" />
                    Logga ut
                  </button>
                </form>
              </div>
            </aside>
            <main className="flex-1 p-6 md:p-10">{children}</main>
          </div>
        ) : (
          <main className="min-h-screen p-6 md:p-10">{children}</main>
        )}
      </body>
    </html>
  );
}
