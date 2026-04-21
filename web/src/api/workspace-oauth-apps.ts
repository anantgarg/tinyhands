import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export type OAuthProvider = 'google' | 'notion' | 'github';

export type OAuthPublishingStatus =
  | 'internal'
  | 'external_testing'
  | 'external_production';

export interface OAuthAppStatus {
  configured: boolean;
  provider: OAuthProvider;
  clientIdMasked?: string;
  publishingStatus?: OAuthPublishingStatus | null;
  configuredAt?: string;
  updatedAt?: string;
  redirectUri: string;
}

export interface TestResult {
  ok: boolean;
  errorCode?: string;
  reason?: string;
}

export interface SaveOAuthAppInput {
  clientId: string;
  clientSecret: string;
  publishingStatus?: OAuthPublishingStatus | null;
}

export function useOAuthAppStatus(provider: OAuthProvider) {
  return useQuery<OAuthAppStatus>({
    queryKey: ['workspace-oauth-apps', provider],
    queryFn: () => api.get(`/connections/workspace-oauth-apps/${provider}`),
  });
}

export function useSaveOAuthApp(provider: OAuthProvider) {
  const qc = useQueryClient();
  return useMutation<OAuthAppStatus, Error, SaveOAuthAppInput>({
    mutationFn: (input) => api.put(`/connections/workspace-oauth-apps/${provider}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspace-oauth-apps', provider] }),
  });
}

export function useDeleteOAuthApp(provider: OAuthProvider) {
  const qc = useQueryClient();
  return useMutation<{ ok: true }, Error, void>({
    mutationFn: () => api.del(`/connections/workspace-oauth-apps/${provider}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspace-oauth-apps', provider] }),
  });
}

export function useTestOAuthApp(provider: OAuthProvider) {
  return useMutation<TestResult, Error, void>({
    mutationFn: () => api.post(`/connections/workspace-oauth-apps/${provider}/test`, {}),
  });
}
