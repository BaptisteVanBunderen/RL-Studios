import type { RlStudioApi } from '@core/index'

declare global {
  interface Window {
    /** API exposée par le preload (`src/preload/index.ts`). */
    rlstudio: RlStudioApi
  }
}
