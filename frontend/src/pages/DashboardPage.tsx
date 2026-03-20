import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchStats, Stats } from '../api/stats'
import { subscribeRealtime } from '../realtime/events'
import styles from './DashboardPage.module.css'

const STAT_CARDS = [
  { key: 'totalImages',             label: 'Total Images',        icon: '🖼' },
  { key: 'imagesWithMetadata',      label: 'With Metadata',       icon: '✅' },
  { key: 'imagesWithoutMetadata',   label: 'Without Metadata',    icon: '⚠️' },
  { key: 'uniquePrompts',           label: 'Unique Prompts',      icon: '✏️' },
] as const

const QUICK_LINKS = [
  { to: '/album',     label: 'Prompt Album',  desc: 'Browse images grouped by prompt' },
  { to: '/slideshow', label: 'Slideshow',     desc: 'Auto-play all your images'       },
  { to: '/settings',  label: 'Settings',      desc: 'Configure scan behaviour'        },
]

export default function DashboardPage() {
  const [stats, setStats]   = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => {
    fetchStats()
      .then(setStats)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false))

    return subscribeRealtime((event) => {
      if (event.type !== 'scan_updated') return
      fetchStats()
        .then(setStats)
        .catch((e: unknown) => setError(String(e)))
    })
  }, [])

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Dashboard</h1>

      {/* ── Stat cards ──────────────────────────────────────── */}
      <div className={styles.statsGrid}>
        {STAT_CARDS.map(({ key, label, icon }) => (
          <div key={key} className={styles.statCard}>
            <span className={styles.statIcon}>{icon}</span>
            <span className={styles.statValue}>
              {loading ? '—' : error ? '?' : stats![key].toLocaleString()}
            </span>
            <span className={styles.statLabel}>{label}</span>
          </div>
        ))}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {/* ── Quick links ─────────────────────────────────────── */}
      <h2 className={styles.sectionTitle}>Quick access</h2>
      <div className={styles.linkGrid}>
        {QUICK_LINKS.map(({ to, label, desc }) => (
          <Link key={to} to={to} className={styles.linkCard}>
            <span className={styles.linkLabel}>{label}</span>
            <span className={styles.linkDesc}>{desc}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
