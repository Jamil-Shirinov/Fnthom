import type { EvidenceReference, FileSnapshot, FunctionProposal } from "../shared/schema";

/** Verifies model-supplied citations against the exact source snapshots used for planning. */
export function verifyProposalEvidence<T extends FunctionProposal>(proposal: T, files: FileSnapshot[]): T {
  const sources = new Map(files.filter((file) => file.exists).map((file) => [file.path, file.content]));
  return {
    ...proposal,
    ...(proposal.evidence
      ? {
          evidence: proposal.evidence.map((reference) => verifyReference(reference, sources)),
        }
      : {}),
  };
}

function verifyReference(reference: EvidenceReference, sources: Map<string, string>): EvidenceReference {
  const citation = { ...reference };
  delete citation.verified;
  delete citation.verificationNote;
  const content = sources.get(reference.path);
  let verificationNote: string | undefined;
  if (content === undefined) {
    verificationNote = "The cited source file was not included in the planning context.";
  } else {
    const lines = content.split(/\r?\n/);
    if (reference.endLine > lines.length) {
      verificationNote = "The cited line range is outside the current source file.";
    } else {
      const excerpt = lines.slice(reference.startLine - 1, reference.endLine).join("\n").trim();
      if (excerpt !== reference.quote.trim()) verificationNote = "The quoted text does not match the current source at these lines.";
    }
  }
  return {
    ...citation,
    verified: verificationNote === undefined,
    ...(verificationNote ? { verificationNote } : {}),
  };
}
