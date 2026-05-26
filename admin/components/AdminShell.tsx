import Link from "next/link";
import { getAdminSession } from "@/lib/admin-auth";

const navGroups = [
  {
    title: "Review",
    links: [
      ["Skill Registry", "/skills"],
      ["Skill Releases", "/skills/releases"],
      ["Review Queue", "/reviews"],
      ["Crawler Review", "/crawler"],
      ["Prompt Fragments", "/prompt-fragments"],
      ["Meta Prompts", "/meta-prompts"]
    ]
  },
  {
    title: "Operations",
    links: [
      ["Provider Health", "/providers"],
      ["Queue / Dead-letter", "/queues"],
      ["Operations Gate", "/operations"],
      ["Export Jobs", "/exports"],
      ["Trace Detail", "/traces"],
      ["Feedback Queue", "/feedback"]
    ]
  },
  {
    title: "Trust",
    links: [
      ["Support Console", "/support"],
      ["Quota", "/quota"],
      ["Safety / Risky Export", "/safety"],
      ["Abuse", "/abuse"],
      ["Audit Log", "/audit"]
    ]
  }
];

export async function AdminShell({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();

  return (
    <div className="admin-frame">
      <aside className="sidebar" aria-label="Admin navigation">
        <Link className="brand" href="/">
          <strong>ZenArt Admin</strong>
          <span>Stage 0 Rev2 operations</span>
        </Link>

        <div className="dev-auth">
          <strong>Local/dev auth placeholder</strong>
          <span>
            Auth is intentionally isolated from the user app. Replace this with backend
            admin SSO, RBAC, secure cookies, and audit-bound session checks.
          </span>
        </div>

        {navGroups.map((group) => (
          <nav className="nav-group" key={group.title} aria-label={group.title}>
            <h2>{group.title}</h2>
            {group.links.map(([label, href]) => (
              <Link className="nav-link" href={href} key={href}>
                {label}
              </Link>
            ))}
          </nav>
        ))}
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>Admin Console</h1>
            <p>Fixture-backed screens aligned to the Stage 0 Rev2 admin contract.</p>
          </div>
          <div className="admin-role">
            <strong>{session.name}</strong>
            <span>
              {session.role} · {session.environment}
            </span>
          </div>
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
