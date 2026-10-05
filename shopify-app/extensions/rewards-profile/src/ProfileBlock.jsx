import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';
import {getSummary, redeemableDollars} from './api.js';

export default async () => {
  render(<ProfileBlock />, document.body);
};

// Compact balance card on the Profile page, linking to the full Rewards page.
function ProfileBlock() {
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    getSummary().then(setSummary).catch(() => setSummary(null));
  }, []);

  if (!summary) return null;
  const dollars = redeemableDollars(summary);
  const thankYou = summary.thank_you_codes?.[0];

  return (
    <s-section heading="Carbon Rewards">
      <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
        <s-stack gap="none">
          <s-heading>{summary.balance.toLocaleString()} points</s-heading>
          <s-text color="subdued">
            {dollars ? `Worth $${dollars} off your next purchase` : 'Earn 1 point for every $1'}
          </s-text>
          {thankYou && (
            <s-text tone="success">You have a {thankYou.percent_off}% off code waiting in Rewards</s-text>
          )}
        </s-stack>
        <s-button href="extension:rewards-account/" variant="primary">
          {dollars ? 'Redeem' : thankYou ? 'View code' : 'View rewards'}
        </s-button>
      </s-grid>
    </s-section>
  );
}
