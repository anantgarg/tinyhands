import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-brand text-white hover:bg-brand-hover active:scale-[0.98]',
        secondary: 'bg-warm-bg text-warm-text border border-warm-border hover:bg-white hover:border-warm-text-secondary/30',
        danger: 'bg-red-600 text-white hover:bg-red-700 active:scale-[0.98]',
        ghost: 'text-warm-text-secondary hover:text-warm-text hover:bg-warm-bg',
        outline: 'border border-warm-border bg-white text-warm-text hover:bg-warm-bg',
        link: 'text-brand underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        sm: 'h-8 px-3 text-xs rounded-btn',
        default: 'h-10 px-5 rounded-btn',
        lg: 'h-12 px-8 text-base rounded-btn',
        icon: 'h-9 w-9 rounded-btn',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
