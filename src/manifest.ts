/**
 * Manifest 读写（见方案 §11）。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Manifest } from './types.js';

export const MANIFEST_FILE = '.manifest.json';

export async function readManifest(novelDir: string): Promise<Manifest | null> {
  try {
    const text = await readFile(join(novelDir, MANIFEST_FILE), 'utf8');
    const data = JSON.parse(text) as Manifest;
    if (typeof data.contentHash !== 'string') return null;
    return data;
  } catch {
    return null;
  }
}

export async function writeManifest(novelDir: string, manifest: Manifest): Promise<void> {
  const json = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(join(novelDir, MANIFEST_FILE), json, 'utf8');
}
