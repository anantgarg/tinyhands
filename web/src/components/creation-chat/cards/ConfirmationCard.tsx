import { Loader2 } from 'lucide-react';

const MODEL_LABELS: Record<string, string> = {
  sonnet: 'Sonnet',
  opus: 'Opus',
  haiku: 'Haiku',
};

const EFFORT_LABELS: Record<string, string> = {
  '10': 'Quick',
  '25': 'Standard',
  '50': 'Thorough',
  '100': 'Maximum',
};

const ACCESS_LABELS: Record<string, string> = {
  member: 'Full Access',
  viewer: 'Limited Access',
  none: 'Invite Only',
};

const WRITE_POLICY_LABELS: Record<string, string> = {
  auto: 'Automatic',
  confirm: 'Ask User First',
  admin_confirm: 'Ask Owner/Admins',
};

const ACTIVATION_LABELS: Record<string, string> = {
  mentions: 'Only when @mentioned',
  relevant: 'Relevant messages',
  all: 'Every message',
};

export interface ConfirmationConfig {
  name: string;
  avatarEmoji?: string;
  model: string;
  maxTurns: number;
  activation: string;
  memoryEnabled: boolean;
  defaultAccess: string;
  writePolicy: string;
  tools: string[];
  channelName?: string;
  scheduleCron?: string;
  scheduleTimezone?: string;
}

interface ConfirmationCardProps {
  config: ConfirmationConfig;
  onConfirm: () => void;
  onChange: () => void;
  isCreating: boolean;
  disabled?: boolean;
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between py-1.5">
      <span className="text-xs text-warm-text-secondary">{label}</span>
      <span className="text-xs font-medium text-warm-text text-right max-w-[60%]">{value}</span>
    </div>
  );
}

export function ConfirmationCard({ config, onConfirm, onChange, isCreating, disabled }: ConfirmationCardProps) {
  const toolLabels = config.tools.length > 0
    ? config.tools
        .filter((t) => !t.endsWith('-read') || !config.tools.includes(t.replace('-read', '-write')))
        .map((t) => {
          const base = t.replace(/-read$/, '').replace(/-write$/, '').replace(/-search$/, '');
          const isWrite = t.endsWith('-write');
          const name = base.charAt(0).toUpperCase() + base.slice(1).replace(/[-_]/g, ' ');
          return isWrite ? `${name} (read + write)` : name;
        })
    : [];

  return (
    <div className="mt-2 rounded-lg border border-warm-border bg-white overflow-hidden">
      <div className="border-b border-warm-border bg-warm-bg px-3 py-2">
        <p className="text-xs font-semibold text-warm-text uppercase tracking-wider">Review your agent</p>
      </div>
      <div className="px-3 py-1 divide-y divide-warm-border/50">
        <ConfigRow label="Name" value={`${config.avatarEmoji ? config.avatarEmoji + ' ' : ''}${config.name}`} />
        <ConfigRow label="Model" value={MODEL_LABELS[config.model] || config.model} />
        <ConfigRow label="Effort" value={EFFORT_LABELS[String(config.maxTurns)] || 'Standard'} />
        <ConfigRow label="Activation" value={ACTIVATION_LABELS[config.activation] || config.activation} />
        <ConfigRow label="Memory" value={config.memoryEnabled ? 'Enabled' : 'Disabled'} />
        <ConfigRow label="Access" value={ACCESS_LABELS[config.defaultAccess] || config.defaultAccess} />
        <ConfigRow label="Action approval" value={WRITE_POLICY_LABELS[config.writePolicy] || config.writePolicy} />
        {config.channelName && <ConfigRow label="Channel" value={`#${config.channelName}`} />}
        {config.scheduleCron && (
          <ConfigRow label="Schedule" value={`${config.scheduleCron} (${config.scheduleTimezone || 'UTC'})`} />
        )}
        <div className="py-1.5">
          <span className="text-xs text-warm-text-secondary">Services</span>
          {toolLabels.length > 0 ? (
            <div className="flex flex-wrap gap-1 mt-1">
              {toolLabels.map((label) => (
                <span key={label} className="rounded-full bg-brand-light px-2 py-0.5 text-[10px] font-medium text-brand">
                  {label}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs font-medium text-warm-text mt-0.5">Core tools only</p>
          )}
        </div>
      </div>
      {!disabled && (
        <div className="flex gap-2 border-t border-warm-border px-3 py-3">
          <button
            onClick={onConfirm}
            disabled={isCreating}
            className="flex-1 flex items-center justify-center gap-2 rounded-btn bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-60"
          >
            {isCreating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Agent'
            )}
          </button>
          <button
            onClick={onChange}
            disabled={isCreating}
            className="rounded-btn border border-warm-border bg-white px-4 py-2 text-sm font-medium text-warm-text transition-colors hover:bg-warm-bg disabled:opacity-60"
          >
            Change something
          </button>
        </div>
      )}
    </div>
  );
}
