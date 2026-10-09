import { defineConfig } from 'vite';

export default defineConfig({
  // itch.io sert le jeu depuis un sous-dossier : les chemins doivent être relatifs.
  base: './',
  build: {
    target: 'es2022',
    // Rapier embarque son WASM dans le bundle (~1,8 Mo gzip), c'est attendu.
    chunkSizeWarningLimit: 6000,
  },
});
