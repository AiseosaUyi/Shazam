import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractSymbolsFromContent, buildProjectIndex } from '../src/lib/agent/indexer';

describe('Codebase Indexer & Symbol Extractor Tests', () => {
  it('extracts exported functions, classes, and types from code', () => {
    const code = `
import { useState, useEffect } from 'react';
import type { User } from '@/lib/types';

export interface UserProps {
  id: string;
}

export function UserProfile(props: UserProps) {
  return <div>Profile</div>;
}

export const fetchUser = async (id: string) => {};

class DatabaseManager {
  connect() {}
}
`;

    const symbols = extractSymbolsFromContent(code);
    assert.ok(symbols.exports.length >= 2);
    assert.ok(symbols.declarations.includes('UserProfile') || symbols.declarations.includes('UserProps'));
    assert.ok(symbols.imports.length >= 1);
  });

  it('builds structured project index without naive file truncation', () => {
    const files = [
      { path: 'package.json', content: '{"name": "test-project", "scripts": {"test": "node --test"}}' },
      { path: 'src/index.ts', content: 'export function startServer() {}\nexport const PORT = 3000;' },
      { path: 'src/utils.ts', content: 'export function sanitize(s: string) { return s.trim(); }' },
    ];

    const index = buildProjectIndex(files);
    assert.equal(index.tree.length, 3);
    assert.ok(index.keyConfigs['package.json']);
    assert.ok(index.summaryPrompt.includes('Project File Tree (3 files)'));
    assert.ok(index.summaryPrompt.includes('startServer'));
    assert.ok(index.summaryPrompt.includes('sanitize'));
  });
});
