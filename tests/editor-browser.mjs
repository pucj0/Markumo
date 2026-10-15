// Production Markdown Live contract moved to ProseMirror. The replacement
// suite retains no-op source bytes, task transaction/undo, shared history,
// Source clipboard bytes, plain/HTML paste safety, composition guards and
// readonly rejection, and adds editable tables, code NodeViews and extensions.
// The old decoration-specific DOM oracle is retained under tests/legacy.
await import('./markdown-wysiwyg-ui.mjs')
