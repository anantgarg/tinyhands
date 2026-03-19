import { useState } from 'react';
import { Wrench, Check, Settings, Trash2, MoreVertical } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  useIntegrations,
  useRegisterIntegration,
  useCustomTools,
  useApproveCustomTool,
  useDeleteCustomTool,
} from '@/api/tools';
import { toast } from '@/components/ui/use-toast';

export function Tools() {
  const { data: integrations, isLoading: intLoading } = useIntegrations();
  const { data: customTools, isLoading: ctLoading } = useCustomTools();
  const registerIntegration = useRegisterIntegration();
  const approveCustomTool = useApproveCustomTool();
  const deleteCustomTool = useDeleteCustomTool();

  const [registerDialog, setRegisterDialog] = useState<{
    id: string;
    name: string;
    configKeys: { key: string; label: string; required: boolean; secret: boolean }[];
  } | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});

  const connected = (integrations ?? []).filter((i) => i.status === 'active');
  const available = (integrations ?? []).filter((i) => i.status !== 'active');

  const handleRegister = () => {
    if (!registerDialog) return;
    registerIntegration.mutate(
      { integrationId: registerDialog.id, config: configValues },
      {
        onSuccess: () => {
          toast({ title: 'Integration registered', variant: 'success' });
          setRegisterDialog(null);
          setConfigValues({});
        },
        onError: (err) => {
          toast({ title: 'Registration failed', description: err.message, variant: 'error' });
        },
      },
    );
  };

  const handleApprove = (id: string) => {
    approveCustomTool.mutate(id, {
      onSuccess: () => toast({ title: 'Tool approved', variant: 'success' }),
    });
  };

  const handleDelete = (id: string, name: string) => {
    if (confirm(`Delete custom tool "${name}"?`)) {
      deleteCustomTool.mutate(id, {
        onSuccess: () => toast({ title: 'Tool deleted', variant: 'success' }),
      });
    }
  };

  return (
    <div>
      <PageHeader title="Tools & Integrations" description="Manage tool connections and custom tools" />

      {/* Connected Integrations */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Connected Integrations</h2>
        {intLoading ? (
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[120px]" />
            ))}
          </div>
        ) : connected.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-warm-text-secondary">
              No integrations connected yet. Register one below.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {connected.map((integration) => (
              <Card key={integration.id}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold">{integration.displayName}</h3>
                      <p className="text-xs text-warm-text-secondary">{integration.description}</p>
                    </div>
                    <Badge variant="success">Active</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-warm-text-secondary">{integration.toolsCount} tools</span>
                    <Button size="sm" variant="outline">
                      <Settings className="mr-1 h-3 w-3" />
                      Configure
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Available Integrations */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Available Integrations</h2>
        {intLoading ? (
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[120px]" />
            ))}
          </div>
        ) : available.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-warm-text-secondary">
              All integrations are connected.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {available.map((integration) => (
              <Card key={integration.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="mb-3">
                    <h3 className="font-semibold">{integration.displayName}</h3>
                    <p className="text-xs text-warm-text-secondary mt-1">{integration.description}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setRegisterDialog({
                        id: integration.id,
                        name: integration.displayName,
                        configKeys: integration.configKeys,
                      });
                      setConfigValues({});
                    }}
                  >
                    Register
                    <Check className="ml-1 h-3 w-3" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Custom Tools */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Custom Tools</h2>
        {ctLoading ? (
          <Skeleton className="h-[200px]" />
        ) : (customTools ?? []).length === 0 ? (
          <EmptyState
            icon={Wrench}
            title="No custom tools"
            description="Custom tools created by agents will appear here for review"
          />
        ) : (
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Access</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(customTools ?? []).map((tool) => (
                    <TableRow key={tool.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{tool.displayName}</p>
                          <p className="text-xs text-warm-text-secondary">{tool.description}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{tool.type}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={tool.accessLevel === 'read-write' ? 'warning' : 'default'}>
                          {tool.accessLevel}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={tool.approved ? 'success' : 'warning'}>
                          {tool.approved ? 'Approved' : 'Pending'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-warm-text-secondary text-xs">
                        {formatDistanceToNow(new Date(tool.createdAt), { addSuffix: true })}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {!tool.approved && (
                              <DropdownMenuItem onClick={() => handleApprove(tool.id)}>
                                <Check className="mr-2 h-4 w-4" />
                                Approve
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-red-600"
                              onClick={() => handleDelete(tool.id, tool.displayName)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>

      {/* Register Dialog */}
      <Dialog open={!!registerDialog} onOpenChange={() => setRegisterDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Register {registerDialog?.name}</DialogTitle>
            <DialogDescription>Enter the configuration values for this integration</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {(registerDialog?.configKeys ?? []).map((key) => (
              <div key={key.key}>
                <Label>
                  {key.label}
                  {key.required && <span className="text-red-500 ml-1">*</span>}
                </Label>
                <Input
                  type={key.secret ? 'password' : 'text'}
                  value={configValues[key.key] ?? ''}
                  onChange={(e) => setConfigValues((prev) => ({ ...prev, [key.key]: e.target.value }))}
                  className="mt-1"
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegisterDialog(null)}>Cancel</Button>
            <Button onClick={handleRegister} disabled={registerIntegration.isPending}>
              Register
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
