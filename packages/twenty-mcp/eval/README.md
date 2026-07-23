# Evaluation fixture

`evaluation.xml` contains ten independent, read-only MCP questions with exact
string answers.

The answer key targets the deterministic records created by:

- `prefill-companies.util.ts`
- `prefill-people.util.ts`
- `prefill-opportunities.util.ts`

These are the five standard companies, their five founders, and six standard
opportunities installed in a fresh workspace. Run the suite against a workspace
that contains those records. Additional records do not affect questions that
name the standard records explicitly, but editing the named records will.

Each question can be answered with read-only tools. A typical path begins with
`twenty_list_objects` or `twenty_describe_object`, then uses one or more
specialized find/get tools with relation depth. No evaluation question should
invoke a mutation, confirmation parameter, or outbound action.

The answers were cross-checked against the source fixture:

| Standard opportunity | Amount | Stage | Company | Contact | Close date |
|---|---:|---|---|---|---|
| Platform Migration | 60000 USD | PROPOSAL | Stripe | Patrick Collison | 2026-01-31 |
| AI Model Training | 100000 USD | CUSTOMER | Anthropic | Dario Amodei | 2026-02-15 |
| Workspace Expansion | 45000 USD | MEETING | Notion | Ivan Zhao | 2026-01-20 |
| API Integration Deal | 75000 USD | SCREENING | Stripe | Patrick Collison | 2026-01-25 |
| Enterprise Plan Upgrade | 50000 USD | NEW | Airbnb | Brian Chesky | 2026-03-10 |
| Design Partnership | 30000 USD | NEW | Figma | Dylan Field | 2026-01-15 |
