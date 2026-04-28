import type { ReactNode } from "react"
import { HelpButton } from "./HelpButton"

interface PageContainerProps {
  title: string
  description?: string
  helpContent: ReactNode
  children: ReactNode
}

export function PageContainer({ title, description, helpContent, children }: PageContainerProps) {
  return (
    <div>
      <header className="flex items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-zinc-100">{title}</h1>
          {description ? (
            <p
              data-testid="page-description"
              className="mt-1 text-sm text-slate-600 dark:text-zinc-400"
            >
              {description}
            </p>
          ) : null}
        </div>
        <HelpButton title={title} content={helpContent} />
      </header>
      {children}
    </div>
  )
}
