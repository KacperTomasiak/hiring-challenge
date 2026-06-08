# Contact Finder Plan

## Architecture

My bias for the first version is **precision over coverage**. A blank or human-review result is acceptable. A confident-looking wrong contact is not, because payment outreach to the wrong person can expose sensitive business context and damage trust.

I would build this as an evidence-first pipeline:

1. **Load and normalize the input**
   - Read `company_name` and `mailing_address`.
   - Preserve the raw row, then normalize names, legal suffixes, punctuation, address parts, domains, emails, and phone numbers for matching.
   - Assign a stable row id so every output can be traced back to the input.

2. **Resolve the company before the person**
   - First answer: "Is this source result the same business at the same location?"
   - Common names, franchises, shared addresses, relocated businesses, and closed businesses should be treated as high-risk.
   - If the business cannot be resolved, any contact found for it is capped and sent to review.

3. **Collect evidence, not answers**
   - Each provider returns observations: company match, person name, role, email/phone, generic contact, negative result, or provider error.
   - A timeout or rate limit is not `not_found`.
   - Raw provider output should be converted into a small internal evidence model so the scoring logic is testable and explainable.

4. **Build contact candidates**
   - Merge observations that clearly point to the same person or contact method.
   - Keep conflicting candidates separate rather than forcing a winner.
   - Treat verified generic contacts, such as a billing inbox or main office phone, as legitimate candidates. For SMB collections, a safe business channel may beat a weakly matched individual.

5. **Score and decide**
   - Return one recommended result per input row.
   - Mark `needs_human_review=true` when the score is below threshold, evidence conflicts, company identity is unresolved, the contact is inferred, or a relevant provider failed.
   - Keep enough provenance to explain why the row was returned or reviewed.

For Stage B, I would keep the slice deliberately small: CSV loader, mocked provider adapter, normalization, candidate grouping, confidence scoring, and a command that writes the required output. No real scraping, no UI, no queue, no database unless the mock shape makes it necessary.

## Sources & Strategy

I would query sources in an order that protects against false positives:

1. **Client-owned history**
   - Prior invoices, emails, payment attempts, signed documents, support tickets, or CRM notes may already identify the best billing contact.
   - Risk: stale data, former employees, or contacts collected for a different purpose.

2. **Company identity sources**
   - Business listings, maps-style records, official registries, and first-party websites help confirm the company, address, phone, domain, and operating status.
   - Risk: stale listings, registered agents who are not payment contacts, chain/franchise ambiguity, or websites covering several locations.

3. **Contact sources**
   - First-party website contact pages, public staff pages, business directories, and approved enrichment providers can supply names, roles, and business contact methods.
   - Risk: stale employment, same-name collisions, generic inboxes, and syndicated data that looks corroborated but is just copied.

4. **Inference**
   - Email pattern inference is only a weak supporting signal.
   - I would not present a guessed direct email as verified unless the person, company domain, pattern, and validation method are all supported and allowed.

The search order per company is:

1. Verify the business/location.
2. Find contacts tied to that verified business.
3. Prefer payment-relevant roles: AP, billing, finance, controller/CFO, office manager, owner/operator.
4. Prefer verified business channels over speculative named contacts.
5. Return `needs_human_review=true` or no verified contact when the evidence is not strong enough.

## Quality

### Dedupe

- Company dedupe: normalized company name plus address, domain, or phone agreement.
- Contact dedupe: exact email/phone first; then person name plus company/domain agreement.
- Keep candidates separate when they point to different locations, different people, or conflicting roles.
- Do not count copied directory records as independent corroboration.

### Confidence scoring

I would use a transparent 0-100 score:

```text
company_match      0-30
role_fit           0-25
contact_quality    0-20
source_quality     0-15
corroboration      0-10
```

Role scoring should reflect the business problem, not generic seniority. AP/billing/finance should beat a CEO if the CFO/owner is less reachable and the AP contact is verified. For small businesses, owner/operator and office manager are still strong because they often handle payment directly.

Hard caps:

- Company not resolved: max 40.
- Contact not tied to the resolved business: max 50.
- Inferred contact method: max 65.
- Single weak third-party source: max 70.
- Conflicting evidence: human review regardless of score.

### Provenance

Every returned field should be traceable:

- where the name came from,
- where the role came from,
- where the email or phone came from,
- which sources agreed or conflicted,
- why the score was capped,
- why human review is needed.

Even if the final artifact is a flat CSV, I would keep internal evidence records so a reviewer can audit the decision without rerunning the search.

### Cannot-verify states

I would distinguish these internally:

- `verified_contact`
- `verified_generic_business_contact`
- `low_confidence`
- `conflict`
- `not_found`
- `provider_error`
- `do_not_contact`

For the challenge output, anything other than a verified result should set `needs_human_review=true`.

### False-positive controls

I would not:

- invent names,
- present guessed emails as verified,
- let a strong title compensate for a weak company match,
- use personal phone numbers, home addresses, private social profiles, or family data,
- over-count syndicated data as multiple sources,
- auto-contact conflicted or low-confidence results.

## Privacy / Compliance

I would keep this limited to business-purpose outreach:

- use only client-approved and business-relevant sources,
- collect the minimum needed contact data,
- prefer business contact channels over personal ones,
- respect opt-outs, suppression lists, do-not-call rules, source terms, and privacy requirements,
- keep provenance and deletion paths,
- apply human review where the contact is plausible but not clearly appropriate.

I would not scrape prohibited or login-gated sources, bypass rate limits, enrich with sensitive personal data, or optimize for a full-looking spreadsheet at the expense of trust.

## Clarifying Questions

1. **Who counts as the right contact for this motion?**
   - Why it matters: AP, owner, office manager, and CFO are different targets. The ranking should match the actual collections workflow.
   - Default assumption: prefer AP/billing/finance first, then controller/CFO, office manager, owner/operator, then a verified generic billing channel.
   - What changes: role weights, tie-breaks, and whether a generic billing inbox can beat a named owner.

2. **Which sources and validation methods are allowed?**
   - Why it matters: the design should not depend on data the company cannot legally or contractually use.
   - Default assumption: use client-owned records, official/business listings, first-party company websites, and approved mock/enrichment providers only.
   - What changes: provider adapters, confidence caps, rate limits, retention rules, and whether inferred contacts can ever be used.

3. **What confidence threshold is acceptable for automated use?**
   - Why it matters: payment outreach has privacy and reputation risk, so the threshold should optimize for precision, not vanity coverage.
   - Default assumption: require 75/100, with mandatory review for conflicts, unresolved company identity, inferred contact methods, or provider errors.
   - What changes: review volume, output behavior, and the precision/coverage tradeoff.

4. **Are verified generic business contacts acceptable?**
   - Why it matters: `billing@company.com` or the main office phone may be safer and more effective than a weakly verified named person.
   - Default assumption: yes, if clearly marked as generic and tied to the resolved business.
   - What changes: fallback order, scoring, and human-review behavior for non-person contacts.
