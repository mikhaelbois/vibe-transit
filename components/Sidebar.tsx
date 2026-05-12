'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import SignOutButton from './SignOutButton'

const navItems = [
  { href: '/dashboard/sync', label: 'Sync' },
  { href: '/dashboard/history', label: 'History' },
  { href: '/dashboard/data', label: 'Data' },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-48 bg-slate-900 border-r border-slate-800 flex flex-col min-h-screen flex-shrink-0">
      <div className="p-4 border-b border-slate-800">
        <span className="text-violet-400 font-bold text-sm">■ Vibe Transit</span>
      </div>
      <nav className="flex-1 py-2">
        {navItems.map((item) => {
          const active = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block px-4 py-2 text-sm transition-colors ${
                active
                  ? 'text-violet-400 border-l-2 border-violet-500 bg-violet-500/10'
                  : 'text-slate-400 hover:text-slate-200 border-l-2 border-transparent'
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div className="p-4 border-t border-slate-800">
        <SignOutButton />
      </div>
    </aside>
  )
}
