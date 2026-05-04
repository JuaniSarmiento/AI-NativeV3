import { expect, test } from "@playwright/test"
import {
  COMISION_A_ID,
  DOCENTE_USER_ID,
  STUDENT_A1_ID,
  TENANT_ID,
  WEB_ADMIN_URL,
} from "../fixtures/seeded-ids"

/**
 * Journey 1 — web-admin / Auditoria CTR.
 *
 * Flujo:
 *  1. Resolver un episode_id cerrado del seed (consultar via api-gateway un
 *     listado de episodios del student A1; tomar el primero closed).
 *  2. Navegar a /auditoria, pegar el id, click "Verificar integridad".
 *  3. Assertear que aparece `data-testid=audit-result` con `data-valid=true`.
 */

test.describe("web-admin / Auditoria CTR", () => {
  test("verifica un episodio cerrado del seed y muestra valid=true", async ({ page, request }) => {
    // 1. Buscar un episodio del student A1 via api-gateway -> analytics-service.
    //    El endpoint devuelve solo episodios cerrados+clasificados (lo que
    //    necesita la auditoria CTR).
    const listRes = await request.get(
      `http://127.0.0.1:8000/api/v1/analytics/student/${STUDENT_A1_ID}/episodes?comision_id=${COMISION_A_ID}`,
      {
        headers: {
          "X-Tenant-Id": TENANT_ID,
          "X-User-Id": DOCENTE_USER_ID,
          "X-User-Email": "docente@demo-uni.edu",
          "X-User-Roles": "docente_admin",
        },
      },
    )
    expect(listRes.ok(), "no se pudo listar episodios del student A1").toBeTruthy()
    const list = (await listRes.json()) as {
      n_episodes: number
      episodes: Array<{ episode_id: string; closed_at: string | null }>
    }
    const closed = list.episodes.find((e) => e.closed_at !== null)
    expect(closed, "no hay episodios closed del student A1; revisa el seed").toBeTruthy()
    if (!closed) throw new Error("unreachable")
    const episodeId = closed.episode_id

    // 2. Navegar al web-admin y entrar a Auditoria via sidebar.
    //    web-admin usa router interno por state (no URL-based) — clickear el item.
    await page.goto(`${WEB_ADMIN_URL}/`)
    await page.getByRole("button", { name: /Integridad CTR/i }).click()

    const input = page.getByLabel(/Episode ID/i)
    await input.fill(episodeId)

    await page.getByRole("button", { name: /Verificar integridad/i }).click()

    // 3. El resultado debe aparecer con valid=true.
    const result = page.getByTestId("audit-result")
    await expect(result).toBeVisible({ timeout: 10_000 })
    await expect(result).toHaveAttribute("data-valid", "true")
    await expect(result).toContainText(/Cadena integra|Cadena íntegra/i)
  })
})
