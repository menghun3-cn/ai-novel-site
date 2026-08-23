// 媒体存储(V2 媒体管理):data/media/ 下的受控文件
// 复用 core 的数据目录定位(getDbPath),与数据库同源、随 NOVEL_DATA_DIR 可迁移

import fs from 'node:fs';
import path from 'node:path';
import { getDbPath } from '@novel/core';

export const MEDIA_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;

export const MEDIA_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

/** 媒体层错误:由路由映射 HTTP */
export class MediaError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string
  ) {
    super(message ?? code);
    this.name = 'MediaError';
  }
}

export function mediaRoot(): string {
  return path.join(path.dirname(getDbPath()), 'media');
}

/**
 * 文件名白名单:仅字母数字点横线下划线 + 受支持扩展名。
 * 含路径分隔符或 .. 的名字一律显式拒绝(不做静默改写),上传名永远只是 data/media/ 的直接子文件。
 */
export function sanitizeMediaName(raw: string): string {
  const base = raw.trim();
  if (!base || base.startsWith('.') || /[/\\]/.test(base) || base.includes('..')) {
    throw new MediaError(400, 'INVALID_MEDIA_NAME', `bad media name: ${raw}`);
  }
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(base)) {
    throw new MediaError(400, 'INVALID_MEDIA_NAME', `name may only contain [A-Za-z0-9._-]: ${raw}`);
  }
  const ext = path.extname(base).toLowerCase();
  if (!MEDIA_EXTENSIONS.has(ext)) {
    throw new MediaError(
      400,
      'UNSUPPORTED_MEDIA_TYPE',
      `extension must be one of ${[...MEDIA_EXTENSIONS].join(', ')}`
    );
  }
  return base;
}

export interface MediaItem {
  name: string;
  size: number;
  url: string;
  uploadedAt: string;
}

export function listMedia(): MediaItem[] {
  const root = mediaRoot();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => {
      const full = path.join(root, e.name);
      const st = fs.statSync(full);
      return {
        name: e.name,
        size: st.size,
        url: `/media/${encodeURIComponent(e.name)}`,
        uploadedAt: st.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export function saveMedia(rawName: string, bytes: Buffer): MediaItem {
  const name = sanitizeMediaName(rawName);
  if (bytes.byteLength === 0) throw new MediaError(400, 'EMPTY_MEDIA', 'file is empty');
  if (bytes.byteLength > MEDIA_MAX_BYTES) {
    throw new MediaError(413, 'MEDIA_TOO_LARGE', `max ${MEDIA_MAX_BYTES} bytes`);
  }
  const root = mediaRoot();
  fs.mkdirSync(root, { recursive: true });
  const target = path.join(root, name);
  if (fs.existsSync(target)) {
    throw new MediaError(409, 'MEDIA_NAME_TAKEN', `media already exists: ${name}`);
  }
  fs.writeFileSync(target, bytes);
  return {
    name,
    size: bytes.byteLength,
    url: `/media/${encodeURIComponent(name)}`,
    uploadedAt: new Date().toISOString(),
  };
}

export function readMedia(segments: string[]): { body: Buffer; contentType: string } | null {
  if (segments.length !== 1) return null; // 扁平命名空间,只允许单段
  let name: string;
  try {
    name = sanitizeMediaName(decodeURIComponent(segments[0] ?? ''));
  } catch {
    return null;
  }
  const target = path.join(mediaRoot(), name);
  if (!fs.existsSync(target)) return null;
  return {
    body: fs.readFileSync(target),
    contentType: MEDIA_CONTENT_TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream',
  };
}

export function deleteMedia(rawName: string): boolean {
  const name = sanitizeMediaName(rawName);
  const target = path.join(mediaRoot(), name);
  if (!fs.existsSync(target)) return false;
  fs.unlinkSync(target);
  return true;
}
