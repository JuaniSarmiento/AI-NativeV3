/**
 * Helper compartido para mockear fetch por path-prefix.
 *
 * Las vistas montan otros componentes (ComisionSelector, AcademicContextSelector)
 * que disparan sus propios fetches al mount. Si solo mockeamos los fetches
 * "interesantes" del test, los otros caen en undefined y rompen el render.
 *
 * Uso:
 *   setupFetchMock({
 *     "/api/v1/analytics/episode/": () => mockNLevelResponse,
 *     "/api/v1/comisiones": () => ({ data: [], meta: { cursor_next: null } }),
 *   })
 */
import { vi } from "vitest"

type Handler = () => unknown

export function setupFetchMock(handlers: Record<string, Handler | { ok: boolean; status: number; body: () => unknown }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString()
      for (const [pathPrefix, handler] of Object.entries(handlers)) {
        if (urlStr.includes(pathPrefix)) {
          if (typeof handler === "function") {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve(handler()),
              text: () => Promise.resolve(JSON.stringify(handler())),
            } as Response)
          }
          return Promise.resolve({
            ok: handler.ok,
            status: handler.status,
            json: () => Promise.resolve(handler.body()),
            text: () => Promise.resolve(JSON.stringify(handler.body())),
          } as Response)
        }
      }
      // Default benigno: lista vacía con shape de pageable
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [], meta: { cursor_next: null } }),
        text: () => Promise.resolve('{"data":[],"meta":{"cursor_next":null}}'),
      } as Response)
    }),
  )
}
