import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {PointsEarned, useOrderPoints} from './points.jsx';

export default async () => {
  render(<OrderStatus />, document.body);
};

function OrderStatus() {
  const orderId = shopify.order.value?.id;
  const data = useOrderPoints(orderId);
  return <PointsEarned data={data} signInHint="" />;
}
