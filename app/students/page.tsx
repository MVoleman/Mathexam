import { asc, eq } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AddStudentForm,
  DeleteStudentButton,
  GoogleClassroomControls,
  MicrosoftTeamsControls,
  SS12000Controls,
  StudentShareButton,
} from "@/components/roster-panel";
import { db } from "@/db";
import { students } from "@/db/schema";
import { requireTeacher } from "@/lib/auth";
import { isConnected, isGoogleClassroomConfigured } from "@/lib/integrations/google-classroom";
import * as teams from "@/lib/integrations/microsoft-teams";
import { isSS12000Configured } from "@/lib/integrations/ss12000";

export const dynamic = "force-dynamic";

const sourceLabels: Record<string, string> = {
  manual: "Manuell",
  google_classroom: "Google Classroom",
  microsoft_teams: "Microsoft Teams",
  skolfederation: "Skolfederation",
};

export default async function StudentsPage() {
  const teacher = await requireTeacher();
  const [roster, googleConnected, teamsConnected] = await Promise.all([
    db.query.students.findMany({
      where: eq(students.schoolId, teacher.schoolId),
      orderBy: [asc(students.className), asc(students.fullName)],
    }),
    isConnected(teacher.id),
    teams.isConnected(teacher.id),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Elever</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Skolans elevlista — synkas från Google Classroom eller läggs till manuellt.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Integrationer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-44 text-sm font-medium">Google Classroom</span>
            {isGoogleClassroomConfigured() ? (
              <GoogleClassroomControls connected={googleConnected} />
            ) : (
              <span className="text-sm text-muted-foreground">
                Ej konfigurerad — sätt GOOGLE_CLASSROOM_CLIENT_ID/SECRET.
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-44 text-sm font-medium">Microsoft Teams</span>
            {teams.isTeamsConfigured() ? (
              <MicrosoftTeamsControls connected={teamsConnected} />
            ) : (
              <span className="text-sm text-muted-foreground">
                Ej konfigurerad — sätt MICROSOFT_CLIENT_ID/SECRET.
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-44 text-sm font-medium">
              Skolon / Skolfederation (SS&nbsp;12000)
            </span>
            {isSS12000Configured() ? (
              <SS12000Controls />
            ) : (
              <span className="text-sm text-muted-foreground">
                Ej konfigurerad — sätt SS12000_BASE_URL/TOKEN (se docs/INTEGRATIONS.md).
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Elevlista <span className="font-normal text-muted-foreground">({roster.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <AddStudentForm />
          {roster.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Inga elever ännu — synka från Google Classroom eller lägg till manuellt.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Namn</th>
                    <th className="py-2 pr-4 font-medium">Klass</th>
                    <th className="py-2 pr-4 font-medium">E-post</th>
                    <th className="py-2 pr-4 font-medium">Källa</th>
                    <th className="py-2 pr-4 font-medium">Portal</th>
                    <th className="py-2 pr-4" />
                  </tr>
                </thead>
                <tbody>
                  {roster.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">{s.fullName}</td>
                      <td className="py-2 pr-4">{s.className ?? "–"}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{s.email ?? "–"}</td>
                      <td className="py-2 pr-4">
                        <Badge variant="outline">{sourceLabels[s.source] ?? s.source}</Badge>
                      </td>
                      <td className="py-2 pr-4">
                        <StudentShareButton studentId={s.id} />
                      </td>
                      <td className="py-2 text-right">
                        <DeleteStudentButton studentId={s.id} />
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
