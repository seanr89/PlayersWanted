"use client";

import { useParams } from "next/navigation";
import { TeamAssignment } from "../../../../../../ui/team-assignment";

export default function TeamAssignmentPage() {
  const { groupId, matchId } = useParams<{ groupId: string; matchId: string }>();
  return <TeamAssignment groupId={groupId} matchId={matchId} />;
}
