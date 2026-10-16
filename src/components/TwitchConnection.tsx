import { useEffect, useState } from 'react';
import { connectBrowserTwitch } from '../lib/twitchBrowserConnect';
import { clearBrowserTwitch, getBrowserTwitchIdentity, subscribeBrowserTwitch } from '../lib/twitchConnect';
import { TwitchIcon } from './TwitchIcon';
import { dancefloorRequest } from '../lib/dancefloorClient';
export function TwitchConnection() {
  const [identity, setIdentity] = useState(getBrowserTwitchIdentity);
  useEffect(() => subscribeBrowserTwitch(() => setIdentity(getBrowserTwitchIdentity())), []);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return <div className="shared-twitch" aria-label="Twitch account">
    <div className="shared-twitch-controls"><span className="shared-twitch-account"><TwitchIcon/>{identity ? `Signed in as ${identity.login}` : 'Twitch account'}</span>
      <button className="shared-twitch-button" disabled={busy} onClick={() => {
        setBusy(true); setMessage('');
        void connectBrowserTwitch().catch(error => setMessage(error.message)).finally(() => setBusy(false));
      }}>{busy ? 'Connecting…' : identity ? 'Switch account' : 'Connect with Twitch'}</button>
      {identity && <button className="shared-twitch-disconnect" disabled={busy} onClick={() => {
        setBusy(true); setMessage('');
        void dancefloorRequest('/me/disconnect', 'POST', {}).then(() => { clearBrowserTwitch(); setMessage('Signed out. Background Dancefloor connection stopped.'); })
          .catch(error => setMessage(`Could not disconnect: ${error.message}`)).finally(() => setBusy(false));
      }}>Disconnect</button>}
    </div>
    {message && <p className="shared-twitch-message" role="status">{message}</p>}
    {identity && <p className="shared-twitch-message">Connected across tools in this browser tab.</p>}
  </div>;
}
