# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Purpose

This is a frontend learning/teaching repository containing hand-written implementations of core web technologies. Code is educational — written to explain internals, not for production use. Comments are primarily in Chinese.

## Project Structure

- **css/** — CSS techniques split into `classicProblems/` (clearfix, text overflow, aspect ratio, triangles, centering) and `layout/` (two/three-column layouts). All standalone HTML files — open directly in a browser.
- **JavaScript/basics/** — ~58 hand-written JS implementations: utility functions (debounce, throttle, curry, compose), array methods (map, filter, reduce, flat), Promise + async patterns, sorting algorithms (quick, merge, heap, shell, bubble, insertion, selection), design patterns (Observer, EventBus, LRU), inheritance, deep copy, binary search, etc.
- **React/** — Three progressive mini-React implementations (`miniReact.js` → `miniReact2.js` → `miniReact3.js`) with Fiber architecture, hooks (useState, useEffect), virtual DOM reconciliation, and key-based diffing.
- **Redux/** — Minimal Redux `compose` implementation.
- **WebPack/** — Full reimplementations of webpack tooling (see below).
- **AI/** — AI-related implementations: `mini-openclaw/` (AI Agent platform), `mcp/confluence-mcp/` (MCP server for Confluence).
- **Shell/** — Shell scripting cheatsheet and test files.
- **TypeScript/** — (Empty, placeholder for future content.)

## WebPack Sub-projects

Each sub-project is self-contained with its own `package.json`. Install dependencies with `npm install` inside each directory.

### mini-webpack (`WebPack/mini-webpack/`)
Complete webpack bundler: compiler lifecycle, plugin system (tapable), loader chains, AST-based dependency resolution (Babel), watch mode, hash output.
```bash
cd WebPack/mini-webpack && npm install
npm run build        # Build with debugger.js (runs the bundler)
npm run run-bundle   # Run the output bundle (dist/main.js)
```

### mini-devserver (`WebPack/mini-devserver/`)
Full HMR dev server: HTTP server, WebSocket, file watcher, incremental compilation, hot-update protocol, in-memory file system.
```bash
cd WebPack/mini-devserver && npm install
npm start            # Start dev server with HMR (runs dev-server.js)
```

### Standalone demos (`WebPack/`)

Module system internals:
- `module-loader-demo.js` — CommonJS module loader internals
- `esm-loader-demo.js` — ES Module loader internals (live binding, `__esModule` flag)
- `async-loader-demo.js` — Webpack 5 dynamic `import()` runtime (JSONP chunk loading)

Webpack 5 advanced features:
- `tapable-demo.js` — All 7 Hook types (SyncHook, SyncBailHook, SyncWaterfallHook, SyncLoopHook, AsyncSeriesHook, AsyncSeriesBailHook, AsyncParallelHook) with simulated Compiler
- `loader-pipeline-demo.js` — Loader full lifecycle: pitch phase (left→right), normal phase (right→left), pitch bailout, `this.async()`, `this.data` sharing
- `tree-shaking-demo.js` — ES Module static analysis, providedExports/usedExports, unused export removal (requires mini-webpack deps)
- `code-splitting-demo.js` — Compilation-time chunk splitting for `import()`, JSONP runtime generation (requires mini-webpack deps)
- `source-map-demo.js` — VLQ Base64 encoding, Source Map v3 generation (requires mini-webpack deps)
- `persistent-cache-demo.js` — Filesystem cache with ETag-based invalidation (requires mini-webpack deps)
- `module-federation-demo.js` — Container protocol (`init`/`get`), Host/Remote architecture, shared dependency version negotiation

Run directly with `node`. Files marked "requires mini-webpack deps" need `cd mini-webpack && npm install` first.

## AI Sub-projects

### mini-openclaw (`AI/mini-openclaw/`)
AI Agent platform implementing the OpenClaw architecture in TypeScript: Gateway (WebSocket message routing), Agent runtime (4-step processing loop), session management, memory system, prompt builder, tool system, plugin loader, and channel adapters (CLI + Web UI).
```bash
cd AI/mini-openclaw && npm install
npm start            # Start with mock LLM (no API key needed)
npm run start:real   # Start with real OpenAI API (set OPENAI_API_KEY)
npm run typecheck    # TypeScript type checking
```

### confluence-mcp (`AI/mcp/confluence-mcp/`)
MCP (Model Context Protocol) server for accessing Confluence. TypeScript, built with `@modelcontextprotocol/sdk`.
```bash
cd AI/mcp/confluence-mcp && npm install
npm run build        # Compile TypeScript (tsc --build)
npm start            # Run the compiled server (dist/index.js)
```

## Conventions

- No global build system, linter, or test framework — each sub-project is independent
- Inline Chinese comments explain implementation details and design rationale
- Multiple versions of the same concept (e.g., miniReact 1-3) show incremental improvements
- HTML files in css/ are self-contained and can be opened directly in a browser
- Commit messages typically follow `TYPE(branch): description` format in Chinese (e.g., `MOD(master): 优化部分代码`)
