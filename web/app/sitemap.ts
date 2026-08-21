import type { MetadataRoute } from 'next';
import { listBooks, listPublishedChapters } from '@novel/core';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NOVEL_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const urls: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/books`, changeFrequency: 'daily', priority: 0.9 },
  ];

  for (const b of listBooks()) {
    urls.push({
      url: `${base}/books/${b.slug}`,
      lastModified: b.updatedAt,
      changeFrequency: 'weekly',
      priority: 0.8,
    });
    for (const ch of listPublishedChapters(b.id)) {
      urls.push({
        url: `${base}/books/${b.slug}/chapter/${ch.number}`,
        lastModified: ch.publishedAt ?? undefined,
        changeFrequency: 'monthly',
        priority: 0.6,
      });
    }
  }
  return urls;
}
