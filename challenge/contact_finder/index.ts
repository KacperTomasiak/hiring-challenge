import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const CONFIDENCE_THRESHOLD = 70;

export type ProviderName = "registry" | "listing" | "enrichment";

export interface InputCompany {
  rowId: number;
  companyName: string;
  mailingAddress: string;
}

export interface MockProviderRecord {
  name?: string | null;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  provider_confidence?: number | null;
  source_url?: string | null;
}

export type MockResponses = Record<string, Partial<Record<ProviderName, MockProviderRecord>>>;

export interface Evidence {
  provider: ProviderName;
  sourceUrl: string;
  name: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  providerConfidence: number | null;
}

export interface ContactResult {
  companyName: string;
  mailingAddress: string;
  contactName: string;
  contactRole: string;
  contactEmailOrPhone: string;
  confidenceScore: number;
  source: string;
  needsHumanReview: boolean;
  status:
  | "verified_contact"
  | "verified_generic_business_contact"
  | "low_confidence"
  | "conflict"
  | "not_found";
  scoreBreakdown: ScoreBreakdown;
  capsApplied: string[];
  provenance: Evidence[];
}

export interface ScoreBreakdown {
  companyMatch: number;
  roleFit: number;
  contactQuality: number;
  sourceQuality: number;
  corroboration: number;
}

interface CliOptions {
  input: string;
  mocks: string;
  output: string;
  provenance: string;
  threshold: number;
}

const OUTPUT_HEADERS = [
  "company_name",
  "mailing_address",
  "contact_name",
  "contact_role",
  "contact_email_or_phone",
  "confidence_score",
  "source",
  "needs_human_review",
] as const;

const ROLE_PRIORITY: Array<[token: string, score: number]> = [
  ["accounts payable", 25],
  ["ap manager", 25],
  ["ap", 25],
  ["billing", 25],
  ["owner", 22],
  ["founder", 22],
  ["president", 21],
  ["cfo", 18],
  ["finance", 18],
  ["controller", 18],
  ["office manager", 14],
  ["manager", 12],
  ["registered agent", 4],
];

const NICKNAMES: Record<string, string> = {
  bob: "robert",
  rob: "robert",
  bobby: "robert",
  bill: "william",
  will: "william",
  liz: "elizabeth",
  beth: "elizabeth",
  mike: "michael",
  dan: "daniel",
  danny: "daniel",
  tom: "thomas",
  jim: "james",
  jimmy: "james",
  jeff: "jeffrey",
};

export function loadCompanies(path: string): InputCompany[] {
  const content = readFileSync(path, "utf8");
  const lines = content.trim().split(/\r?\n/);
  const rows = lines.slice(1);

  return rows.map((line: string, index: number) => {
    const [companyName, mailingAddress] = parseCsvLine(line);
    return {
      rowId: index + 1,
      companyName,
      mailingAddress,
    };
  });
}

export function loadMockResponses(path: string): MockResponses {
  return JSON.parse(readFileSync(path, "utf8")) as MockResponses;
}

export function enrichCompanies(
  companies: InputCompany[],
  responses: MockResponses,
  threshold = CONFIDENCE_THRESHOLD,
): ContactResult[] {
  return companies.map((company) => scoreCompany(company, responses[company.companyName] ?? {}, threshold));
}

export function scoreCompany(
  company: InputCompany,
  providerPayload: Partial<Record<ProviderName, MockProviderRecord>>,
  threshold = CONFIDENCE_THRESHOLD,
): ContactResult {
  const evidence = extractEvidence(providerPayload);

  if (evidence.length === 0) {
    return {
      companyName: company.companyName,
      mailingAddress: company.mailingAddress,
      contactName: "",
      contactRole: "",
      contactEmailOrPhone: "",
      confidenceScore: 0,
      source: "",
      needsHumanReview: true,
      status: "not_found",
      scoreBreakdown: emptyScore(),
      capsApplied: [],
      provenance: [],
    };
  }

  const names = evidence.flatMap((item) => (item.name ? [item.name] : []));
  const roles = evidence.flatMap((item) => (item.role ? [item.role] : []));
  const emails = evidence.flatMap((item) => (item.email ? [item.email] : []));
  const phones = evidence.flatMap((item) => (item.phone ? [item.phone] : []));
  const providers = new Set(evidence.map((item) => item.provider));
  const sourceUrls = [...new Set(evidence.map((item) => item.sourceUrl).filter(Boolean))].sort();

  const conflict = hasNameConflict(names);
  const selectedName = chooseName(names);
  const selectedRole = chooseRole(roles, emails);
  const selectedContact = chooseContact(emails, phones);

  const scoreBreakdown: ScoreBreakdown = {
    companyMatch: companyMatchScore(providers, selectedContact),
    roleFit: roleFitScore(selectedRole, emails),
    contactQuality: contactQualityScore(selectedContact, phones),
    sourceQuality: sourceQualityScore(evidence),
    corroboration: corroborationScore(evidence, names, phones),
  };

  const rawScore = Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0);
  const { finalScore, capsApplied } = applyCaps({
    rawScore,
    evidence,
    selectedName,
    selectedContact,
    conflict,
  });

  const needsHumanReview = finalScore < threshold || conflict || !selectedContact;
  const emittedContact = finalScore >= threshold && !conflict ? selectedContact : "";
  const showReviewCandidate = !conflict && !emittedContact && Boolean(selectedName) && finalScore >= 55;
  const emittedName = emittedContact || showReviewCandidate ? selectedName : "";
  const emittedRole = emittedContact || showReviewCandidate ? selectedRole : "";

  let status: ContactResult["status"] = "low_confidence";
  if (!selectedContact) {
    status = finalScore > 0 ? "low_confidence" : "not_found";
  } else if (conflict) {
    status = "conflict";
  } else if (!needsHumanReview) {
    status = isGenericContact(selectedContact) && !selectedName
      ? "verified_generic_business_contact"
      : "verified_contact";
  }

  return {
    companyName: company.companyName,
    mailingAddress: company.mailingAddress,
    contactName: emittedName,
    contactRole: emittedRole,
    contactEmailOrPhone: emittedContact,
    confidenceScore: finalScore,
    source: sourceUrls.join(";"),
    needsHumanReview,
    status,
    scoreBreakdown,
    capsApplied,
    provenance: evidence,
  };
}

function emptyScore(): ScoreBreakdown {
  return {
    companyMatch: 0,
    roleFit: 0,
    contactQuality: 0,
    sourceQuality: 0,
    corroboration: 0,
  };
}

function extractEvidence(
  providerPayload: Partial<Record<ProviderName, MockProviderRecord>>,
): Evidence[] {
  const providers: ProviderName[] = ["registry", "listing", "enrichment"];
  return providers.flatMap((provider) => {
    const payload = providerPayload[provider];
    if (!payload) {
      return [];
    }

    return [
      {
        provider,
        sourceUrl: cleanOptional(payload.source_url) ?? "",
        name: cleanOptional(payload.name),
        role: cleanOptional(payload.role),
        email: cleanOptional(payload.email),
        phone: cleanOptional(payload.phone),
        providerConfidence:
          typeof payload.provider_confidence === "number" ? payload.provider_confidence : null,
      },
    ];
  });
}

function cleanOptional(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function parseCsvLine(line: string): [string, string] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return [values[0] ?? "", values[1] ?? ""];
}

function chooseName(names: string[]): string {
  if (names.length === 0) {
    return "";
  }

  return [...names].sort((left, right) => {
    const specificityDelta = nameSpecificity(right) - nameSpecificity(left);
    if (specificityDelta !== 0) {
      return specificityDelta;
    }
    return right.length - left.length;
  })[0];
}

function chooseRole(roles: string[], emails: string[]): string {
  if (roles.length > 0) {
    return [...roles].sort((left, right) => roleFitScore(right, emails) - roleFitScore(left, emails))[0];
  }

  return emails.some((email) => isRoleInbox(email)) ? "Billing" : "";
}

function chooseContact(emails: string[], phones: string[]): string {
  if (emails.length > 0) {
    return [...emails].sort((left, right) => emailQualityScore(right) - emailQualityScore(left))[0];
  }
  return phones[0] ?? "";
}

function companyMatchScore(providers: Set<ProviderName>, selectedContact: string): number {
  if (providers.has("registry") && providers.has("listing")) {
    return 30;
  }
  if (providers.has("registry") && providers.has("enrichment")) {
    return 27;
  }
  if (providers.has("listing") && providers.has("enrichment")) {
    return 24;
  }
  if (providers.has("listing")) {
    return 18;
  }
  if (providers.has("registry")) {
    return 16;
  }
  if (providers.has("enrichment") && selectedContact) {
    return 10;
  }
  return 0;
}

function roleFitScore(role: string, emails: string[]): number {
  const normalizedRole = role.toLowerCase();
  for (const [token, score] of ROLE_PRIORITY) {
    if (normalizedRole.includes(token)) {
      return score;
    }
  }

  if (emails.some((email) => isRoleInbox(email))) {
    return 25;
  }

  return role ? 8 : 0;
}

function contactQualityScore(selectedContact: string, phones: string[]): number {
  if (!selectedContact) {
    return 0;
  }
  if (selectedContact.includes("@")) {
    return emailQualityScore(selectedContact);
  }
  if (phones.includes(selectedContact)) {
    return 12;
  }
  return 5;
}

function emailQualityScore(email: string): number {
  const localPart = email.split("@", 1)[0].toLowerCase();
  if (["billing", "ap", "accountspayable", "accounts.payable"].includes(localPart)) {
    return 18;
  }
  if (["info", "contact", "sales", "office"].includes(localPart)) {
    return 10;
  }
  if (localPart.includes(".") || localPart.includes("_") || /^[a-z]/.test(localPart)) {
    return 20;
  }
  return 14;
}

function sourceQualityScore(evidence: Evidence[]): number {
  let score = 0;
  const providers = new Set(evidence.map((item) => item.provider));

  if (providers.has("registry")) {
    score += 6;
  }
  if (providers.has("listing")) {
    score += 5;
  }
  if (providers.has("enrichment")) {
    const enrichmentConfidence = Math.max(
      0,
      ...evidence
        .filter((item) => item.provider === "enrichment")
        .map((item) => item.providerConfidence ?? 0),
    );
    if (enrichmentConfidence >= 80) {
      score += 4;
    } else if (enrichmentConfidence >= 70) {
      score += 3;
    } else if (enrichmentConfidence >= 55) {
      score += 2;
    } else {
      score += 1;
    }
  }

  return Math.min(score, 15);
}

function corroborationScore(evidence: Evidence[], names: string[], phones: string[]): number {
  const providerCount = new Set(evidence.map((item) => item.provider)).size;
  let score = 0;

  if (providerCount >= 3) {
    score += 4;
  } else if (providerCount === 2) {
    score += 2;
  }

  if (names.length >= 2 && !hasNameConflict(names)) {
    score += 3;
  }

  if (phones.length > 0 && new Set(phones.map(normalizePhone)).size < phones.length) {
    score += 2;
  }

  if (evidence.some((item) => item.email) && providerCount >= 2) {
    score += 1;
  }

  return Math.min(score, 10);
}

function applyCaps(input: {
  rawScore: number;
  evidence: Evidence[];
  selectedName: string;
  selectedContact: string;
  conflict: boolean;
}): { finalScore: number; capsApplied: string[] } {
  let finalScore = input.rawScore;
  const capsApplied: string[] = [];
  const providers = new Set(input.evidence.map((item) => item.provider));

  if (providers.size === 1 && providers.has("enrichment")) {
    finalScore = Math.min(finalScore, 65);
    capsApplied.push("single_enrichment_source");
  }

  if (
    input.selectedContact &&
    isGenericContact(input.selectedContact) &&
    !input.selectedName &&
    providers.size === 1 &&
    providers.has("enrichment")
  ) {
    finalScore = Math.min(finalScore, 55);
    capsApplied.push("generic_contact_single_source");
  }

  if (input.selectedName && !input.selectedContact) {
    finalScore = Math.min(finalScore, 58);
    capsApplied.push("no_contact_method");
  }

  if (!input.selectedName && !isRoleInbox(input.selectedContact)) {
    finalScore = Math.min(finalScore, 68);
    capsApplied.push("no_named_contact");
  }

  if (input.conflict) {
    finalScore = Math.min(finalScore, 60);
    capsApplied.push("conflicting_names");
  }

  const enrichmentConfidence = Math.max(
    -1,
    ...input.evidence
      .filter((item) => item.provider === "enrichment")
      .map((item) => item.providerConfidence ?? -1),
  );

  if (enrichmentConfidence >= 0 && enrichmentConfidence < 70) {
    finalScore = Math.min(finalScore, Math.max(45, enrichmentConfidence + 8));
    capsApplied.push("low_provider_confidence");
  }

  return {
    finalScore: Math.max(0, Math.min(finalScore, 100)),
    capsApplied,
  };
}

export function hasNameConflict(names: string[]): boolean {
  const comparable = names.filter((name) => nameSpecificity(name) >= 2);
  for (let index = 0; index < comparable.length; index += 1) {
    for (let offset = index + 1; offset < comparable.length; offset += 1) {
      if (!namesMatch(comparable[index], comparable[offset])) {
        return true;
      }
    }
  }
  return false;
}

export function namesMatch(left: string, right: string): boolean {
  const leftTokens = normalizePersonTokens(left);
  const rightTokens = normalizePersonTokens(right);

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return false;
  }
  if (leftTokens.join(" ") === rightTokens.join(" ")) {
    return true;
  }

  const leftFirst = leftTokens[0];
  const rightFirst = rightTokens[0];
  const leftLast = leftTokens[leftTokens.length - 1];
  const rightLast = rightTokens[rightTokens.length - 1];

  if (leftLast !== rightLast) {
    return false;
  }
  if (leftFirst === rightFirst) {
    return true;
  }
  if (leftFirst.length === 1 && rightFirst.startsWith(leftFirst)) {
    return true;
  }
  if (rightFirst.length === 1 && leftFirst.startsWith(rightFirst)) {
    return true;
  }

  return (NICKNAMES[leftFirst] ?? leftFirst) === (NICKNAMES[rightFirst] ?? rightFirst);
}

function normalizePersonTokens(name: string): string[] {
  const normalized = normalizeName(stripParenthetical(name));
  const tokens = normalized.split(" ").filter((token) => token && !["dr", "mr", "mrs", "ms"].includes(token));
  if (tokens.length === 0) {
    return [];
  }
  tokens[0] = NICKNAMES[tokens[0]] ?? tokens[0];
  return tokens;
}

function nameSpecificity(name: string): number {
  return normalizeName(stripParenthetical(name))
    .split(" ")
    .filter((token) => token.length > 1).length;
}

function stripParenthetical(value: string): string {
  return value.replace(/\([^)]*\)/g, "").trim();
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizePhone(value: string): string {
  return value.replace(/\D+/g, "");
}

function isRoleInbox(value: string): boolean {
  if (!value || !value.includes("@")) {
    return false;
  }
  const localPart = value.split("@", 1)[0].toLowerCase();
  return ["billing", "ap", "accountspayable", "accounts.payable"].includes(localPart);
}

function isGenericContact(value: string): boolean {
  if (!value) {
    return false;
  }
  if (!value.includes("@")) {
    return true;
  }
  const localPart = value.split("@", 1)[0].toLowerCase();
  return ["billing", "ap", "accountspayable", "accounts.payable", "info", "contact", "sales", "office"].includes(localPart);
}

export function writeCsv(results: ContactResult[], path: string): void {
  ensureParentDir(path);
  const rows = [
    OUTPUT_HEADERS.join(","),
    ...results.map((result) =>
      [
        csvEscape(result.companyName),
        csvEscape(result.mailingAddress),
        csvEscape(result.contactName),
        csvEscape(result.contactRole),
        csvEscape(result.contactEmailOrPhone),
        String(result.confidenceScore),
        csvEscape(result.source),
        result.needsHumanReview ? "true" : "false",
      ].join(","),
    ),
  ];
  writeFileSync(path, `${rows.join("\n")}\n`, "utf8");
}

export function writeProvenance(results: ContactResult[], path: string): void {
  ensureParentDir(path);
  const lines = results.map((result) =>
    JSON.stringify({
      company_name: result.companyName,
      mailing_address: result.mailingAddress,
      status: result.status,
      confidence_score: result.confidenceScore,
      needs_human_review: result.needsHumanReview,
      score_breakdown: result.scoreBreakdown,
      caps_applied: result.capsApplied,
      provenance: result.provenance.map((item) => ({
        provider: item.provider,
        source_url: item.sourceUrl,
        name: item.name,
        role: item.role,
        email: item.email,
        phone: item.phone,
        provider_confidence: item.providerConfidence,
      })),
    }),
  );
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

function ensureParentDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

function parseArgs(argv: string[]): CliOptions {
  const defaults: CliOptions = {
    input: "challenge/data/companies.csv",
    mocks: "challenge/mocks/enrichment_responses.json",
    output: "challenge/output/contacts.csv",
    provenance: "challenge/output/provenance.jsonl",
    threshold: CONFIDENCE_THRESHOLD,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];

    if (!flag.startsWith("--")) {
      continue;
    }
    if (value === undefined) {
      throw new Error(`Missing value for ${flag}`);
    }

    switch (flag) {
      case "--input":
        defaults.input = value;
        break;
      case "--mocks":
        defaults.mocks = value;
        break;
      case "--output":
        defaults.output = value;
        break;
      case "--provenance":
        defaults.provenance = value;
        break;
      case "--threshold":
        defaults.threshold = Number.parseInt(value, 10);
        break;
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }
    index += 1;
  }

  return defaults;
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const options = parseArgs(argv);
  const companies = loadCompanies(resolve(options.input));
  const responses = loadMockResponses(resolve(options.mocks));
  const results = enrichCompanies(companies, responses, options.threshold);

  writeCsv(results, resolve(options.output));
  writeProvenance(results, resolve(options.provenance));

  const reviewed = results.filter((result) => result.needsHumanReview).length;
  const verified = results.length - reviewed;
  console.log(`Wrote ${results.length} rows to ${options.output}`);
  console.log(`Verified: ${verified}; needs_human_review: ${reviewed}; threshold: ${options.threshold}`);
  console.log(`Provenance: ${options.provenance}`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}
