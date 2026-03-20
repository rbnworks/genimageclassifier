import React from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useRealtimeStatus } from '../hooks/useRealtimeStatus'
import { useExportJob } from '../hooks/useExportJob'
import styles from './Layout.module.css'

export default function Layout() {
  const wsStatus = useRealtimeStatus()
  const { status: exportStatus, done: exportDone, total: exportTotal } = useExportJob()
  const navClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? styles.linkActive : styles.link

  return (
    <div className={styles.shell}>
      <main className={styles.content}>
        <Outlet />
      </main>

      <nav className={styles.sidebar} aria-label="Main navigation">
        <span className={styles.logo}>GIC</span>
        <NavLink to="/" className={navClass} end title="Dashboard">
          Dash
        </NavLink>
        <NavLink to="/album" className={navClass} title="Prompt Album">
          Album
        </NavLink>
        <NavLink to="/slideshow" className={navClass} title="Slideshow">
          Slides
        </NavLink>
        <NavLink to="/collage" className={navClass} title="Collage maker" end>
          Collage
        </NavLink>
        <NavLink to="/collage/editor" className={navClass} title="Layout editor">
          Editor
        </NavLink>
        <NavLink to="/settings" className={navClass} title="Settings">
          Settings
        </NavLink>

        {exportStatus === 'building' && (
          <div className={styles.exportMini} title={`Exporting ${exportDone} / ${exportTotal} prompts`}>
            <span className={styles.exportMiniLabel}>
              {exportTotal > 0 ? `${Math.round((exportDone / exportTotal) * 100)}%` : '…'}
            </span>
            <div className={styles.exportMiniTrack}>
              <div
                className={styles.exportMiniFill}
                style={{ width: exportTotal > 0 ? `${(exportDone / exportTotal) * 100}%` : '5%' }}
              />
            </div>
          </div>
        )}

        <div className={styles.wsStatus} title={`Realtime: ${wsStatus}`}>
          <span className={`${styles.wsDot} ${styles[`ws${wsStatus[0].toUpperCase()}${wsStatus.slice(1)}`]}`} />
          <span className={styles.wsText}>{wsStatus}</span>
        </div>
      </nav>
    </div>
  )
}
