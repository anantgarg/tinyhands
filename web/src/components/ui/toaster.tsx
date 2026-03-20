import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '@/components/ui/toast';
import { useToast } from '@/components/ui/use-toast';
import type { ToastVariant } from '@/components/ui/use-toast';

function mapVariant(v: ToastVariant | undefined) {
  if (v === 'success') return 'success' as const;
  if (v === 'error') return 'error' as const;
  return 'default' as const;
}

export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <ToastProvider>
      {toasts.map(({ id, title, description, variant, ...props }) => (
        <Toast key={id} variant={mapVariant(variant)} {...props}>
          <div className="grid gap-1 pr-6">
            {title && <ToastTitle>{title}</ToastTitle>}
            {description && <ToastDescription>{description}</ToastDescription>}
          </div>
          <button
            onClick={() => dismiss(id)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-warm-text-secondary hover:text-warm-text"
          >
            <span className="text-lg leading-none">&times;</span>
          </button>
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
