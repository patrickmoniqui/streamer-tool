import { useEffect, useState } from 'react';
import type { DancefloorConfig } from './dancefloor';
import { dancefloorRequest } from './dancefloorClient';
import { clearBrowserTwitch, getTwitchClientId, getTwitchConnectToken, refreshTwitchConnectToken, type TwitchIdentity } from './twitchConnect';
import { connectTwitchEventSub, eventSubSubscriptions, type TwitchEventStatus } from './twitchEventSub';
export function useDancefloorEvents(identity: TwitchIdentity | null, config?: DancefloorConfig): TwitchEventStatus {
  const [status, setStatus] = useState<TwitchEventStatus>({ state: 'idle', message: 'Connect with Twitch to start receiving events.' });
  const key = JSON.stringify(config ? eventSubSubscriptions(config, identity?.userId ?? '') : []);
  useEffect(() => {
    const token = getTwitchConnectToken();
    if (!identity || !token || !config) {
      setStatus({ state: 'idle', message: identity ? 'Loading saved settings…' : 'Connect with Twitch to start receiving events.' });
      return;
    }
    let active = true;
    const controller = new AbortController();
    const stop = connectTwitchEventSub({
      token, clientId: getTwitchClientId(), broadcasterId: identity.userId, config,
      onStatus: next => { if (active) setStatus(next); },
      onAuthExpired: () => { if (active) clearBrowserTwitch(); },
      onNotification: async message => {
        // Send only the fields used by Dancefloor; redemption text is unnecessary.
        const e = message.payload.event;
        const event = Object.fromEntries(['broadcaster_user_id', 'user_id', 'user_name', 'user_login', 'is_anonymous', 'is_gift', 'bits', 'reward'].filter(k => k in e).map(k => [k, e[k]]));
        if (event.reward && typeof event.reward === 'object') event.reward = { id: (event.reward as { id?: string }).id };
        await dancefloorRequest('/me/events', 'POST', { metadata: message.metadata, payload: { subscription: message.payload.subscription, event } }, controller.signal);
      },
    });
    // Expiry is checked locally each minute; validate with Twitch at least hourly.
    let lastValidation = Date.now();
    const timer = setInterval(() => {
      if (!getTwitchConnectToken()) { stop(); clearBrowserTwitch(); return; }
      if (Date.now() - lastValidation >= 3600000) {
        lastValidation = Date.now();
        void refreshTwitchConnectToken().then(valid => { if (active && !valid) { stop(); clearBrowserTwitch(); } });
      }
    }, 60000);
    return () => { active = false; stop(); controller.abort(); clearInterval(timer); };
    // Only published settings restart subscriptions; draft preview edits do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, key]);
  return status;
}
