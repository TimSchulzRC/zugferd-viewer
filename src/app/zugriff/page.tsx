import { Suspense } from "react";
import { Consent } from "@/components/consent";

export default function Page() {
  return (
    <Suspense>
      <Consent />
    </Suspense>
  );
}
