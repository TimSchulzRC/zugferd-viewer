import type { Metadata } from "next";
import { Suspense } from "react";
import { SharePage } from "@/components/share-page";

export const metadata: Metadata = { title: "Geteilte Rechnungen", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <Suspense>
      <SharePage />
    </Suspense>
  );
}
