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
const RESET_COMMANDS = new Set(['!checkin reset', '!globe reset']);

function parseTags(rawTags: string): Map<string, string> {
  return new Map(
    rawTags.split(';').map((tag) => {
      const separatorIndex = tag.indexOf('=');

      if (separatorIndex === -1) {
        return [tag, ''];
      }

      return [tag.slice(0, separatorIndex), tag.slice(separatorIndex + 1)];
    }),
  );
}

function isBroadcaster(
  tags: Map<string, string>,
  login: string,
  channel: string,
): boolean {
  const badges = tags.get('badges')?.split(',') ?? [];
  return (
    login.toLowerCase() === channel ||
    badges.some((badge) => badge === 'broadcaster/1')
  );
}

function parsePrivMsg(
  rawMessage: string,
  channel: string,
): { checkIn?: TwitchCheckInCommand; resetViewerName?: string } | null {
  const match = rawMessage.match(/^@([^ ]+) :([^!]+)![^ ]+ PRIVMSG #[^ ]+ :(.+)$/);

  if (!match) {
    return null;
  }

  const [, rawTags, login, message] = match;
  const tags = parseTags(rawTags);
  const trimmedMessage = message.trim();
  const viewerName = tags.get('display-name')?.trim() || login;

  if (RESET_COMMANDS.has(trimmedMessage.toLowerCase())) {
    return isBroadcaster(tags, login, channel)
      ? { resetViewerName: viewerName }
      : null;
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

      const command = parsePrivMsg(message, normalizedChannel);

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
