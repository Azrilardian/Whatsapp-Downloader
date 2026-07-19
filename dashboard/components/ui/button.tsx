import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-normal whitespace-nowrap transition-[transform,background-color,border-color,box-shadow,opacity] duration-150 ease-out outline-none focus-visible:shadow-[0_4px_12px_rgba(0,0,0,0.1)] active:duration-75 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[rgba(255,255,255,0.2)_0px_0.5px_0px_0px_inset,rgba(0,0,0,0.2)_0px_0px_0px_0.5px_inset,rgba(0,0,0,0.05)_0px_1px_2px_0px] hover:-translate-y-px hover:shadow-[rgba(255,255,255,0.25)_0px_0.5px_0px_0px_inset,rgba(0,0,0,0.25)_0px_0px_0px_0.5px_inset,rgba(0,0,0,0.12)_0px_3px_8px_0px] active:translate-y-0 active:opacity-90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 hover:-translate-y-px active:translate-y-0 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline:
          "border border-[rgba(28,28,28,0.4)] bg-transparent text-foreground hover:border-foreground hover:bg-foreground/[0.03] active:bg-foreground/[0.06]",
        secondary: "bg-background text-foreground hover:bg-foreground/[0.03] active:bg-foreground/[0.06]",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
