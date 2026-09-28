import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Logga in — DeepGrader" };

export default function LoginPage() {
  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <AuthForm />
    </div>
  );
}
