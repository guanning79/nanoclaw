import { describe, it, expect } from 'vitest';

import { resolveContainerPaths } from './ipc.js';
import type { RegisteredGroup } from './types.js';

const GROUP: RegisteredGroup = {
  name: 'Main',
  folder: 'discord_main',
  trigger: 'always',
  added_at: '2024-01-01T00:00:00.000Z',
  isMain: true,
  containerConfig: {
    additionalMounts: [
      { hostPath: 'D:/Dev', containerPath: 'Dev', readonly: false },
      { hostPath: 'C:/Users/guann/Documents', containerPath: 'Documents', readonly: true },
    ],
  },
};
const GROUP_DIR = 'D:/Dev/Tools/nanoclaw/groups/discord_main';
const GROUP_DIR_NORM = GROUP_DIR.replace(/\\/g, '/');

describe('resolveContainerPaths', () => {
  it('resolves /workspace/group/ path', () => {
    const result = resolveContainerPaths(
      ['/workspace/group/report.pdf'],
      GROUP,
      GROUP_DIR,
    );
    expect(result).toEqual([`${GROUP_DIR_NORM}/report.pdf`]);
  });

  it('resolves /workspace/extra/Dev/ path', () => {
    const result = resolveContainerPaths(
      ['/workspace/extra/Dev/output.csv'],
      GROUP,
      GROUP_DIR,
    );
    expect(result).toEqual(['D:/Dev/output.csv']);
  });

  it('resolves /workspace/extra/Documents/ path', () => {
    const result = resolveContainerPaths(
      ['/workspace/extra/Documents/file.pdf'],
      GROUP,
      GROUP_DIR,
    );
    expect(result).toEqual(['C:/Users/guann/Documents/file.pdf']);
  });

  it('resolves relative path as /workspace/group/', () => {
    const result = resolveContainerPaths(
      ['attachments/file.pdf'],
      GROUP,
      GROUP_DIR,
    );
    expect(result).toEqual([`${GROUP_DIR_NORM}/attachments/file.pdf`]);
  });

  it('skips paths outside any known mount', () => {
    const result = resolveContainerPaths(['/etc/passwd'], GROUP, GROUP_DIR);
    expect(result).toHaveLength(0);
  });

  it('blocks path traversal via /workspace/group/', () => {
    const result = resolveContainerPaths(
      ['/workspace/group/../../data/messages.db'],
      GROUP,
      GROUP_DIR,
    );
    expect(result).toHaveLength(0);
  });

  it('handles multiple paths, mixed mounts', () => {
    const result = resolveContainerPaths(
      ['/workspace/group/a.txt', '/workspace/extra/Dev/b.csv'],
      GROUP,
      GROUP_DIR,
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('a.txt');
    expect(result[1]).toContain('b.csv');
  });

  it('returns empty array for empty input', () => {
    const result = resolveContainerPaths([], GROUP, GROUP_DIR);
    expect(result).toEqual([]);
  });

  it('works when group has no additionalMounts', () => {
    const noMountsGroup: RegisteredGroup = {
      name: 'Simple',
      folder: 'discord_simple',
      trigger: '@Andy',
      added_at: '2024-01-01T00:00:00.000Z',
    };
    const result = resolveContainerPaths(
      ['/workspace/group/file.txt'],
      noMountsGroup,
      GROUP_DIR,
    );
    expect(result).toEqual([`${GROUP_DIR_NORM}/file.txt`]);
  });
});
