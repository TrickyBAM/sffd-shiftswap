'use client'

import { Button, Field, Select } from '@/components/ui'
import { isRole } from '@/lib/types/database'
import { SearchField, StationFilter } from '../../_components/ListControls'
import { DEFAULT_MEMBER_FILTERS, STATUS_OPTIONS, isMemberStatusFilter, type MemberFilters } from '../_lib/query'

export interface MemberFiltersBarProps {
  value: MemberFilters
  onChange: (next: MemberFilters) => void
}

/** Search box plus status (including Removed), role and station filters for the member list. */
export function MemberFiltersBar({ value, onChange }: MemberFiltersBarProps) {
  const set = <K extends keyof MemberFilters>(key: K, next: MemberFilters[K]) => onChange({ ...value, [key]: next })
  const filtered =
    value.search.trim() !== '' || value.status !== 'all' || value.role !== 'all' || value.station !== null

  return (
    <div className="space-y-3">
      <SearchField
        label="Search members"
        value={value.search}
        onChange={(search) => set('search', search)}
        placeholder="Name, email or phone"
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Status">
          <Select
            value={value.status}
            onChange={(event) => {
              const next = event.target.value
              set('status', isMemberStatusFilter(next) ? next : 'all')
            }}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Role">
          <Select
            value={value.role}
            onChange={(event) => {
              const next = event.target.value
              set('role', next === 'all' || !isRole(next) ? 'all' : next)
            }}
          >
            <option value="all">Everyone</option>
            <option value="admin">Admins</option>
            <option value="member">Members (not admins)</option>
          </Select>
        </Field>
        <StationFilter value={value.station} onChange={(station) => set('station', station)} />
      </div>
      {filtered ? (
        <Button variant="ghost" size="sm" onClick={() => onChange(DEFAULT_MEMBER_FILTERS)}>
          Clear filters
        </Button>
      ) : null}
    </div>
  )
}
