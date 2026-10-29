import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@core': resolve('src/core'),
        '@game': resolve('src/game'),
        '@server': resolve('src/server')
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@core': resolve('src/core'),
        '@game': resolve('src/game'),
        '@server': resolve('src/server')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@core': resolve('src/core')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
