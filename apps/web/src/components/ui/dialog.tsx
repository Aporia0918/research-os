import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as AlertPrimitive from "@radix-ui/react-alert-dialog";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "./button";

const overlay = "fixed inset-0 z-40 bg-[color-mix(in_srgb,var(--ink)_24%,transparent)] backdrop-blur-sm data-[state=open]:animate-in";
const panel =
  "fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 " +
  "jelly-glass rounded-[26px] p-6";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogContent({ className, children, title, description, ...p }:
  React.ComponentProps<typeof DialogPrimitive.Content> & { title: string; description?: string }) {
  const { t } = useTranslation();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlay} />
      <DialogPrimitive.Content className={cn(panel, className)} {...p}>
        <div className="grid gap-1 pr-8">
          <DialogPrimitive.Title className="text-title font-semibold">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="text-body-sm text-muted-foreground">{description}</DialogPrimitive.Description>
          ) : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
        </div>
        {children}
        <DialogPrimitive.Close asChild>
          <Button variant="ghost" size="icon" className="absolute right-3 top-3" aria-label={t("common.close")}><X /></Button>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Confirmation for destructive / irreversible actions. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, destructive, onConfirm, busy, error, confirmDisabled, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; confirmLabel: string;
  destructive?: boolean; onConfirm: () => void; busy?: boolean; error?: string; confirmDisabled?: boolean; children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <AlertPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertPrimitive.Portal>
        <AlertPrimitive.Overlay className={overlay} />
        <AlertPrimitive.Content className={panel}>
          <AlertPrimitive.Title className="text-title font-semibold">{title}</AlertPrimitive.Title>
          <AlertPrimitive.Description className="text-body-sm text-muted-foreground">{description}</AlertPrimitive.Description>
          {children}
          {error && <p role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <AlertPrimitive.Cancel asChild><Button size="touch" disabled={busy} variant="outline">{t("common.cancel")}</Button></AlertPrimitive.Cancel>
            <Button size="touch" variant={destructive ? "destructive" : "default"} loading={busy} disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</Button>
          </div>
        </AlertPrimitive.Content>
      </AlertPrimitive.Portal>
    </AlertPrimitive.Root>
  );
}
