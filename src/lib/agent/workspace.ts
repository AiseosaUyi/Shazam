import fs from 'fs';
import path from 'path';
import { Checkpoint, WorkspaceFile } from '@/types/agent';
import { redactSecrets } from '@/lib/crypto/vault';

export class AgentWorkspace {
  readonly workspaceId: string;
  readonly baseDir: string;
  private checkpoints: Map<string, Checkpoint> = new Map();

  constructor(workspaceId: string, baseDir?: string) {
    this.workspaceId = workspaceId;
    this.baseDir = baseDir || path.resolve(process.cwd(), 'data', 'sandbox', workspaceId);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private resolvePath(subPath: string): string {
    const resolved = path.resolve(this.baseDir, subPath);
    if (!resolved.startsWith(this.baseDir)) {
      throw new Error(`Path traversal violation: "${subPath}" escapes workspace directory.`);
    }
    return resolved;
  }

  public listFiles(subPath = ''): WorkspaceFile[] {
    const targetDir = this.resolvePath(subPath);
    if (!fs.existsSync(targetDir)) return [];

    const files: WorkspaceFile[] = [];
    const entries = fs.readdirSync(targetDir, { withFileTypes: true });

    for (const ent of entries) {
      if (ent.name === '.git' || ent.name === 'node_modules') continue;
      const fullPath = path.join(targetDir, ent.name);
      const relPath = path.relative(this.baseDir, fullPath);

      if (ent.isDirectory()) {
        files.push(...this.listFiles(relPath));
      } else {
        const stat = fs.statSync(fullPath);
        files.push({
          path: relPath,
          sizeBytes: stat.size,
          lastModified: stat.mtime.toISOString(),
          isBinary: ent.name.endsWith('.png') || ent.name.endsWith('.bin'),
        });
      }
    }

    return files;
  }

  public readFile(filePath: string): string {
    const fullPath = this.resolvePath(filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    return fs.readFileSync(fullPath, 'utf8');
  }

  public writeFile(filePath: string, content: string): { path: string; oldContent?: string; newContent: string } {
    const fullPath = this.resolvePath(filePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const oldContent = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : undefined;
    fs.writeFileSync(fullPath, content, 'utf8');

    return {
      path: filePath,
      oldContent,
      newContent: content,
    };
  }

  public createCheckpoint(description: string): Checkpoint {
    const files = this.listFiles();
    const snapshot: Record<string, string> = {};

    for (const f of files) {
      if (!f.isBinary) {
        snapshot[f.path] = this.readFile(f.path);
      }
    }

    const checkpoint: Checkpoint = {
      id: `ckpt_${Date.now()}`,
      description,
      createdAt: new Date().toISOString(),
      files: snapshot,
    };

    this.checkpoints.set(checkpoint.id, checkpoint);
    return checkpoint;
  }

  public restoreCheckpoint(checkpointId: string): boolean {
    const ckpt = this.checkpoints.get(checkpointId);
    if (!ckpt) return false;

    for (const [relPath, content] of Object.entries(ckpt.files)) {
      this.writeFile(relPath, content);
    }
    return true;
  }

  public getCheckpoints(): Checkpoint[] {
    return Array.from(this.checkpoints.values());
  }

  public computeDiff(filePath: string, oldContent?: string, newContent?: string): string {
    if (oldContent === undefined) {
      return `--- /dev/null\n+++ b/${filePath}\n@@ +1 @@\n+` + (newContent || '').split('\n').join('\n+');
    }
    return `--- a/${filePath}\n+++ b/${filePath}\n@@ modified @@\n- ${oldContent.slice(0, 100)}\n+ ${newContent?.slice(0, 100)}`;
  }
}
