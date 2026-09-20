import { CREDIT_NAME } from '../lib/credit';

function TwitchIcon() {
  return (
    <svg className="twitch-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M4 3h16v11l-4 4h-4l-2 3H7v-3H4V3zm2 2v11h3v2l2-2h4l3-3V5H6zm4 3h2v4h-2V8zm5 0h2v4h-2V8z"
      />
    </svg>
  );
}

export function ScorebugCreditWatermark({ visible }: { visible: boolean }) {
  if (!visible) {
    return null;
  }

  return (
    <div className="scorebug-credit-watermark compact-credit" aria-hidden="true">
      <span className="compact-credit-by">by</span>
      <span className="compact-credit-brand">
        <TwitchIcon />
        <span>{CREDIT_NAME}</span>
      </span>
    </div>
  );
}
