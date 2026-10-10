import Link from "next/link";
import { TeamAssignment } from "./team-assignment";

export default function TeamsPrototype() {
  return (
    <main className="page">
      <Link href="/" className="muted">
        ← Back
      </Link>
      <h1 className="title">Team assignment</h1>
      <p className="muted">Admin view with sample data. Tap a player, then a player on the other team to swap.</p>
      <TeamAssignment />
    </main>
  );
}
