import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/utils";

const field =
  "jelly-field w-full rounded-[14px] px-3.5 text-body placeholder:text-muted-foreground " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...p }, ref) => <input ref={ref} className={cn(field, "h-10", className)} {...p} />,
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...p }, ref) => <textarea ref={ref} className={cn(field, "min-h-32 py-2 leading-relaxed", className)} {...p} />,
);
Textarea.displayName = "Textarea";

export function Label({ className, ...p }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn("text-body-sm font-medium", className)} {...p} />;
}

/** Label + control + optional hint/error, consistently spaced. */
export function Field({ label, htmlFor, hint, error, children }: {
  label: string; htmlFor: string; hint?: React.ReactNode; error?: string | null; children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-caption text-destructive" role="alert">{error}</p>
        : hint ? <p className="text-caption text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
