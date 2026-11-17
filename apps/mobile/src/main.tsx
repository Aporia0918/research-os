import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@jelly/jelly.css';
import './jelly/jelly.css';
import './styles.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
