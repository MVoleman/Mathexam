import { ExamUploadForm } from "@/components/exam-upload-form";

export default function NewExamPage() {
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nytt prov</h1>
        <p className="text-sm text-muted-foreground">
          Ladda upp provet som PDF. Varje sida konverteras till bilder som AI:n kan läsa.
        </p>
      </div>
      <ExamUploadForm />
    </div>
  );
}
