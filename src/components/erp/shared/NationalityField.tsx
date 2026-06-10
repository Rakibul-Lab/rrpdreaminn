'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { filterNationalities, NATIONALITY_OPTIONS } from '@/lib/nationalities'

interface NationalityFieldProps {
  value: string
  onChange: (value: string) => void
  label?: string
  placeholder?: string
  id?: string
}

export function NationalityField({
  value,
  onChange,
  label = 'Nationality',
  placeholder = 'Type or select nationality…',
  id,
}: NationalityFieldProps) {
  const listboxId = useId()
  const inputId = id ?? `${listboxId}-input`
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [searchQuery, setSearchQuery] = useState<string | null>(null)

  const results = useMemo(() => {
    if (open) {
      if (searchQuery === null) return NATIONALITY_OPTIONS
      return filterNationalities(searchQuery, NATIONALITY_OPTIONS.length)
    }
    return filterNationalities(value, 50)
  }, [open, searchQuery, value])

  const showList = open && results.length > 0
  const canNavigate = showList

  useEffect(() => {
    setHighlightedIndex(-1)
  }, [value])

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

  useEffect(() => {
    if (highlightedIndex < 0 || !listRef.current) return
    const item = listRef.current.querySelector(`[data-index="${highlightedIndex}"]`)
    item?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex])

  const handleSelect = (nationality: string) => {
    onChange(nationality)
    setSearchQuery(null)
    setOpen(false)
    setHighlightedIndex(-1)
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
      const index = highlightedIndex >= 0 ? highlightedIndex : 0
      const option = results[index]
      if (option) handleSelect(option)
      return
    }

    if (e.key === 'Escape') {
      if (!open) return
      e.preventDefault()
      setOpen(false)
      setHighlightedIndex(-1)
    }
  }

  return (
    <div ref={containerRef} className="space-y-2">
      <Label htmlFor={inputId}>{label}</Label>
      <div className="relative">
        <Input
          ref={inputRef}
          id={inputId}
          role="combobox"
          aria-expanded={showList}
          aria-controls={showList ? listboxId : undefined}
          aria-activedescendant={
            canNavigate && highlightedIndex >= 0
              ? `${listboxId}-option-${highlightedIndex}`
              : undefined
          }
          aria-autocomplete="list"
          value={value}
          onChange={(e) => {
            setSearchQuery(e.target.value)
            onChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => {
            setSearchQuery(null)
            setOpen(true)
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="pr-9"
          autoComplete="off"
        />
        <button
          type="button"
          tabIndex={-1}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={() => {
            setSearchQuery(null)
            setOpen((prev) => !prev)
            inputRef.current?.focus()
          }}
          aria-label="Show nationalities"
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
        </button>

        {showList && (
          <ul
            ref={listRef}
            id={listboxId}
            className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover shadow-md"
            role="listbox"
          >
            {results.map((nationality, index) => (
              <li
                key={nationality}
                id={`${listboxId}-option-${index}`}
                data-index={index}
                role="option"
                aria-selected={value === nationality}
                className={cn(
                  'cursor-pointer px-3 py-2 text-sm',
                  highlightedIndex === index && 'bg-accent text-accent-foreground',
                  value === nationality && highlightedIndex !== index && 'bg-muted/60'
                )}
                onMouseEnter={() => setHighlightedIndex(index)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(nationality)}
              >
                {nationality}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
