import { useEffect, useState } from 'react'
import { Eye, List, Table2, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DbObject, DbObjectType, SqliteExplorerAdapter } from './types'

const OBJECT_TYPE_CONFIG: Record<DbObjectType, { label: string; icon: typeof Table2 }> = {
  table: { label: 'Tables', icon: Table2 },
  view: { label: 'Views', icon: Eye },
  index: { label: 'Indexes', icon: List },
  trigger: { label: 'Triggers', icon: Zap },
}

const GROUP_ORDER: DbObjectType[] = ['table', 'view', 'index', 'trigger']

type ObjectListProps = {
  adapter: SqliteExplorerAdapter
  objects: DbObject[]
  selectedObject: string | null
  onSelect: (name: string) => void
}

export const ObjectList = ({ adapter, objects, selectedObject, onSelect }: ObjectListProps) => {
  const [rowCounts, setRowCounts] = useState<Map<string, number>>(new Map())

  useEffect(() => {
    const loadCounts = async () => {
      const counts = new Map<string, number>()
      const countable = objects.filter((o) => o.type === 'table' || o.type === 'view')
      for (const obj of countable) {
        try {
          counts.set(obj.name, await adapter.getRowCount(obj.name))
        } catch {
          counts.set(obj.name, -1)
        }
      }
      setRowCounts(counts)
    }
    if (objects.length > 0) loadCounts()
  }, [adapter, objects])

  const grouped = GROUP_ORDER.map((type) => ({
    type,
    ...OBJECT_TYPE_CONFIG[type],
    items: objects.filter((o) => o.type === type),
  })).filter((g) => g.items.length > 0)

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {grouped.map((group) => (
        <div key={group.type} className="flex flex-col">
          <div className="text-muted-foreground px-3 py-2 text-xs font-semibold uppercase tracking-wider">
            {group.label}
          </div>
          {group.items.map((obj) => {
            const count = rowCounts.get(obj.name)
            const isSelected = obj.name === selectedObject
            const Icon = group.icon

            return (
              <button
                key={obj.name}
                type="button"
                onClick={() => onSelect(obj.name)}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
                  'hover:bg-muted/50',
                  isSelected && 'bg-muted font-medium',
                )}
              >
                <Icon className="text-muted-foreground size-3.5 shrink-0" />
                <span className="min-w-0 truncate">{obj.name}</span>
                {count != null && count >= 0 && (
                  <span className="text-muted-foreground ml-auto shrink-0 text-xs">{count}</span>
                )}
              </button>
            )
          })}
        </div>
      ))}
      {objects.length === 0 && <div className="text-muted-foreground p-4 text-sm">No database objects found</div>}
    </div>
  )
}
