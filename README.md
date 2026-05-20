<p align="center">
  <img src="src/app/icon1.png" alt="Carbon logo" width="96" height="96" />
</p>

<h1 align="center">Carbon</h1>

<p align="center">
  Open-source AI-powered research paper management.
  Import papers, understand them faster, map how they connect, and chat with your library.
</p>

<p align="center">
  <a href="#features">Features</a> |
  <a href="#quick-start">Quick Start</a> |
  <a href="#configuration">Configuration</a> |
  <a href="#database">Database</a> |
  <a href="#project-structure">Project Structure</a>
</p>

## Overview

Carbon turns arXiv links, PDFs, and research pages into a personal research workspace. It extracts metadata, stores papers in a shared Supabase-backed library, generates AI summaries and credibility scores, builds a similarity graph, and lets you ask grounded questions about each paper.

The app is built with Next.js 16, React 19, Supabase Auth/Postgres/Storage, OpenRouter-hosted LLM calls, Sigma.js graph rendering, and an embedded PDF reader.

## Features

- Import arXiv URLs, direct PDF links, or generic paper pages with streaming progress.
- Store a personal paper library with per-user read state, notes, sorting, and filtering.
- Generate structured AI summaries, BS Score credibility ratings, and interestingness scores.
- Build paper-to-paper similarity edges with embeddings and `pgvector`.
- Explore an interactive WebGL knowledge graph powered by Sigma.js and Graphology.
- Read PDFs in-app through a proxy route that avoids common external CORS issues.
- Chat with individual papers using extracted paper text, summary, credibility score, and library context.
- Use Google OAuth via Supabase, public profiles, follows, stars, claims, and a community activity feed.

## Tech Stack

| Area | Technology |
| --- | --- |
| App | Next.js 16 App Router, React 19, TypeScript |
| Styling | Tailwind CSS 4, custom global CSS, Next fonts |
| Auth and data | Supabase Auth, Postgres, Storage, SSR helpers |
| AI | OpenRouter chat completions and embeddings |
| Papers | Cheerio, pdf-parse, arXiv scraping, PDF upload/storage |
| Graph | Sigma.js, Graphology, ForceAtlas2, no-overlap layout |
| Reading | `@embedpdf/react-pdf-viewer`, KaTeX, Markdown rendering |

## Quick Start

### Prerequisites

- Bun, Node.js, or another package manager compatible with Next.js.
- A Supabase project with Google OAuth enabled.
- A Supabase Storage bucket named `papers`.
- An OpenRouter API key.

### Install

```bash
bun install
```

### Configure Environment

Create a local environment file from the example:

```bash
cp .env.example .env.local
```

Fill in the required values:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OPENROUTER_API_KEY=your-openrouter-api-key
```

### Run Locally

```bash
bun dev
```

Open the app at:

```txt
http://localhost:3000
```

## Build

```bash
bun run build
```

Start the production server:

```bash
bun start
```

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL used by browser and server clients. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase publishable key for auth/session-aware client access. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only key used for privileged database and storage operations. |
| `OPENROUTER_API_KEY` | Yes | API key used for summaries, BS Scores, chat, metadata guessing, and embeddings. |

Keep `SUPABASE_SERVICE_ROLE_KEY` and `OPENROUTER_API_KEY` server-side only. Do not expose them to client components or commit `.env.local`.

## Database

Carbon expects Supabase Postgres tables, policies, storage, and vector search support.

Run these SQL migrations in Supabase, in order:

```txt
src/lib/migrations/shared-papers.sql
src/lib/migrations/community.sql
src/lib/migrations/chat-messages-user-id.sql
```

The migrations create or update:

| Table | Purpose |
| --- | --- |
| `papers` | Global paper registry with metadata, summaries, embeddings, and scores. |
| `user_papers` | Per-user library state such as notes, read status, and added date. |
| `paper_connections` | Similarity edges used by the graph view. |
| `chat_messages` | Per-user, per-paper chat history. |
| `profiles` | Public profile data and verification state. |
| `follows` | User follow graph. |
| `paper_stars` | Social endorsements for papers. |
| `paper_claims` | Verified-user authorship claims. |
| `banned_users` | Server-side access control by user, email, or username pattern. |

The shared paper migration also enables `pgcrypto` and `vector`, adds a `VECTOR(1536)` embedding column, and creates the `match_papers` RPC used for similarity search.

## Supabase Setup Notes

- Enable Google as an OAuth provider in Supabase Auth.
- Add the local callback URL, usually `http://localhost:3000/auth/callback`.
- Create a Storage bucket named `papers` for imported PDFs.
- Run the migrations before signing in or importing papers.
- Keep Row Level Security enabled; the included policies cover public community reads and user-owned writes.

## Usage

1. Sign in with Google.
2. Paste one or more arXiv, PDF, or paper page URLs into the import flow.
3. Select a paper to read metadata, notes, PDF content, and community state.
4. Run enrichment to stream a summary, credibility score, embedding, and graph connections.
5. Switch to the graph view to explore related papers.
6. Open the chat tab to ask paper-specific questions grounded in extracted text.

## Project Structure

```txt
src/
|-- app/                    # App Router pages, layouts, icons, API routes
|   |-- api/                # Paper, chat, enrichment, community, and profile APIs
|   |-- auth/callback/      # Supabase OAuth callback route
|   `-- u/[username]/       # Public profile pages
|-- components/             # Workspace, reader, graph, paper list, chat, community UI
`-- lib/                    # Supabase, ingestion, enrichment, chat, community, migrations
```

## Scripts

| Command | Description |
| --- | --- |
| `bun dev` | Start the Next.js development server. |
| `bun run build` | Create a production build. |
| `bun start` | Start the production server. |

## Key Routes

| Route | Purpose |
| --- | --- |
| `/` | Authenticated research workspace. |
| `/auth/callback` | Supabase OAuth callback. |
| `/u/[username]` | Public profile and activity page. |
| `/api/papers` | List or import papers. Supports SSE import progress. |
| `/api/papers/[id]` | Update or delete a paper from a user's library. |
| `/api/papers/[id]/enrich` | Stream summary, BS Score, embedding, and graph connection generation. |
| `/api/papers/[id]/chat` | Read and stream per-paper chat messages. |
| `/api/papers/[id]/pdf` | Proxy PDF content for the embedded reader. |

## Security Model

- API routes require a Bearer token validated through Supabase Auth.
- Server-side data access uses the Supabase service role key and explicit ownership checks.
- Banned users are blocked by user ID, email, or username wildcard pattern.
- Personal library state is scoped through `user_papers` while shared paper metadata is deduplicated globally.
- Verified users can claim papers through the `paper_claims` policy.

## Notes for Contributors

- Keep heavy work in API routes, not client components.
- Preserve the split between global paper metadata and per-user library state.
- Use streaming responses for long AI or import operations so the UI stays responsive.
- Update the SQL migrations when changing persisted schema.
- Do not add secrets to `.env.example`; use placeholders only.

## License

No license file is currently included. Add one before distributing Carbon publicly.
