import { HelpCircle } from "lucide-react"
import { type ReactNode, useState } from "react"
import { cn } from "../utils/cn"
import { Modal } from "./Modal"

type Size = "sm" | "md"

interface HelpButtonProps {
  title: string
  content: ReactNode
  size?: Size
}

const buttonSizes: Record<Size, string> = {
  sm: "h-7 w-7",
  md: "h-9 w-9",
}

const iconSizes: Record<Size, string> = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
}

export function HelpButton({ title, content, size = "md" }: HelpButtonProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        aria-label="Ayuda"
        onClick={() => setIsOpen(true)}
        className={cn(
          "inline-flex items-center justify-center rounded-full",
          "text-slate-500 hover:text-slate-900 hover:bg-slate-100",
          "dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800",
          "transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400",
          "dark:focus-visible:ring-zinc-500",
          buttonSizes[size],
        )}
      >
        <HelpCircle className={iconSizes[size]} />
      </button>
      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={title}
        size="xl"
        variant="dark"
      >
        {content}
      </Modal>
    </>
  )
}
