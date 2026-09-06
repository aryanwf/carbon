<p align="center">
  <img src="public/web-app-manifest-512x512.png" alt="Carbon logo" width="96" height="96" />
</p>

<h1 align="center">Carbon</h1>

<p align="center">
  Open-source research paper management.
  Import papers, understand them faster, map how they connect, and chat with your library.
</p>

<p align="center">
  <a href="#showcase">Showcase</a> |
  <a href="#features">Features</a> |
  <a href="#quick-start">Quick Start</a> |
  <a href="#configuration">Configuration</a> |
  <a href="#database">Database</a> |
  <a href="#project-structure">Project Structure</a>
</p>

## Overview

Carbon turns arXiv links, PDFs, and research pages into a personal research workspace. It extracts metadata, stores papers in a shared Supabase-backed library, generates AI summaries, builds a similarity graph, and lets you ask grounded questions about each paper.

The app is built with Next.js 16, React 19, Supabase Auth/Postgres/Storage, OpenRouter-hosted LLM calls, Sigma.js graph rendering, and an embedded PDF reader.

## Showcase

<p align="center">
  <img src="public/showcase.png" alt="Carbon research workspace showing the paper library, PDF reader, and paper overview" width="1200" />
</p>

## Features

- Import arXiv URLs, direct PDF links, or generic paper pages with streaming progress.
- Store a personal paper library with per-user read state, notes, sorting, and filtering.
- Generate structured AI summaries.
- Build paper-to-paper similarity edges with embeddings and `pgvector`.
- Explore an interactive WebGL knowledge graph powered by Sigma.js and Graphology.
- Read PDFs in-app through a proxy route that avoids common external CORS issues.
- Chat with individual papers using extracted paper text, summary, and library context.
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

## Usage

1. Sign in with Google.
2. Paste one or more arXiv, PDF, or paper page URLs into the import flow.
3. Select a paper to read metadata, notes, PDF content, and community state.
4. Run enrichment to stream summaries and graph connections.
5. Switch to the graph view to explore related papers.
6. Open the chat tab to ask paper-specific questions grounded in extracted text.

## License

MIT
