// Same assertions and fixture as Smoke, plus node-view and lazy-load lifecycle cases.
process.argv.push('--full')
await import('./markdown-live-controller-regression.mjs')
