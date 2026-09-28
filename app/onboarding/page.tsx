import { redirect } from "next/navigation";
import { getTeacher } from "@/lib/auth";
import { completeOnboarding, joinSchoolByDomain } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const metadata = { title: "Kom igång — DeepGrader" };

export default async function OnboardingPage() {
  const teacher = await getTeacher();
  if (teacher) redirect("/");

  // SSO auto-join: users whose email domain matches a school's sso_domain
  // become teachers there without manual onboarding (docs/SSO.md).
  if (await joinSchoolByDomain()) redirect("/");

  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Slutför din registrering</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={completeOnboarding} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="fullName">Namn</Label>
              <Input id="fullName" name="fullName" required autoComplete="name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="schoolName">Skola</Label>
              <Input id="schoolName" name="schoolName" required />
            </div>
            <Button type="submit" className="w-full">
              Fortsätt
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
