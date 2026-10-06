import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve('src/core'),
      '@game': resolve('src/game'),
      '@server': resolve('src/server')
    }
  },
  test: {
    environment: 'node',
    include: ['src/{core,game,server}/**/*.test.ts']
  }
})
