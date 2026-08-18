import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import {
  seedUserWorkspace,
  DEFAULT_VSCODE_SETTINGS_JSON,
  DEFAULT_VSCODE_EXTENSIONS_JSON,
  DEFAULT_VSCODE_KEYBINDINGS_JSON,
} from '../seeder.js';

describe('Workspace Seeder & VSCode Configuration', () => {
  let tmpDir: string;
  let workspaceDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podarcis-test-'));
    workspaceDir = path.join(tmpDir, 'user-workspace');
  });

  afterEach(() => {
    fs.removeSync(tmpDir);
  });

  it('correctly seeds .vscode configuration and .podarcis/templates/vscode', () => {
    seedUserWorkspace(workspaceDir, 'testuser', tmpDir);

    // Verify .vscode active configuration
    const vscodeDir = path.join(workspaceDir, '.vscode');
    expect(fs.existsSync(vscodeDir)).toBe(true);

    const settingsFile = path.join(vscodeDir, 'settings.json');
    expect(fs.existsSync(settingsFile)).toBe(true);
    const settings = fs.readJsonSync(settingsFile);
    expect(settings['window.title']).toBe('🦎 Podarcis | Knowledge Base');
    expect(settings['workbench.colorCustomizations']['titleBar.activeBackground']).toBe('#1f3970');
    expect(settings['editor.fontFamily']).toContain('JetBrains Mono');

    const extensionsFile = path.join(vscodeDir, 'extensions.json');
    expect(fs.existsSync(extensionsFile)).toBe(true);
    const extensions = fs.readJsonSync(extensionsFile);
    expect(extensions.recommendations).toContain('saoudrizwan.claude-dev');
    expect(extensions.recommendations).toContain('houkanshan.vscode-markdown-footnote');

    const keybindingsFile = path.join(vscodeDir, 'keybindings.json');
    expect(fs.existsSync(keybindingsFile)).toBe(true);
    const keybindings = fs.readJsonSync(keybindingsFile);
    expect(keybindings).toEqual(DEFAULT_VSCODE_KEYBINDINGS_JSON);

    // Verify .podarcis/templates/vscode
    const templateDir = path.join(workspaceDir, '.podarcis', 'templates', 'vscode');
    expect(fs.existsSync(templateDir)).toBe(true);
    expect(fs.existsSync(path.join(templateDir, 'settings.json'))).toBe(true);
    expect(fs.existsSync(path.join(templateDir, 'extensions.json'))).toBe(true);
    expect(fs.existsSync(path.join(templateDir, 'keybindings.json'))).toBe(true);
  });
});
