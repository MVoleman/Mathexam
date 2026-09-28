import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SchoolSettingsForm } from "@/components/school-settings-form";
import { TeacherRoleManager } from "@/components/teacher-role-manager";
import { db } from "@/db";
import { profiles, schools } from "@/db/schema";
import { requireTeacher } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Skolinställningar — DeepGrader" };

export default async function SettingsPage() {
  const teacher = await requireTeacher();
  if (teacher.role !== "admin") notFound();

  const school = await db.query.schools.findFirst({
    where: eq(schools.id, teacher.schoolId),
  });
  if (!school) notFound();

  const colleagues = await db.query.profiles.findMany({
    where: eq(profiles.schoolId, teacher.schoolId),
    orderBy: [asc(profiles.fullName)],
    columns: { id: true, fullName: true, email: true, role: true },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Skolinställningar</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Uppgifter för avtal (PUB-avtal) och inloggning.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{school.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <SchoolSettingsForm
            initial={{
              name: school.name,
              orgNumber: school.orgNumber,
              ssoDomain: school.ssoDomain,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Lärare{" "}
            <span className="font-normal text-muted-foreground">
              ({colleagues.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <TeacherRoleManager teachers={colleagues} currentUserId={teacher.id} />
        </CardContent>
      </Card>
    </div>
  );
}
