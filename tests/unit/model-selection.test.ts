import { describe, it, expect } from 'vitest';
import { parseModelOverride, stripModelOverride } from '../../src/modules/model-selection';

describe('Model Override Parsing', () => {
  it('should parse [run with opus]', () => {
    expect(parseModelOverride('Do this task [run with opus]')).toBe('opus');
  });

  it('should parse [use sonnet]', () => {
    expect(parseModelOverride('[use sonnet] analyze this')).toBe('sonnet');
  });

  it('should parse [run with haiku]', () => {
    expect(parseModelOverride('Quick task [run with haiku]')).toBe('haiku');
  });

  it('should return null when no override present', () => {
    expect(parseModelOverride('Regular task without override')).toBeNull();
  });

  it('should be case insensitive', () => {
    expect(parseModelOverride('[Run With Opus]')).toBe('opus');
  });
});

describe('Model Override Stripping', () => {
  it('should strip override from message', () => {
    expect(stripModelOverride('Do this [run with opus]')).toBe('Do this');
  });

  it('should strip multiple patterns', () => {
    expect(stripModelOverride('[use haiku] task')).toBe('task');
  });

  it('should leave message unchanged when no override', () => {
    expect(stripModelOverride('Normal task')).toBe('Normal task');
  });
});
