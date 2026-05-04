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
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-4 pb-4 mb-2 border-b border-slate-200/60 dark:border-zinc-800/60">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-zinc-100">
            {title}
          </h1>
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
