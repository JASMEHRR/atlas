import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getInspiration, overriddenFields } from "@/lib/repo";
import { similar } from "@/lib/search";
import { Detail } from "@/components/detail";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const i = getInspiration(slug);
  return {
    title: i ? `${i.analysis.identity.name} — Atlas` : "Not found — Atlas",
    description: i?.analysis.identity.whyItWorks,
  };
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const inspiration = getInspiration(slug);
  if (!inspiration) notFound();

  return (
    // useSearchParams in Detail needs a Suspense boundary during prerender.
    <Suspense fallback={null}>
      <Detail
        initial={{
          inspiration,
          similar: similar(slug),
          overridden: overriddenFields(slug),
        }}
      />
    </Suspense>
  );
}
