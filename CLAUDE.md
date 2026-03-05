# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Purpose

This is a frontend learning/teaching repository containing hand-written implementations of core web technologies. Code is educational — written to explain internals, not for production use. Comments are primarily in Chinese.

## Project Structure

- **CSS/** — CSS layout techniques (Holy Grail, Double Wing, centering, clearfix, etc.) as standalone HTML files
- **JavaScript/js基础/** — ~58 hand-written implementations of JS fundamentals: utility functions (debounce, throttle, curry), array methods, Promise, sorting algorithms, design patterns (Observer, EventBus, LRU), etc.
- **JavaScript/demo/** — Interactive demos (drag-and-drop, lazy loading, debounce/throttle)
- **JavaScript/常见的跨域方法/** — Cross-domain techniques (CORS, JSONP, postMessage, WebSocket)
- **React/** — Three progressive mini-React implementations with Fiber architecture, hooks (useState, useEffect), virtual DOM reconciliation, and key-based diffing
- **Redux/** — Minimal Redux compose implementation
- **WebPack/** — The most complex part: full reimplementations of webpack tooling

## WebPack Sub-projects

Each sub-project is self-contained with its own `package.json`. Install dependencies with `npm install` inside each directory.

### mini-webpack (`WebPack/mini-webpack/`)
Complete webpack bundler: compiler lifecycle, plugin system (tapable), loader chains, AST-based dependency resolution (Babel), watch mode, hash output.
```bash
cd WebPack/mini-webpack && npm install
npm run build        # Build with webpack.js
npm run run-bundle   # Run the output bundle
```

### mini-devserver (`WebPack/mini-devserver/`)
Full HMR dev server: HTTP server, WebSocket, file watcher, incremental compilation, hot-update protocol, in-memory file system.
```bash
cd WebPack/mini-devserver && npm install
npm start            # Start dev server with HMR
```

### Loader demos (`WebPack/`)
- `async-loader-demo.js` — Webpack 5 dynamic import() pipeline (heavily commented)
- `esm-loader-demo.js` — ES Module loader internals
- `module-loader-demo.js` — CommonJS module loader internals

These are standalone annotated files; run directly with `node`.

## Conventions

- No global build system, linter, or test framework — each sub-project is independent
- Inline Chinese comments explain implementation details and design rationale
- Multiple versions of the same concept (e.g., miniReact 1-3) show incremental improvements
- HTML files in CSS/ and JavaScript/demo/ are self-contained and can be opened directly in a browser
