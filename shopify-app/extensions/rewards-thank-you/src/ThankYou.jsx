import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {PointsEarned, useOrderPoints} from './points.jsx';

export default async () => {
  render(<ThankYou />, document.body);
};

function ThankYou() {
  const orderId = shopify.orderConfirmation.value?.order?.id;
  const data = useOrderPoints(orderId);
  return (
    <PointsEarned
      data={data}
      signInHint="Sign in with the email you used for this order to see and use your points."
    />
  );
}
