import { Suspense } from "react";
import { Viewer } from "@/components/viewer";

export default function Page() {
  return (
    <Suspense>
      <Viewer />
    </Suspense>
  );
}
