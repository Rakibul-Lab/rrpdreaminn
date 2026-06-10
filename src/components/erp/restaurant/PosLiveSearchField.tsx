'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Loader2, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface PosLiveSearchFieldProps<T> {
  label?: string
  placeholder: string
  selectedId?: string
  selectedLabel?: string
  items: T[]
  isLoading?: boolean
  getItemId: (item: T) => string
  getItemLabel: (item: T) => string
  getItemSublabel?: (item: T) => string
  filterItem: (item: T, query: string) => boolean
  onSelect: (item: T) => void
  onClear?: () => void
  emptyMessage?: string
  noResultsMessage?: string
  maxResults?: number
  /** Render dropdown as an overlay below the input (for compact headers). */
  overlayDropdown?: boolean
  inputClassName?: string
  disabled?: boolean
}

export function PosLiveSearchField<T>({
  label,
  placeholder,
  selectedId,
  selectedLabel,
  items,
  isLoading = false,
  getItemId,
  getItemLabel,
  getItemSublabel,
  filterItem,
  onSelect,
  onClear,
  emptyMessage = 'No options available',
  noResultsMessage = 'No matches found',
  maxResults = 15,
  overlayDropdown = false,
  inputClassName,
  disabled = false,
}: PosLiveSearchFieldProps<T>) {
  const listboxId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(searchQuery.trim().toLowerCase()), 200)
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

  const results = useMemo(() => {
    const filtered = debouncedQuery
      ? items.filter((item) => filterItem(item, debouncedQuery))
      : items
    return filtered.slice(0, maxResults)
  }, [items, debouncedQuery, filterItem, maxResults])

  const showList = open && !isLoading
  const canNavigate = showList && results.length > 0

  useEffect(() => {
    if (highlightedIndex < 0 || !listRef.current) return
    const item = listRef.current.querySelector(`[data-index="${highlightedIndex}"]`)
    item?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex])

  const handleSelect = (item: T) => {
    onSelect(item)
    setSearchQuery('')
    setOpen(false)
    setHighlightedIndex(-1)
    inputRef.current?.blur()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      if (!canNavigate) {
        setOpen(true)
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
      e.stopPropagation()
      const index = highlightedIndex >= 0 ? highlightedIndex : 0
      const item = results[index]
      if (item) handleSelect(item)
      return
    }

    if (e.key === 'Escape') {
      if (!showList) return
      e.preventDefault()
      setOpen(false)
      setHighlightedIndex(-1)
    }
  }

  const listContent = showList ? (
    <ul
      ref={listRef}
      id={listboxId}
      className={cn(
        'z-50 max-h-52 overflow-auto rounded-md border bg-card shadow-md',
        overlayDropdown && 'absolute left-0 right-0 top-full mt-1'
      )}
      role="listbox"
    >
      {items.length === 0 ? (
        <li className="px-3 py-2 text-xs text-muted-foreground">{emptyMessage}</li>
      ) : results.length === 0 ? (
        <li className="px-3 py-2 text-xs text-muted-foreground">{noResultsMessage}</li>
      ) : (
        results.map((item, index) => (
          <li
            key={getItemId(item)}
            id={`${listboxId}-option-${index}`}
            role="option"
            data-index={index}
            aria-selected={highlightedIndex === index || selectedId === getItemId(item)}
          >
            <button
              type="button"
              className={cn(
                'w-full px-3 py-2 text-left focus:outline-none',
                highlightedIndex === index
                  ? 'bg-amber-100 ring-1 ring-inset ring-amber-300'
                  : 'hover:bg-amber-50 focus:bg-amber-50',
                selectedId === getItemId(item) &&
                  highlightedIndex !== index &&
                  'bg-amber-50/80'
              )}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => handleSelect(item)}
            >
              <p className="text-sm font-medium text-foreground">{getItemLabel(item)}</p>
              {getItemSublabel?.(item) && (
                <p className="text-xs text-muted-foreground">{getItemSublabel(item)}</p>
              )}
            </button>
          </li>
        ))
      )}
    </ul>
  ) : null

  return (
    <div ref={containerRef} className={cn('space-y-1.5', overlayDropdown && 'relative z-20')}>
      {label && (
        <label htmlFor={`${listboxId}-input`} className="text-xs font-medium text-muted-foreground block">
          {label}
        </label>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
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
          onFocus={() => {
            if (!disabled) setOpen(true)
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn('h-9 pl-8 pr-8 text-sm', inputClassName)}
          autoComplete="off"
          disabled={disabled || isLoading}
        />
        {isLoading && (
          <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-amber-600" />
        )}
        {searchQuery && !isLoading && (
          <button
            type="button"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground"
            onClick={() => {
              setSearchQuery('')
              setOpen(false)
              setHighlightedIndex(-1)
            }}
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {overlayDropdown && listContent}
      </div>

      {!overlayDropdown && listContent}

      {selectedId && selectedLabel && onClear && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50/60 px-2.5 py-1.5 text-xs">
          <span className="text-emerald-900 truncate">
            Selected: <strong>{selectedLabel}</strong>
          </span>
          <button
            type="button"
            className="shrink-0 font-medium text-red-600 hover:text-red-700"
            onClick={onClear}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
