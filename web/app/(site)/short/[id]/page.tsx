import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getShortStory, getBookById, latestPublicationByStory, getStoryVersion, listShortStories, CoreError } from '@novel/core';
import { mdToHtml } from '@/lib/markdown';
import ShortStoryReader from '@/components/ShortStoryReader';
import TtsPlayer from '@/components/TtsPlayer';

export const revalidate = 60;

/** 按需 ISR 种子:只预生成已发布短篇的 id 列表(有界上限 1000),其余首次访问生成并缓存。 */
export async function generateStaticParams() {
  try {
    return listShortStories({ limit: 1000 })
      .filter((s) => s.publicationId)
      .map((s) => ({ id: s.id }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const story = getShortStory(id);
    return { title: `${story.title} · 短篇`, description: story.title };
  } catch {
    return { title: '短篇不存在' };
  }
}

export default async function ShortStoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let story;
  try {
    story = getShortStory(id);
  } catch (err) {
    if (err instanceof CoreError) notFound();
    throw err;
  }
  const pub = latestPublicationByStory(id);
  if (!pub) notFound();
  const book = getBookById(pub.bookId);
  if (!book || book.status === 'hidden') notFound();
  const version = getStoryVersion(pub.versionId);
  const html = await mdToHtml(version.content);
  return (
    <>
      <TtsPlayer contentSelector="#short-story-content" />
      <ShortStoryReader book={book} story={story} publication={pub} html={html} />
    </>
  );
}
