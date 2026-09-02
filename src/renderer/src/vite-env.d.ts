/// <reference types="vite/client" />

// Brings in Vite's ambient declarations for the renderer: `*.css` and the other
// asset types imported for their side effects, plus `import.meta.env`.
// TypeScript 7 no longer lets a side-effect import go unresolved, so the CSS
// imports in main.tsx / mini.tsx need these to be declared.
