'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface GuestSearchResult {
  id: string
  name: string
  phone: string
  company?: string | null
  email?: string | null
  address?: string | null
  idType?: string | null
  idNumber?: string | null
  registrationNumber?: string | null
  nationality?: string | null
}

interface GuestSearchFieldProps {
  selectedId: string
  selectedLabel?: string
  onSelect: (guest: GuestSearchResult) => void
  onClear: () => void
}

export function GuestSearchField({
  selectedId,
  selectedLabel,
  onSelect,
  onClear,
}: GuestSearchFieldProps) {
  const listboxId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(searchQuery.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [searchQuery])

  useEffect(() => {
    setHighlightedIndex(-1)
  }, [debouncedQuery])

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setHighlightedIndex(-1)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  const { data, isFetching } = useQuery({
    queryKey: ['customers-search', debouncedQuery],
    queryFn: () =>
      api.get<{ success: boolean; data: GuestSearchResult[] }>(
        `/customers?search=${encodeURIComponent(debouncedQuery)}&limit=15`
      ),
    enabled: open && debouncedQuery.length >= 1,
  })

  const results = ((data as { data?: GuestSearchResult[] })?.data || []) as GuestSearchResult[]
  const showList = open && debouncedQuery.length > 0
  const canNavigate = showList && results.length > 0 && !isFetching

  useEffect(() => {
    if (highlightedIndex < 0 || !listRef.current) return
    const item = listRef.current.querySelector(`[data-index="${highlightedIndex}"]`)
    item?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex])

  const handleSelect = (guest: GuestSearchResult) => {
    onSelect(guest)
    setSearchQuery('')
    setOpen(false)
    setHighlightedIndex(-1)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      if (!canNavigate) {
        if (debouncedQuery.length > 0) setOpen(true)
        return
      }
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
      if (!canNavigate) return
      e.preventDefault()
      const index = highlightedIndex >= 0 ? highlightedIndex : 0
      const guest = results[index]
      if (guest) handleSelect(guest)
      return
    }

    if (e.key === 'Escape') {
      if (!showList) return
      e.preventDefault()
      setOpen(false)
      setHighlightedIndex(-1)
    }
  }

  return (
    <div ref={containerRef} className="space-y-2">
      <Label htmlFor={`${listboxId}-input`}>Search guest</Label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
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
          onKeyDown={handleKeyDown}
          placeholder="Type name, phone, or email…"
          className="pl-9 pr-9"
          autoComplete="off"
        />
        {isFetching && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-amber-600" />
        )}
        {searchQuery && !isFetching && (
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setSearchQuery('')
              setOpen(false)
              setHighlightedIndex(-1)
            }}
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {showList && (
        <ul
          ref={listRef}
          id={listboxId}
          className="z-50 max-h-52 overflow-auto rounded-md border bg-card shadow-md"
          role="listbox"
        >
          {isFetching && results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">Searching…</li>
          ) : results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">No guests found</li>
          ) : (
            results.map((guest, index) => (
              <li
                key={guest.id}
                id={`${listboxId}-option-${index}`}
                role="option"
                data-index={index}
                aria-selected={highlightedIndex === index || selectedId === guest.id}
              >
                <button
                  type="button"
                  className={cn(
                    'w-full px-3 py-2 text-left focus:outline-none',
                    highlightedIndex === index
                      ? 'bg-amber-100 ring-1 ring-inset ring-amber-300'
                      : 'hover:bg-amber-50 focus:bg-amber-50',
                    selectedId === guest.id && highlightedIndex !== index && 'bg-amber-50/80'
                  )}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => handleSelect(guest)}
                >
                  <p className="text-sm font-medium text-foreground">{guest.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {guest.phone}
                    {guest.email ? ` · ${guest.email}` : ''}
                  </p>
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      {selectedId && selectedLabel && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm">
          <span className="text-emerald-900">
            Selected: <strong>{selectedLabel}</strong>
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
        Type to search, then use ↑ ↓ to choose and Enter to select.
      </p>
    </div>
  )
}
