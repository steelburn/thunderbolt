import { Slot } from '@radix-ui/react-slot'
import { Ellipsis, Trash2 } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface ChatNavButtonProps extends React.HTMLAttributes<HTMLDivElement> {
  chatTitle: string
  asChild?: boolean
}

export function ChatNavButton({ chatTitle, className, asChild = false, ...props }: ChatNavButtonProps) {
  const Comp = asChild ? Slot : 'div'

  return (
    <Comp className={cn('relative w-full', className)} {...props}>
      <Popover>
        <PopoverTrigger asChild>
          <div className="group w-full h-full flex space-x-2 items-center">
            <div className="group h-9 relative">
              <div className="w-1 h-[100%] bg-gray-200 group-hover:opacity-100 opacity-0 rounded-r-sm" />
            </div>
            <Button variant="ghost" className="flex items-center gap-2 h-10 px-3 group w-full">
              <div className="flex items-center gap-2">
                <div className="hidden md:block text-left">
                  <p className="text-sm font-base">{chatTitle}</p>
                </div>
              </div>
              <Ellipsis className="size-4 text-muted-foreground transition-transform group-hover:opacity-100 opacity-0 ml-auto" />
            </Button>
          </div>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0">
          <div className="py-1 px-2">
            <div className="mt-1 md:mt-0">
              <Button variant="ghost" className="w-full justify-start text-destructive hover:text-destructive">
                <Trash2 className="size-4 mr-2" />
                Delete
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </Comp>
  )
}
