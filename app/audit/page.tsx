import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db";
import { auditLogs, profiles } from "@/db/schema";
import { requireTeacher } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Åtkomstlogg — DeepGrader" };

const actionLabels: Record<string, string> = {
  "submission.view": "Visade inlämning",
  "report.view": "Visade rapport",
  "report.export_pdf": "Exporterade rapport (PDF)",
  "result.approve": "Godkände bedömning",
  "result.override": "Korrigerade bedömning",
  "grading.batch_start": "Startade batchrättning",
  "gdpr.export": "GDPR-export",
  "gdpr.erase": "GDPR-radering",
  "share_code.create": "Skapade delningskod",
  "share_code.revoke": "Återkallade delningskoder",
  "roster.sync": "Synkade elevlista",
  "golden.capture": "Sparade guldsvar",
  "portal.view": "Portalvisning (elev/vårdnadshavare)",
};

/** Admin-only view of the school's data-access audit trail (GDPR/TOM). */
export default async function AuditPage() {
  const teacher = await requireTeacher();
  if (teacher.role !== "admin") notFound();

  const rows = await db
    .select({
      log: auditLogs,
      actorName: profiles.fullName,
    })
    .from(auditLogs)
    .leftJoin(profiles, eq(profiles.id, auditLogs.actorId))
    .where(eq(auditLogs.schoolId, teacher.schoolId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(500);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Åtkomstlogg</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Vem som tagit del av eller ändrat elevdata (senaste 500 händelserna).
            Del av skolans tekniska och organisatoriska åtgärder enligt GDPR.
            Poster gallras efter {process.env.AUDIT_RETENTION_DAYS ?? 365} dagar.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href="/audit/export" download>
            <Download className="mr-2 h-4 w-4" />
            Exportera CSV
          </a>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Händelser</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Inga händelser ännu.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Tidpunkt</th>
                    <th className="py-2 pr-4 font-medium">Användare</th>
                    <th className="py-2 pr-4 font-medium">Händelse</th>
                    <th className="py-2 pr-4 font-medium">Objekt</th>
                    <th className="py-2 pr-4 font-medium">Detaljer</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ log, actorName }) => (
                    <tr key={log.id} className="border-b align-top last:border-0">
                      <td className="whitespace-nowrap py-2 pr-4">
                        {log.createdAt.toLocaleString("sv-SE", {
                          dateStyle: "short",
                          timeStyle: "medium",
                        })}
                      </td>
                      <td className="py-2 pr-4">{actorName ?? "System"}</td>
                      <td className="py-2 pr-4">
                        {actionLabels[log.action] ?? log.action}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant="outline">{log.entityType}</Badge>{" "}
                        <span className="font-mono text-xs text-muted-foreground">
                          {log.entityId ? log.entityId.slice(0, 8) : "–"}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-xs text-muted-foreground">
                        {log.metadata
                          ? Object.entries(log.metadata)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(" · ")
                          : "–"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
