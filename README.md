This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## MyBed Visual Studio (`studio/`)

Osobna aplikacja Next.js w katalogu `studio/` — wewnętrzne narzędzie do
generowania i edycji wizualizacji produktowych (packshot → fotorealistyczna
aranżacja wnętrza). Deployowana jako ODDZIELNY projekt Vercel
(Root Directory: `studio`), żeby nie mieszać się z dashboardem.
Szczegóły i instrukcja deployu: `studio/README.md`.
Schemat DB (wspólny projekt Supabase): `supabase/migrations/009_mybed_visual_studio.sql`.

## Auto commit + push (GitHub/Vercel flow)

If your Vercel project redeploys on every push to GitHub, you can use:

```bash
AUTOPUSH_REMOTE_URL="git@github.com:<org>/<repo>.git" \
scripts/auto-commit-push.sh "chore: update dashboard"
```

What it does:

1. Adds `origin` remote if missing (from `AUTOPUSH_REMOTE_URL`).
2. Stages all changes.
3. Creates one commit with your message.
4. Pushes current branch to GitHub (`git push -u origin HEAD:<branch>`).

Optional env vars:

- `AUTOPUSH_REMOTE_NAME` (default: `origin`)
- `AUTOPUSH_BRANCH` (default: current branch)
- `AUTOPUSH_REMOTE_URL` (required only for first-time remote setup)
