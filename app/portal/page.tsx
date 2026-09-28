import { PortalCodeForm } from "@/components/portal-code-form";
import { BarChart3 } from "lucide-react";

export const metadata = { title: "Elevportal — DeepGrader" };

export default function PortalEntryPage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="flex items-center justify-center gap-2">
          <BarChart3 className="h-7 w-7 text-primary" />
          <span className="text-xl font-semibold tracking-tight">DeepGrader</span>
        </div>
        <p className="text-sm text-muted-foreground">
          Ange koden du fått av läraren för att se provrapporten.
        </p>
        <PortalCodeForm />
      </div>
    </div>
  );
}
