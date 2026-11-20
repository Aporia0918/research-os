// This branch builds the 「组会之后」 prototype. The original 思维账本 app (App.tsx) is unchanged and still tested.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MentorApp } from './mentor/MentorApp';
import '@jelly/jelly.css';
import './jelly/jelly.css';
import './styles.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><MentorApp /></React.StrictMode>);
