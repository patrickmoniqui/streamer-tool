import { CREDIT_NAME } from '../lib/credit';
import { TwitchIcon } from './TwitchIcon';

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
