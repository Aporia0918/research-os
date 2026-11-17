import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center justify-self-start gap-2 whitespace-nowrap rounded-full text-body-sm font-medium " +
    "transition-[color,background-color,filter,transform] " +
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 select-none",
  {
    variants: {
      variant: {
        default: "jelly-primary",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "jelly-field hover:bg-accent hover:text-accent-foreground",
        secondary: "jelly-track text-foreground hover:bg-accent",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // min 40px height everywhere; 44px "touch" for iPad primary actions
      size: { default: "h-10 px-4", sm: "h-9 px-3", lg: "h-11 px-6", touch: "h-11 px-5", icon: "size-10" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? children : <>{loading ? <Loader2 className="animate-spin" aria-hidden /> : null}{children}</>}
      </Comp>
    );
  },
);
Button.displayName = "Button";
