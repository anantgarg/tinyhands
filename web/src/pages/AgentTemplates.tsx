import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { useCreateAgent } from '@/api/agents';
import { toast } from '@/components/ui/use-toast';

interface Template {
  id: string;
  name: string;
  avatar: string;
  category: string;
  description: string;
  model: string;
  tools: string[];
  systemPrompt: string;
  respondTo: string;
  memoryEnabled: boolean;
}

const templates: Template[] = [
  {
    id: 'support-agent',
    name: 'Support Agent',
    avatar: '🎧',
    category: 'Customer Support',
    description: 'Handles customer inquiries using knowledge base and creates tickets',
    model: 'sonnet',
    tools: ['kb_search', 'zendesk'],
    systemPrompt: 'You are a helpful customer support agent. Use the knowledge base to answer questions and create tickets when issues need escalation.',
    respondTo: 'all',
    memoryEnabled: true,
  },
  {
    id: 'code-reviewer',
    name: 'Code Reviewer',
    avatar: '👨‍💻',
    category: 'Engineering',
    description: 'Reviews pull requests and provides code feedback',
    model: 'sonnet',
    tools: ['linear'],
    systemPrompt: 'You are a code review assistant. Review code changes, provide constructive feedback, and suggest improvements.',
    respondTo: 'mentions',
    memoryEnabled: false,
  },
  {
    id: 'research-analyst',
    name: 'Research Analyst',
    avatar: '🔍',
    category: 'Research',
    description: 'Conducts web research and summarizes findings',
    model: 'sonnet',
    tools: ['serpapi'],
    systemPrompt: 'You are a research analyst. Search the web, gather information, and provide well-structured summaries with citations.',
    respondTo: 'mentions',
    memoryEnabled: true,
  },
  {
    id: 'sales-assistant',
    name: 'Sales Assistant',
    avatar: '💼',
    category: 'Sales',
    description: 'Helps with CRM updates and sales pipeline management',
    model: 'sonnet',
    tools: ['hubspot'],
    systemPrompt: 'You are a sales assistant. Help the team manage contacts, deals, and pipeline activities in HubSpot.',
    respondTo: 'all',
    memoryEnabled: true,
  },
  {
    id: 'data-analyst',
    name: 'Data Analyst',
    avatar: '📊',
    category: 'Analytics',
    description: 'Analyzes product analytics and generates reports',
    model: 'sonnet',
    tools: ['posthog'],
    systemPrompt: 'You are a data analyst. Query product analytics, identify trends, and create clear reports with actionable insights.',
    respondTo: 'mentions',
    memoryEnabled: false,
  },
  {
    id: 'onboarding-buddy',
    name: 'Onboarding Buddy',
    avatar: '👋',
    category: 'HR',
    description: 'Guides new team members through onboarding',
    model: 'sonnet',
    tools: ['kb_search'],
    systemPrompt: 'You are a friendly onboarding buddy. Help new team members find information, answer questions about processes, and make them feel welcome.',
    respondTo: 'all',
    memoryEnabled: true,
  },
];

export function AgentTemplates() {
  const createAgent = useCreateAgent();
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [channels, setChannels] = useState('');

  const grouped = templates.reduce<Record<string, Template[]>>((acc, t) => {
    if (!acc[t.category]) acc[t.category] = [];
    acc[t.category].push(t);
    return acc;
  }, {});

  const handleUseTemplate = () => {
    if (!selectedTemplate) return;
    createAgent.mutate(
      {
        name: selectedTemplate.name,
        avatarEmoji: selectedTemplate.avatar,
        systemPrompt: selectedTemplate.systemPrompt,
        model: selectedTemplate.model,
        tools: selectedTemplate.tools,
        channelIds: channels.split(',').map((c) => c.trim()).filter(Boolean),
        memoryEnabled: selectedTemplate.memoryEnabled,
        mentionsOnly: selectedTemplate.respondTo === 'mentions',
      },
      {
        onSuccess: () => {
          toast({ title: 'Agent created from template', variant: 'success' });
          setSelectedTemplate(null);
          setChannels('');
        },
        onError: (err) => {
          toast({ title: 'Failed to create agent', description: err.message, variant: 'error' });
        },
      },
    );
  };

  return (
    <div>
      <Link to="/agents" className="inline-flex items-center gap-1 text-sm text-warm-text-secondary hover:text-warm-text mb-4">
        <ArrowLeft className="h-4 w-4" />
        Agents
      </Link>

      <PageHeader title="Agent Templates" description="Start with a pre-configured template" />

      {Object.entries(grouped).map(([category, categoryTemplates]) => (
        <div key={category} className="mb-8">
          <h2 className="text-sm font-medium text-warm-text-secondary mb-3">
            {category}
          </h2>
          <div className="grid grid-cols-3 gap-4">
            {categoryTemplates.map((template) => (
              <Card key={template.id} className="transition-colors hover:bg-warm-bg/30">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <span className="text-2xl">{template.avatar}</span>
                    <Badge variant="secondary">{template.model.replace('claude-', '').split('-')[0]}</Badge>
                  </div>
                  <h3 className="font-semibold mb-1">{template.name}</h3>
                  <p className="text-sm text-warm-text-secondary mb-3">{template.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-warm-text-secondary">{template.tools.length} tools</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelectedTemplate(template)}
                    >
                      Use
                      <ArrowRight className="ml-1 h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}

      <Dialog open={!!selectedTemplate} onOpenChange={() => setSelectedTemplate(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedTemplate?.avatar} {selectedTemplate?.name}
            </DialogTitle>
            <DialogDescription>{selectedTemplate?.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Channels (comma separated)</Label>
              <Input
                value={channels}
                onChange={(e) => setChannels(e.target.value)}
                placeholder="#general, #support"
                className="mt-1"
              />
            </div>
            <div className="text-sm text-warm-text-secondary">
              <p><strong>Model:</strong> {selectedTemplate?.model}</p>
              <p><strong>Tools:</strong> {selectedTemplate?.tools.join(', ') || 'None'}</p>
              <p><strong>Memory:</strong> {selectedTemplate?.memoryEnabled ? 'Enabled' : 'Disabled'}</p>
              <p><strong>Respond to:</strong> {selectedTemplate?.respondTo}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedTemplate(null)}>Cancel</Button>
            <Button onClick={handleUseTemplate} disabled={createAgent.isPending}>
              {createAgent.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating...</>
              ) : (
                'Create Agent'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
