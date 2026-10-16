import './twitchConnection.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { TwitchConnection } from './components/TwitchConnection';
ReactDOM.createRoot(document.getElementById('twitch-connection')!).render(<React.StrictMode><TwitchConnection/></React.StrictMode>);
