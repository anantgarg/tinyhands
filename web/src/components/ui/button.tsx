import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-brand text-white hover:bg-brand-hover shadow-sm hover:shadow',
        secondary: 'bg-warm-sidebar text-warm-text hover:bg-warm-border',
        danger: 'bg-red-500 text-white hover:bg-red-600 shadow-sm',
        ghost: 'hover:bg-warm-sidebar text-warm-text',
        outline: 'border border-warm-border bg-white hover:bg-warm-sidebar text-warm-text',
      },
      size: {
        sm: 'h-8 px-3 text-xs rounded-btn',
        default: 'h-10 px-4 py-2 rounded-btn',
        lg: 'h-12 px-6 text-base rounded-btn',
        icon: 'h-10 w-10 rounded-btn',
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
