import React, { useRef, useState } from 'react'
import { PromptGroup } from '../api/prompts'
import { usePromptGroups } from '../hooks/usePromptGroups'
import { CollageConfig, LayoutMode, SourceMode, useCollage } from '../hooks/useCollage'
import styles from './CollagePage.module.css'

const DEFAULT_CFG: CollageConfig = {
  sourceMode: 'all',
  selectedPromptIds: [],
  promptImageCount: 10,
  promptRandom: false,
  randomCount: 20,
  canvasWidth: 1920,
  canvasHeight: 1080,
  layout: 'shelf',
  spacing: 0,
  bgColor: '#111111',
}

export default function CollagePage() {
  const { groups } = usePromptGroups()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { generate, download, cancel, generating, error } = useCollage(canvasRef)

  const [cfg, setCfg] = useState<CollageConfig>(DEFAULT_CFG)

  function set<K extends keyof CollageConfig>(key: K, value: CollageConfig[K]) {
    setCfg((prev) => ({ ...prev, [key]: value }))
  }

  function togglePrompt(id: string) {
    setCfg((prev) => {
      const ids = prev.selectedPromptIds.includes(id)
        ? prev.selectedPromptIds.filter((x) => x !== id)
        : [...prev.selectedPromptIds, id]
      return { ...prev, selectedPromptIds: ids }
    })
  }

  return (
    <div className={styles.page}>
      {/* ── Controls sidebar ──────────────────────────────── */}
      <aside className={styles.sidebar}>
        <h2 className={styles.heading}>Collage</h2>

        {/* Source */}
        <section className={styles.section}>
          <label className={styles.sectionLabel}>Source</label>
          {(['all', 'prompt', 'random'] as SourceMode[]).map((m) => (
            <label key={m} className={styles.radioLabel}>
              <input
                type="radio"
                name="sourceMode"
                value={m}
                checked={cfg.sourceMode === m}
                onChange={() => set('sourceMode', m)}
              />
              {m === 'all' ? 'All images' : m === 'prompt' ? 'By prompt' : 'Random N'}
            </label>
          ))}
        </section>

        {/* Prompt multi-select */}
        {cfg.sourceMode === 'prompt' && (
          <section className={styles.section}>
            <label className={styles.sectionLabel}>Prompts</label>
            <div className={styles.promptList}>
              {groups.map((g: PromptGroup) => (
                <label key={g.prompt_id} className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={cfg.selectedPromptIds.includes(g.prompt_id)}
                    onChange={() => togglePrompt(g.prompt_id)}
                  />
                  <span className={styles.checkText}>
                    {g.prompt.slice(0, 55)}{g.prompt.length > 55 ? '…' : ''}
                    <span className={styles.count}> ({g.count})</span>
                  </span>
                </label>
              ))}
            </div>
          </section>
        )}

        {/* Images per prompt */}
        {cfg.sourceMode === 'prompt' && (
          <section className={styles.section}>
            <label className={styles.sectionLabel}>
              Images per prompt: <strong>{cfg.promptImageCount}</strong>
            </label>
            <input
              type="range" min={1} max={50} value={cfg.promptImageCount}
              onChange={(e) => set('promptImageCount', Number(e.target.value))}
              className={styles.range}
            />
            <label className={styles.radioLabel} style={{ marginTop: 4 }}>
              <input
                type="checkbox"
                checked={cfg.promptRandom}
                onChange={(e) => set('promptRandom', e.target.checked)}
              />
              Pick randomly
            </label>
          </section>
        )}

        {/* Random count */}
        {cfg.sourceMode === 'random' && (
          <section className={styles.section}>
            <label className={styles.sectionLabel}>
              Count: <strong>{cfg.randomCount}</strong>
            </label>
            <input
              type="range" min={1} max={200} value={cfg.randomCount}
              onChange={(e) => set('randomCount', Number(e.target.value))}
              className={styles.range}
            />
          </section>
        )}

        {/* Canvas size */}
        <section className={styles.section}>
          <label className={styles.sectionLabel}>
            Width: <strong>{cfg.canvasWidth}px</strong>
          </label>
          <input
            type="range" min={400} max={4000} step={40} value={cfg.canvasWidth}
            onChange={(e) => set('canvasWidth', Number(e.target.value))}
            className={styles.range}
          />
          <label className={styles.sectionLabel} style={{ marginTop: 8 }}>
            Height: <strong>{cfg.canvasHeight}px</strong>
          </label>
          <input
            type="range" min={400} max={4000} step={40} value={cfg.canvasHeight}
            onChange={(e) => set('canvasHeight', Number(e.target.value))}
            className={styles.range}
          />
        </section>

        {/* Quick presets */}
        <section className={styles.section}>
          <label className={styles.sectionLabel}>Presets</label>
          <div className={styles.presets}>
            {[
              { label: '16:9 HD', w: 1920, h: 1080 },
              { label: '1:1', w: 1080, h: 1080 },
              { label: '4:3', w: 1600, h: 1200 },
              { label: '9:16', w: 1080, h: 1920 },
            ].map(({ label, w, h }) => (
              <button
                key={label}
                className={styles.presetBtn}
                onClick={() => setCfg((p) => ({ ...p, canvasWidth: w, canvasHeight: h }))}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* Layout */}
        <section className={styles.section}>
          <label className={styles.sectionLabel}>Layout</label>
          {(['shelf', 'uniform', 'masonry'] as LayoutMode[]).map((m) => (
            <label key={m} className={styles.radioLabel}>
              <input
                type="radio"
                name="layout"
                value={m}
                checked={cfg.layout === m}
                onChange={() => set('layout', m)}
              />
              {m === 'shelf' ? 'Shelf (tight fill)' : m === 'uniform' ? 'Uniform grid' : 'Masonry'}
            </label>
          ))}
        </section>

        {/* Spacing */}
        <section className={styles.section}>
          <label className={styles.sectionLabel}>
            Spacing: <strong>{cfg.spacing}px</strong>
          </label>
          <input
            type="range" min={0} max={24} value={cfg.spacing}
            onChange={(e) => set('spacing', Number(e.target.value))}
            className={styles.range}
          />
        </section>

        {/* Background */}
        <section className={styles.section}>
          <label className={styles.sectionLabel}>Background</label>
          <div className={styles.bgRow}>
            <input
              type="color"
              value={cfg.bgColor}
              onChange={(e) => set('bgColor', e.target.value)}
              className={styles.colorPicker}
            />
            <span className={styles.colorHex}>{cfg.bgColor}</span>
            <button className={styles.presetBtn} onClick={() => set('bgColor', '#111111')}>Dark</button>
            <button className={styles.presetBtn} onClick={() => set('bgColor', '#ffffff')}>White</button>
          </div>
        </section>

        {/* Actions */}
        <div className={styles.actions}>
          {generating ? (
            <button className={`${styles.btn} ${styles.btnCancel}`} onClick={cancel}>
              ✕ Cancel
            </button>
          ) : (
            <button
              className={`${styles.btn} ${styles.btnGenerate}`}
              onClick={() => generate(cfg)}
            >
              ▶ Generate
            </button>
          )}
          <button className={`${styles.btn} ${styles.btnDownload}`} onClick={download}>
            ↓ Download PNG
          </button>
        </div>

        {error && <p className={styles.error}>{error}</p>}
        {generating && <p className={styles.status}>Loading images…</p>}
      </aside>

      {/* ── Canvas preview ────────────────────────────────── */}
      <main className={styles.preview}>
        <div className={styles.canvasWrap}>
          <canvas ref={canvasRef} className={styles.canvas} />
          {!generating && !canvasRef.current?.width && (
            <div className={styles.placeholder}>
              Configure options and click <strong>Generate</strong>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
