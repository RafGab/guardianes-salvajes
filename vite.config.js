import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Dos páginas: el juego (index.html) y la zona de prueba de escala (escala.html).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        escala: fileURLToPath(new URL('./escala.html', import.meta.url)),
      },
    },
  },
});
