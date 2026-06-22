export interface TwitchCheckInCommand {
  viewerName: string;
  locationQuery: string;
}

interface TwitchChatClientOptions {
  channel: string;
  onCheckIn: (command: TwitchCheckInCommand) => void;
  onReset?: (viewerName: string) => void;
  onStatus?: (status: string) => void;
}

const TWITCH_CHAT_URL = 'wss://irc-ws.chat.twitch.tv:443';
const CHECKIN_PREFIX = '!checkin';
const RESET_COMMAND = '!globe reset';

function parseDisplayName(tags: string, fallback: string): string {
  const displayNameTag = tags
    .split(';')
    .find((tag) => tag.startsWith('display-name='))
    ?.slice('display-name='.length);

  return displayNameTag?.trim() || fallback;
}

function parsePrivMsg(
  rawMessage: string,
): { checkIn?: TwitchCheckInCommand; resetViewerName?: string } | null {
  const match = rawMessage.match(/^@([^ ]+) :([^!]+)![^ ]+ PRIVMSG #[^ ]+ :(.+)$/);

  if (!match) {
    return null;
  }

  const [, tags, login, message] = match;
  const trimmedMessage = message.trim();
  const viewerName = parseDisplayName(tags, login);

  if (trimmedMessage.toLowerCase() === RESET_COMMAND) {
    return {
      resetViewerName: viewerName,
    };
  }

  if (
    trimmedMessage.toLowerCase() !== CHECKIN_PREFIX &&
    !trimmedMessage.toLowerCase().startsWith(`${CHECKIN_PREFIX} `)
  ) {
    return null;
  }

  const locationQuery = trimmedMessage.slice(CHECKIN_PREFIX.length).trim();

  if (!locationQuery) {
    return null;
  }

  return {
    checkIn: {
      viewerName,
      locationQuery,
    },
  };
}

export function connectTwitchCheckInChat({
  channel,
  onCheckIn,
  onReset,
  onStatus,
}: TwitchChatClientOptions): () => void {
  const normalizedChannel = channel.trim().replace(/^#/, '').toLowerCase();

  if (!normalizedChannel) {
    onStatus?.('Add a Twitch channel to enable chat check-ins.');
    return () => undefined;
  }

  const socket = new WebSocket(TWITCH_CHAT_URL);
  let closedByClient = false;

  socket.addEventListener('open', () => {
    onStatus?.(`Listening to #${normalizedChannel}`);
    socket.send('CAP REQ :twitch.tv/tags');
    socket.send('PASS SCHMOOPIIE');
    socket.send(`NICK justinfan${Math.floor(Math.random() * 100000)}`);
    socket.send(`JOIN #${normalizedChannel}`);
  });

  socket.addEventListener('message', (event) => {
    const data = String(event.data);
    const messages = data.split('\r\n').filter(Boolean);

    for (const message of messages) {
      if (message.startsWith('PING')) {
        socket.send('PONG :tmi.twitch.tv');
        continue;
      }

      const command = parsePrivMsg(message);

      if (command?.checkIn) {
        onCheckIn(command.checkIn);
      }

      if (command?.resetViewerName) {
        onReset?.(command.resetViewerName);
      }
    }
  });

  socket.addEventListener('close', () => {
    if (!closedByClient) {
      onStatus?.('Twitch chat disconnected.');
    }
  });

  socket.addEventListener('error', () => {
    onStatus?.('Unable to connect to Twitch chat.');
  });

  return () => {
    closedByClient = true;
    socket.close();
  };
}
