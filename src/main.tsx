import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { applyStoredTheme } from './engine/theme'
import './theme.css'
import './styles.css'
import './schema.css'
import './landing.css'

// Before anything renders: a theme applied after first paint is a theme that flashes.
applyStoredTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
