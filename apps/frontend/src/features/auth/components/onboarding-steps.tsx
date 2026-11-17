import { Steps, type StepState } from "@/components/ui/display";

type Step = "password" | "terms" | "mfa" | "profile";
const ORDER: readonly Step[] = ["password", "terms", "mfa", "profile"];
const LABEL: Record<Step, string> = { password: "Senha", terms: "Termos", mfa: "Verificação", profile: "Cadastro" };

/** Progresso do primeiro acesso: senha → termos → MFA → cadastro pessoal (079). */
export function OnboardingSteps({ current, withPassword = true }: { current: Step; withPassword?: boolean }) {
  const order = withPassword ? ORDER : ORDER.filter((s) => s !== "password");
  const at = order.indexOf(current);
  return (
    <Steps
      className="mb-6"
      steps={order.map((key, i) => ({ key, label: LABEL[key], state: (i < at ? "done" : i === at ? "current" : "pending") as StepState }))}
    />
  );
}
