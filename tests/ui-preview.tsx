// Development-only visual fixture; Vite's production build starts from root index.html.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { Shell } from '../src/app/App';
import Onboarding from '../src/features/onboarding/Onboarding';
import '../src/styles/tokens.css';
import '../src/styles/layout.css';

const shell = new URLSearchParams(location.search).get('view') === 'shell';
createRoot(document.getElementById('root')!).render(shell
  ? <HashRouter><Shell
      status={{ initialized: true, unlocked: true, autoLockMinutes: 10 }}
      goals={[]}
      theme="dark"
      setTheme={() => {}}
      onLock={() => {}}
      onStatus={() => {}}
      onGoals={() => {}}
    /></HashRouter>
  : <Onboarding onCreated={() => {}} />);
