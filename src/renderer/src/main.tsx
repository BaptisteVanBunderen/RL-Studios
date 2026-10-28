import './assets/main.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { EditLayer } from './edit/EditLayer'

// La couche de placement à la souris est la même page, ouverte sur #edit dans sa propre fenêtre.
const editing = window.location.hash === '#edit'
if (editing) document.documentElement.classList.add('edit-layer')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{editing ? <EditLayer /> : <App />}</StrictMode>
)
