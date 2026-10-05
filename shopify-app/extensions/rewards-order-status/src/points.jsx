// Shared with ../../rewards-thank-you/src/points.jsx — keep the two copies in sync.
import {useEffect, useState} from 'preact/hooks';

const BASE = 'https://rewards.shopcarbon.com';

// Points for one order from Carbon Rewards. null while loading,
// {guest: true} when the shopper isn't signed in (no customer in the token).
export function useOrderPoints(orderId) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!orderId) return;
    if (shopify.extension.editor) {
      setState({status: 'pending', points: 88, balance: 202, preview: true});
      return;
    }
    (async () => {
      try {
        const token = await shopify.sessionToken.get();
        const res = await fetch(`${BASE}/api/account/order-points?order=${encodeURIComponent(orderId)}`, {
          headers: {Authorization: `Bearer ${token}`},
        });
        if (res.status === 401) return setState({guest: true});
        if (!res.ok) return setState({error: true});
        setState(await res.json());
      } catch {
        setState({error: true});
      }
    })();
  }, [orderId]);
  return state;
}

export function PointsEarned({data, signInHint}) {
  if (!data || data.error || data.status === 'cancelled') return null;
  if (data.guest) {
    return (
      <s-banner heading="Carbon Rewards">
        <s-paragraph>
          You earn 1 point for every $1 — every 100 points is $10 off. {signInHint}
        </s-paragraph>
      </s-banner>
    );
  }
  if (!data.points) return null;
  const after = data.status === 'earned' ? data.balance : (data.balance ?? 0) + data.points;
  return (
    <s-banner tone="success" heading={`You earned ${data.points} Carbon Rewards points`}>
      <s-paragraph>
        {after != null ? `Your balance${data.status === 'earned' ? '' : ' with this order'}: ${after} points. ` : ''}
        Every 100 points = $10 off your next purchase.
        {data.preview ? ' (Editor preview — sample numbers.)' : ''}
      </s-paragraph>
    </s-banner>
  );
}
