import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileText, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getDashboardStats } from "@/lib/queries";
import { requireTeacher } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const teacher = await requireTeacher();
  const stats = await getDashboardStats(teacher.schoolId);

  const cards = [
    { label: "Prov", value: stats.exams, icon: FileText },
    { label: "Inlämningar", value: stats.submissions, icon: Users },
    { label: "Rättade svar", value: stats.gradedAnswers, icon: CheckCircle2 },
    {
      label: "Väntar på granskning",
      value: stats.pendingReview,
      icon: AlertTriangle,
      highlight: stats.pendingReview > 0,
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Översikt</h1>
          <p className="text-sm text-muted-foreground">
            AI-rättning av matematikprov enligt Lgr22, med dig som sista instans.
          </p>
        </div>
        <Button asChild>
          <Link href="/exams/new">Ladda upp prov</Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ label, value, icon: Icon, highlight }) => (
          <Card key={label} className={highlight ? "border-amber-400" : undefined}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {label}
              </CardTitle>
              <Icon
                className={`h-4 w-4 ${highlight ? "text-amber-500" : "text-muted-foreground"}`}
              />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Kom igång</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ol className="list-decimal space-y-1 pl-5">
            <li>Ladda upp ett prov som PDF och registrera frågorna.</li>
            <li>Lägg till elevinlämningar (foton på handskrivna svar).</li>
            <li>Starta batchrättning — DeepGrader transkriberar och bedömer varje svar.</li>
            <li>Granska flaggade svar, godkänn eller korrigera poäng.</li>
            <li>Dela formativa elevrapporter och analysera klassens resultat.</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
