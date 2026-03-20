import React from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import DashboardPage from './pages/DashboardPage'
import PromptAlbumPage from './pages/PromptAlbumPage'
import SlideshowPage from './pages/SlideshowPage'
import SettingsPage from './pages/SettingsPage'
import CollagePage from './pages/CollagePage'
import CollageEditorPage from './pages/CollageEditorPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/album" element={<PromptAlbumPage />} />
          <Route path="/slideshow" element={<SlideshowPage />} />
          <Route path="/collage" element={<CollagePage />} />
          <Route path="/collage/editor" element={<CollageEditorPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
