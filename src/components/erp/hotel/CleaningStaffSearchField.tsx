'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ChevronDown, Loader2, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface CleaningStaffResult {
  id: string
  staffCode: string
  name: string
  phone?: string | null
}

interface CleaningStaffSearchFieldProps {
  label?: string
  selectedId: string
  selectedLabel?: string
  onSelect: (staff: CleaningStaffResult) => void
  onClear: () => void
}

export function formatCleaningStaffLabel(staff: Pick<CleaningStaffResult, 'name' | 'staffCode'>) {
  return `${staff.name} (${staff.staffCode})`
}

function filterStaff(staff: CleaningStaffResult[], query: string): CleaningStaffResult[] {
  const q = query.trim().toLowerCase()
  if (!q) return staff
  return staff.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.staffCode.toLowerCase().includes(q) ||
      s.phone?.toLowerCase().includes(q)
  )
}

export function CleaningStaffSearchField({
  label = 'Assign staff',
  selectedId,
  selectedLabel,
  onSelect,
  onClear,
}: CleaningStaffSearchFieldProps) {
  const listboxId = useId()
  const listRef = useRef<HTMLUListElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(-1)

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setSearchQuery('')
        setHighlightedIndex(-1)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  const { data, isFetching } = useQuery({
    queryKey: ['cleaning-staff-all'],
    queryFn: () =>
      api.get<{ success: boolean; data: CleaningStaffResult[] }>(
        '/housekeeping/cleaning-staff?limit=50'
      ),
    enabled: open,
    staleTime: 60_000,
  })

  const allStaff =
    ((data as { data?: CleaningStaffResult[] })?.data || []) as CleaningStaffResult[]

  const results = useMemo(
    () => filterStaff(allStaff, searchQuery),
    [allStaff, searchQuery]
  )

  const showList = open
  const canNavigate = showList && results.length > 0 && !isFetching

  useEffect(() => {
    if (!open) return
    setHighlightedIndex(results.length > 0 ? 0 : -1)
  }, [open, searchQuery, results.length])

  useEffect(() => {
    if (highlightedIndex < 0 || !listRef.current) return
    const item = listRef.current.querySelector(`[data-index="${highlightedIndex}"]`)
    item?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex])

  const handleSelect = (staff: CleaningStaffResult) => {
    onSelect(staff)
    setSearchQuery('')
    setOpen(false)
    setHighlightedIndex(-1)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      if (!showList) {
        setOpen(true)
        return
      }
      if (!canNavigate) return
      e.preventDefault()
      setHighlightedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0))
      return
    }

    if (e.key === 'ArrowUp') {
      if (!canNavigate) return
      e.preventDefault()
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1))
      return
    }

    if (e.key === 'Enter') {
      if (!showList) {
        setOpen(true)
        return
      }
      if (!canNavigate) return
      e.preventDefault()
      const index = highlightedIndex >= 0 ? highlightedIndex : 0
      const staff = results[index]
      if (staff) handleSelect(staff)
      return
    }

    if (e.key === 'Escape') {
      if (!showList) return
      e.preventDefault()
      setOpen(false)
      setSearchQuery('')
      setHighlightedIndex(-1)
    }
  }

  return (
    <div ref={containerRef} className="space-y-2">
      <Label htmlFor={`${listboxId}-input`}>{label}</Label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={`${listboxId}-input`}
          role="combobox"
          aria-expanded={showList}
          aria-controls={showList ? listboxId : undefined}
          aria-activedescendant={
            canNavigate && highlightedIndex >= 0
              ? `${listboxId}-option-${highlightedIndex}`
              : undefined
          }
          aria-autocomplete="list"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Click or type to search staff…"
          className="pl-9 pr-9"
          autoComplete="off"
        />
        <button
          type="button"
          tabIndex={-1}
          className="absolute right-0 top-0 flex h-full w-9 items-center justify-center text-muted-foreground hover:text-foreground"
          aria-label="Open staff list"
          onClick={() => setOpen((prev) => !prev)}
        >
          {isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin text-amber-600" />
          ) : (
            <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
          )}
        </button>
      </div>

      {showList && (
        <ul
          ref={listRef}
          id={listboxId}
          className="z-50 max-h-52 overflow-auto rounded-md border bg-card shadow-md"
          role="listbox"
        >
          {isFetching && results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">Loading staff…</li>
          ) : results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              {allStaff.length === 0
                ? 'No cleaning staff yet — use Add Cleaning Staff first'
                : 'No staff match your search'}
            </li>
          ) : (
            results.map((staff, index) => (
              <li
                key={staff.id}
                id={`${listboxId}-option-${index}`}
                role="option"
                data-index={index}
                aria-selected={highlightedIndex === index || selectedId === staff.id}
              >
                <button
                  type="button"
                  className={cn(
                    'w-full px-3 py-2 text-left focus:outline-none',
                    highlightedIndex === index
                      ? 'bg-amber-100 ring-1 ring-inset ring-amber-300'
                      : 'hover:bg-amber-50 focus:bg-amber-50',
                    selectedId === staff.id && highlightedIndex !== index && 'bg-amber-50/80'
                  )}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => handleSelect(staff)}
                >
                  <p className="text-sm font-medium text-foreground">
                    {staff.name}{' '}
                    <span className="text-muted-foreground">({staff.staffCode})</span>
                  </p>
                  {staff.phone ? (
                    <p className="text-xs text-muted-foreground">{staff.phone}</p>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      {selectedId && selectedLabel && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm">
          <span className="text-emerald-900">
            Assigned: <strong>{selectedLabel}</strong>
          </span>
          <button
            type="button"
            className="text-xs font-medium text-red-600 hover:text-red-700"
            onClick={onClear}
          >
            Clear
          </button>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Click the field or arrow to open the list, or type to filter staff.
      </p>
    </div>
  )
}
