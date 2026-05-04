import { cleanup, render, screen } from "@testing-library/react"
import { Home } from "lucide-react"
import { afterEach, describe, expect, it } from "vitest"
import { Sidebar, type NavGroup } from "./Sidebar"

afterEach(() => {
  cleanup()
  try {
    localStorage.clear()
  } catch {
    // jsdom puede tener localStorage bloqueado en algún test edge — ignorar.
  }
})

const sampleGroups: NavGroup[] = [
  {
    label: "TEST",
    items: [{ id: "/home", label: "Home", icon: Home }],
  },
]

const baseProps = {
  navGroups: sampleGroups,
  headerLabel: "Test App",
  collapsedHeaderLabel: "T",
  activeItemId: "/home",
  onNavigate: () => {
    /* no-op */
  },
}

describe("Sidebar topSlot separator", () => {
  it("expanded + topSlot → wrapper tiene las 4 clases de separación", () => {
    render(
      <Sidebar
        {...baseProps}
        storageKey="test-sidebar-with-top-1"
        topSlot={<div data-testid="top">contenido top</div>}
      />,
    )
    const top = screen.getByTestId("top")
    const wrapper = top.parentElement
    expect(wrapper).not.toBeNull()
    if (!wrapper) return
    expect(wrapper.className).toContain("pb-3")
    expect(wrapper.className).toContain("border-b")
    expect(wrapper.className).toContain("border-slate-800/50")
    expect(wrapper.className).toContain("mb-3")
  })

  it("collapsed + topSlot → topSlot NO se renderiza (no hay wrapper)", () => {
    // Pre-sembrar localStorage para arrancar en collapsed.
    const storageKey = "test-sidebar-collapsed-2"
    localStorage.setItem(storageKey, "1")
    render(
      <Sidebar
        {...baseProps}
        storageKey={storageKey}
        topSlot={<div data-testid="top-collapsed">contenido top</div>}
      />,
    )
    expect(screen.queryByTestId("top-collapsed")).toBeNull()
  })

  it("expanded sin topSlot → no hay wrapper con border-slate-800/50", () => {
    render(<Sidebar {...baseProps} storageKey="test-sidebar-no-top-3" />)
    const aside = screen.getByRole("complementary")
    const candidates = aside.querySelectorAll('[class*="border-slate-800"]')
    expect(candidates.length).toBe(0)
  })
})
