import { Suspense } from "react";
import CheckoutPage from "./checkout-client";

export default function Page() {
  return (
    <Suspense fallback={<div>Loading checkout...</div>}>
      <CheckoutPage />
    </Suspense>
  );
}
