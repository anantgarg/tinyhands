import { describe, it, expect } from 'vitest';
import {
  isActionAllowed,
  validateIntegrationAccess,
} from '../../src/modules/permissions';

describe('Integration Access', () => {
  it('should allow read operations for read level', () => {
    expect(isActionAllowed('read', 'query')).toBe(true);
    expect(isActionAllowed('read', 'search')).toBe(true);
    expect(isActionAllowed('read', 'create')).toBe(false);
  });

  it('should allow write operations for write level', () => {
    expect(isActionAllowed('write', 'create')).toBe(true);
    expect(isActionAllowed('write', 'update')).toBe(true);
    expect(isActionAllowed('write', 'delete')).toBe(false);
  });

  it('should allow all operations for admin level', () => {
    expect(isActionAllowed('admin', 'delete')).toBe(true);
    expect(isActionAllowed('admin', 'configure')).toBe(true);
    expect(isActionAllowed('admin', 'manage')).toBe(true);
  });

  it('should validate integration access levels', () => {
    expect(validateIntegrationAccess('read')).toBe(true);
    expect(validateIntegrationAccess('write')).toBe(true);
    expect(validateIntegrationAccess('admin')).toBe(true);
    expect(validateIntegrationAccess('invalid')).toBe(false);
  });
});
