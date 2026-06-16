import { createRoot } from 'react-dom/client';
import '@solana/wallet-adapter-react-ui/styles.css';
import './index.css';
import './ui/icons.css';
import './ui/theme.css';
import { App } from './ui/App';

createRoot(document.getElementById('root')!).render(<App />);
