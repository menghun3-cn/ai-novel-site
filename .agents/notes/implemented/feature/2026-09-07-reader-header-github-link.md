# Agent Note: Reader header GitHub source link

Status: implemented

English | [中文](2026-09-07-reader-header-github-link.zh.md)

## Problem

The reader site (`web/app/(site)`) had no link to the project's source code.
The repository URL lived only in documentation (README.md), so a user browsing
the deployed reader had no way to reach the open-source repository, and the
header's right cluster (ReaderMenu + ThemeToggle) had no external-link
affordance.

## Decision

Add a GitHub icon button **to the right of the theme toggle** in the reader
header (`web/components/Header.tsx`): a plain `<a>` pointing to
`https://github.com/menghun3-cn/ai-novel-site` with `target="_blank"` and
`rel="noopener noreferrer"`. It matches `ThemeToggle`'s style — 9×9
rounded-full bordered circle, `currentColor` fill — renders the standard
GitHub octocat mark at 18px, and carries `aria-label` / `title`
「源码仓库(GitHub)」. Because it is server-rendered markup with no client
state, it appears identically on every reader page.

## Alternatives considered

**Add the link to the footer only.** Rejected: the request is for a top-right
affordance next to the theme toggle; the footer is out of view while the user
browses books.

**Put the link in the admin console.** Rejected: the admin shell is
operator-facing; the request targets the reader-facing site (用户阅读端).

**Use a text link instead of an icon.** Rejected: the header cluster is
icon-sized (ReaderMenu / ThemeToggle are 9×9 circles); an icon keeps the row
uniform, and the octocat mark is universally recognized.

## Consequences

- Reader visitors reach the source repository in one click; the link opens in
  a new tab (`target="_blank"` + `rel="noopener noreferrer"`), never
  navigating the reader away.
- The header's right cluster is now ReaderMenu → ThemeToggle → GitHub, so the
  toggle's position relative to the menu is unchanged.
- The repository URL is hardcoded in `Header.tsx`; if the repo is renamed or
  mirrored, the `href` must be updated there (README.md already references the
  same URL in prose).
