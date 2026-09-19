import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@keel-design/tokens/styles.css'

import { App } from './ui/App.js'
import './styles.css'

createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
        <App />
    </StrictMode>,
)
