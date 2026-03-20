import React, { useState } from 'react'
import { useExportJob, ExportResolution } from '../hooks/useExportJob'
import styles from './SettingsPage.module.css'

export default function SettingsPage() {
  const [darkMode, setDarkMode] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [showCount, setShowCount] = useState(true)
  const [notes, setNotes] = useState('')
  const { status, resolution, done, total, error, startExport, setResolution, dismiss } = useExportJob()
  const isBuilding = status === 'building'
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div className={styles.container}>
      <h1 className={styles.heading}>Settings</h1>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Display</h2>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={darkMode}
            onChange={(e) => setDarkMode(e.target.checked)}
          />
          Dark mode
        </label>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={showCount}
            onChange={(e) => setShowCount(e.target.checked)}
          />
          Show image count on cards
        </label>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Scanning</h2>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          Auto-refresh gallery
        </label>
        <p className={styles.hint}>
          Scan interval and watched folders are configured via environment variables
          (<code>SCAN_INTERVAL_SECONDS</code>, <code>WATCH_DIRS</code>) in
          <code>docker-compose.yml</code>.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Notes</h2>
        <textarea
          className={styles.textarea}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add any notes about your workflows…"
          rows={6}
        />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Export</h2>

        <div className={styles.exportResolutionRow}>
          <span className={styles.exportResolutionLabel}>Image resolution</span>
          <div className={styles.exportResolutionOptions}>
            {(['original', '720p', '480p'] as ExportResolution[]).map((r) => (
              <label key={r} className={styles.resolutionOption}>
                <input
                  type="radio"
                  name="exportResolution"
                  value={r}
                  checked={resolution === r}
                  onChange={() => setResolution(r)}
                  disabled={isBuilding}
                />
                {r === 'original' ? 'Original' : r}
              </label>
            ))}
          </div>
        </div>

        <button
          className={styles.exportBtn}
          onClick={() => startExport()}
          disabled={isBuilding}
        >
          {isBuilding ? 'Building…' : '⬇ Download Prompts ZIP'}
        </button>

        {isBuilding && (
          <div className={styles.exportProgress}>
            <div className={styles.exportProgressBar}>
              <div
                className={styles.exportProgressFill}
                style={{ width: total > 0 ? `${pct}%` : '3%' }}
              />
            </div>
            <span className={styles.exportProgressText}>
              {total > 0 ? `${done} / ${total} prompts · ${pct}%` : 'Starting…'}
            </span>
          </div>
        )}

        {status === 'ready' && (
          <p className={styles.exportProgressText}>Preparing download…</p>
        )}

        {status === 'error' && (
          <div className={styles.exportError}>
            <span>{error}</span>
            <button className={styles.exportDismiss} onClick={dismiss}>Dismiss</button>
          </div>
        )}
      </section>
    </div>
  )
}
