import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export interface BuiltinSkills {
  mcp: Array<{ name: string; capabilities: string[] }>;
  prompt: Array<{ name: string; description: string }>;
}

export interface Skill {
  id: string;
  name: string;
  skillType: string;
  configJson: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedSkill {
  name: string;
  description: string;
  template: string;
}

export function useBuiltinSkills() {
  return useQuery<BuiltinSkills>({
    queryKey: ['skills', 'builtin'],
    queryFn: () => api.get('/skills/builtin'),
  });
}

export function useWorkspaceSkills() {
  return useQuery<Skill[]>({
    queryKey: ['skills'],
    queryFn: () => api.get('/skills'),
  });
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; type: string; description?: string; template?: string; capabilities?: string[] }) =>
      api.post<Skill>('/skills', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skills'] }),
  });
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; description?: string; template?: string; capabilities?: string[] }) =>
      api.put<Skill>(`/skills/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skills'] }),
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/skills/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skills'] }),
  });
}

export function useGenerateSkill() {
  return useMutation({
    mutationFn: (description: string) =>
      api.post<GeneratedSkill>('/skills/generate', { description }),
  });
}
