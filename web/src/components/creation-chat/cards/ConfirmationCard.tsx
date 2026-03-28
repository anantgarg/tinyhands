import { useState } from 'react';
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react';

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
  systemPrompt?: string;
  triggers?: Array<{ type: string; description: string }>;
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

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="pt-2.5 pb-1">
      <p className="text-[10px] font-semibold text-warm-text-secondary uppercase tracking-wider">{label}</p>
    </div>
  );
}

export function ConfirmationCard({ config, onConfirm, onChange, isCreating, disabled }: ConfirmationCardProps) {
  const [promptExpanded, setPromptExpanded] = useState(false);

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
        {/* Agent section */}
        <SectionHeader label="Agent" />
        <ConfigRow label="Name" value={`${config.avatarEmoji ? config.avatarEmoji + ' ' : ''}${config.name}`} />
        <ConfigRow label="Model" value={MODEL_LABELS[config.model] || config.model} />

        {/* Channel section */}
        {config.channelName && (
          <>
            <SectionHeader label="Channel" />
            <ConfigRow label="Channel" value={`#${config.channelName}`} />
          </>
        )}

        {/* Response mode section */}
        <SectionHeader label="Response Mode" />
        <ConfigRow label="When it responds" value={ACTIVATION_LABELS[config.activation] || config.activation} />

        {/* Tools section */}
        <SectionHeader label="Tools" />
        <div className="py-1.5">
          {toolLabels.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {toolLabels.map((label) => (
                <span key={label} className="rounded-full bg-brand-light px-2 py-0.5 text-[10px] font-medium text-brand">
                  {label}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs font-medium text-warm-text">Core tools only</p>
          )}
        </div>

        {/* Triggers section */}
        {config.triggers && config.triggers.length > 0 && (
          <>
            <SectionHeader label="Triggers" />
            {config.triggers.map((trigger, i) => (
              <ConfigRow key={i} label={trigger.type === 'schedule' ? 'Schedule' : trigger.type.charAt(0).toUpperCase() + trigger.type.slice(1)} value={trigger.description} />
            ))}
          </>
        )}
        {config.scheduleCron && !config.triggers?.some(t => t.type === 'schedule') && (
          <>
            <SectionHeader label="Triggers" />
            <ConfigRow label="Schedule" value={`${config.scheduleCron} (${config.scheduleTimezone || 'UTC'})`} />
          </>
        )}

        {/* Behavior section */}
        <SectionHeader label="Behavior" />
        <ConfigRow label="Effort" value={EFFORT_LABELS[String(config.maxTurns)] || 'Standard'} />
        <ConfigRow label="Memory" value={config.memoryEnabled ? 'Enabled' : 'Disabled'} />

        {/* Access section */}
        <SectionHeader label="Access" />
        <ConfigRow label="Who can use it" value={ACCESS_LABELS[config.defaultAccess] || config.defaultAccess} />
        <ConfigRow label="Action approval" value={WRITE_POLICY_LABELS[config.writePolicy] || config.writePolicy} />

        {/* Instructions section (collapsible) */}
        {config.systemPrompt && (
          <>
            <div className="py-1.5">
              <button
                type="button"
                onClick={() => setPromptExpanded(!promptExpanded)}
                className="flex items-center gap-1.5 text-xs text-warm-text-secondary hover:text-warm-text transition-colors"
              >
                {promptExpanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                <span>Instructions</span>
              </button>
              {promptExpanded && (
                <div className="mt-2 max-h-40 overflow-y-auto rounded-md bg-gray-50 p-2">
                  <pre className="whitespace-pre-wrap text-[10px] font-mono text-warm-text leading-relaxed">
                    {config.systemPrompt}
                  </pre>
                </div>
              )}
            </div>
          </>
        )}
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
