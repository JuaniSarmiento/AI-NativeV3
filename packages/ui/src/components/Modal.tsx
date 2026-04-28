import { X } from "lucide-react"
import { type ReactNode, useEffect, useId } from "react"
import { createPortal } from "react-dom"
import { cn } from "../utils/cn"

type Size = "sm" | "md" | "lg" | "xl"
type Variant = "light" | "dark"

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  size?: Size
  variant?: Variant
  children: ReactNode
}

const sizeClasses: Record<Size, string> = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-3xl",
}

const panelClasses: Record<Variant, string> = {
  light: "bg-white border border-slate-200 dark:bg-slate-900 dark:border-slate-700",
  dark: "bg-zinc-900 border border-zinc-700",
}

const headerBorderClasses: Record<Variant, string> = {
  light: "border-slate-200 dark:border-slate-700",
  dark: "border-zinc-700",
}

const titleClasses: Record<Variant, string> = {
  light: "text-slate-900 dark:text-zinc-100",
  dark: "text-zinc-100",
}

const closeBtnClasses: Record<Variant, string> = {
  light:
    "text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 focus-visible:ring-slate-400 dark:focus-visible:ring-zinc-500",
  dark: "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 focus-visible:ring-zinc-500",
}

export function Modal({
  isOpen,
  onClose,
  title,
  size = "md",
  variant = "light",
  children,
}: ModalProps) {
  const titleId = useId()

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose()
  }

  return createPortal(
    // biome-ignore lint/a11y/useKeyWithClickEvents: el cierre por teclado esta cubierto por el listener global de Escape en useEffect; el backdrop solo responde a click para cerrar.
    <div
      data-testid="modal-backdrop"
      onClick={handleBackdropClick}
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center",
        "bg-black/60 backdrop-blur-sm",
        "p-4 sm:p-6",
      )}
    >
      <div
        // biome-ignore lint/a11y/useSemanticElements: el <dialog> nativo tiene API showModal/close imperativa y stacking quirks que no encajan con el portal controlado de React; usamos role="dialog" explicito.
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-variant={variant}
        className={cn(
          "w-full mx-4 overflow-hidden rounded-xl shadow-2xl",
          "flex flex-col max-h-[85vh]",
          "transition duration-150 ease-out",
          panelClasses[variant],
          sizeClasses[size],
        )}
      >
        <div
          className={cn(
            "flex items-center justify-between px-6 py-4 border-b",
            headerBorderClasses[variant],
          )}
        >
          <h2 id={titleId} className={cn("text-lg font-semibold", titleClasses[variant])}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className={cn(
              "inline-flex items-center justify-center rounded-md p-1",
              "focus-visible:outline-none focus-visible:ring-2",
              closeBtnClasses[variant],
            )}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-6 py-6 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
