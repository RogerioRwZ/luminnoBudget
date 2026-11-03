import { Input } from "@/components/ui/input";
import { documentProblem, emailProblem, formatDocument, formatPhone, phoneProblem } from "@shared/contact";
import { useState, type ComponentProps } from "react";

type BaseProps = Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: string;
  onValueChange: (value: string) => void;
  // true: o formulário não salva com o número inválido (aviso em vermelho).
  // false: só avisa (em âmbar) e deixa salvar.
  strict?: boolean;
  // Mostra o aviso mesmo antes de sair do campo (ex.: depois de tentar salvar).
  showProblem?: boolean;
};

function Field({ value, onValueChange, strict = false, showProblem = false, format, problem, ...props }: BaseProps & { format: (value: string) => string; problem: (value: string) => string | null; type?: string }) {
  const [touched, setTouched] = useState(false);
  const message = touched || showProblem ? problem(value) : null;
  const id = props.id ?? props["aria-label"]?.toString().replace(/\W+/g, "-");
  return (
    <div className="space-y-1">
      <Input
        {...props}
        id={props.id}
        aria-invalid={Boolean(message) || undefined}
        aria-describedby={message ? `${id}-problema` : undefined}
        value={value}
        onChange={event => onValueChange(format(event.target.value))}
        onBlur={event => {
          setTouched(true);
          props.onBlur?.(event);
        }}
      />
      {message ? (
        <p id={`${id}-problema`} className={`text-xs ${strict ? "text-destructive" : "text-amber-700 dark:text-amber-300"}`}>
          {message}
        </p>
      ) : null}
    </div>
  );
}

// CPF (123.456.789-00) ou CNPJ (12.345.678/0001-00), inclusive o CNPJ com
// letras: por isso o teclado é o completo, em maiúsculas.
export function DocumentInput(props: BaseProps) {
  return <Field autoCapitalize="characters" autoComplete="off" maxLength={18} placeholder="CPF ou CNPJ" {...props} format={formatDocument} problem={documentProblem} />;
}

// (00) 91234-5678 ou (00) 3123-4567, com teclado numérico.
export function PhoneInput(props: BaseProps) {
  return <Field type="tel" inputMode="tel" autoComplete="tel" maxLength={15} placeholder="(00) 91234-5678" {...props} format={formatPhone} problem={phoneProblem} />;
}

export function EmailInput(props: BaseProps) {
  return <Field type="email" inputMode="email" autoComplete="email" autoCapitalize="none" placeholder="nome@email.com" {...props} format={value => value.replace(/\s/g, "")} problem={emailProblem} />;
}
