export type LegalPolicyKey = "terms" | "privacy" | "acceptable-use" | "ip-complaints" | "billing-policy";

export interface LegalPolicySection {
  title: string;
  body: string;
}

export interface LegalPolicy {
  key: LegalPolicyKey;
  title: string;
  route: string;
  summary: string;
  lastReviewed: string;
  contact: string;
  sections: LegalPolicySection[];
}

export const supportContactEmail = "support@zenari.ai";
export const legalContactEmail = "legal@zenari.ai";

export const legalPolicies: Record<LegalPolicyKey, LegalPolicy> = {
  terms: {
    key: "terms",
    title: "Terms of Service",
    route: "/legal/terms",
    summary: "User-facing Stage 0 terms for account access, workspace content, exports, support, and local alpha limits.",
    lastReviewed: "2026-05-26",
    contact: supportContactEmail,
    sections: [
      {
        title: "Access Mode",
        body: "zenari.ai Stage 1 is an authenticated local alpha and private beta surface. Access can be limited, suspended, or removed when quota, safety, abuse, billing, or support obligations require it."
      },
      {
        title: "Workspace Content",
        body: "You are responsible for prompts, references, project data, selected candidates, package contents, and exported assets you create or upload. Do not submit secrets, credentials, unrelated personal data, or content you do not have rights to use."
      },
      {
        title: "Local Alpha Generation",
        body: "Unless a real provider is explicitly configured and disclosed in the product, previews and exports use deterministic development generation evidence and must not be represented as production provider output. AI content responsibility stays with the user and every export should be reviewed before use."
      },
      {
        title: "Exports and Sharing",
        body: "Exports include manifest, QA, provenance, and applicable safety context. Review every export for rights, claims, likeness, brand usage, and quality before sharing or relying on it."
      },
      {
        title: "Support",
        body: "Support requests may attach project, export, task, trace, accepted reference, and quota context so the issue can be investigated. Use the visible support contact for account access, deletion assistance, billing questions, AI content review, and product incidents."
      }
    ]
  },
  privacy: {
    key: "privacy",
    title: "Privacy Policy",
    route: "/legal/privacy",
    summary: "How Stage 0 user routes present collection, use, retention, support context, telemetry, and deletion assistance.",
    lastReviewed: "2026-05-26",
    contact: supportContactEmail,
    sections: [
      {
        title: "Data We Process",
        body: "The user web app can process account identifiers, project metadata, prompts, references, generated candidates, canvas state, package history, export records, support tickets, local telemetry, and error reports."
      },
      {
        title: "Support Context",
        body: "When you report a problem, zenari.ai attaches the active project, latest export when available, task, trace, accepted reference identifiers, and quota snapshot. Ticket text should not include secrets or unrelated personal data."
      },
      {
        title: "Telemetry",
        body: "Client analytics capture user-interface funnel events such as route view, brief confirmation, candidate selection, package add, export request, billing view, account update, and support submission. Frontend error reporting records sanitized message, source, route, and session context."
      },
      {
        title: "Retention and Deletion",
        body: "Local alpha state is stored in local browser storage for repeatable testing. Private beta retention and data deletion requests are handled by support or admin-assisted deletion until self-serve deletion is available."
      },
      {
        title: "Contact",
        body: "Use the visible support contact for privacy requests, data deletion assistance, access issues, and data questions."
      }
    ]
  },
  "acceptable-use": {
    key: "acceptable-use",
    title: "Acceptable Use Policy",
    route: "/legal/acceptable-use",
    summary: "User-facing content and conduct rules for prompts, references, generated candidates, support, and exports.",
    lastReviewed: "2026-05-26",
    contact: supportContactEmail,
    sections: [
      {
        title: "Prohibited Inputs",
        body: "Do not submit content that is illegal, abusive, exploitative, harassing, privacy-invasive, malware-related, or intended to bypass safety, rate, quota, or access controls."
      },
      {
        title: "Protected Rights",
        body: "Do not request or upload protected characters, trademarks, trade dress, likenesses, copyrighted works, or brand assets unless you have the rights needed for the intended use."
      },
      {
        title: "Deceptive Claims",
        body: "Do not use zenari.ai to create misleading claims about product capabilities, legal rights, medical or financial outcomes, endorsements, identity, or origin of content."
      },
      {
        title: "Security",
        body: "Do not probe, overload, reverse engineer, scrape, or attempt unauthorized access to zenari.ai user, admin, API, object storage, provider, billing, support, or audit surfaces."
      },
      {
        title: "Enforcement",
        body: "Violations can result in blocked exports, support review, quota holds, account suspension, or abuse escalation through the visible support contact."
      }
    ]
  },
  "ip-complaints": {
    key: "ip-complaints",
    title: "IP Complaint Flow",
    route: "/legal/ip-complaints",
    summary: "How to report copyright, trademark, likeness, brand, or other intellectual property concerns.",
    lastReviewed: "2026-05-26",
    contact: legalContactEmail,
    sections: [
      {
        title: "What To Send",
        body: "Send the copyright work, trademark, likeness, or brand right at issue; the zenari.ai project or export identifier if known; your relationship to the rightsholder; and a concise explanation of the IP complaint."
      },
      {
        title: "Where To Send It",
        body: "Send IP complaints to legal@zenari.ai. If the issue also affects account access, billing, or an active incident, copy support@zenari.ai."
      },
      {
        title: "Review",
        body: "zenari.ai can disable sharing, block export use, start a takedown review, attach safety or QA findings, request more information, or escalate to admin review while a complaint is investigated."
      },
      {
        title: "Counter Context",
        body: "If you believe a complaint is mistaken, provide the relevant project or export identifier, ownership or license context, and a short explanation for review."
      }
    ]
  },
  "billing-policy": {
    key: "billing-policy",
    title: "Billing, Cancellation, and Refund Policy",
    route: "/legal/billing-policy",
    summary: "The visible policy required before paid launch claims, with local alpha mock checkout limitations.",
    lastReviewed: "2026-05-26",
    contact: supportContactEmail,
    sections: [
      {
        title: "Local Alpha",
        body: "The current user web app exposes mock checkout and quota scenarios for validation. It does not represent a paid production checkout unless a paid provider is explicitly enabled."
      },
      {
        title: "Subscription State",
        body: "Quota-consuming actions can be blocked when a subscription is inactive, past due (past_due), cancelled, or quota exhausted. Billing state changes should be visible on the Billing page before export actions proceed."
      },
      {
        title: "Cancellation",
        body: "When paid billing is enabled, users must have a visible cancellation path or support-assisted cancellation path before public launch."
      },
      {
        title: "Refunds and Credits",
        body: "Refunds, credits, and quota reset corrections are handled through support review until self-serve billing operations are available. Include the account email, project or export identifier, and reason for the request."
      },
      {
        title: "Receipts and Issues",
        body: "For billing questions, payment failures, quota mismatches, cancellation requests, or refund review, contact support@zenari.ai."
      }
    ]
  }
};

export const legalPolicyList = Object.values(legalPolicies);
