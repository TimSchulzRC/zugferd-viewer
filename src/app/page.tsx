import { Suspense } from "react";
import { App } from "@/components/app";

export default function Page() {
  return (
    <Suspense>
      <App />
    </Suspense>
  );
}
