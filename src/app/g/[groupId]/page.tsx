"use client";

import { useParams } from "next/navigation";
import { NextMatch } from "../../../ui/next-match";

export default function NextMatchPage() {
  const { groupId } = useParams<{ groupId: string }>();
  return <NextMatch groupId={groupId} />;
}
