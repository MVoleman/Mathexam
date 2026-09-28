# SSO: Skolfederation (SAML) + Skolon

What's in code today: an SSO entry point on the login page
(`signInWithSso` → Supabase `auth.signInWithSSO({ domain })`), per-school
`sso_domain` auto-join (SSO users whose email domain matches a school join it
as teachers, no manual onboarding), and admin settings at `/settings`. What
remains is registration work with each party, documented below.

## 1. Supabase SAML SSO (technical prerequisite)

SAML SSO requires Supabase Pro or higher. Enable it per identity provider:

```
supabase sso add --project-ref <ref> \
  --type saml \
  --metadata-url <IdP metadata URL> \
  --domains kommunen.se,edu.kommunen.se
```

DeepGrader's SP metadata lives at
`https://<ref>.supabase.co/auth/v1/sso/saml/metadata` — this is what you hand
to the IdP/federation. Attribute mapping: map the IdP's name attribute to
`user_metadata.full_name` so auto-join gets real names:

```json
{ "keys": { "full_name": { "names": ["urn:oid:2.16.840.1.113730.3.1.241"] } } }
```

## 2. Skolfederation (Internetstiftelsen)

Skolfederation is the Swedish school SAML federation; municipalities publish
their IdPs there. Checklist: (1) apply for membership as a service provider
at skolfederation.se (agreement + annual fee); (2) produce SP metadata (from
step 1), have it validated and published in the federation's metadata
aggregate; (3) for each customer municipality, register their IdP metadata
with `supabase sso add` and set the school's `sso_domain` in `/settings`;
(4) verify the entity category/attribute release — request
`eduPersonPrincipalName`, name and email (minimal set). Once live, teachers
log in from the login page's SSO field with their municipal account.

## 3. Skolon

Skolon is an app platform + SSO used by many Swedish schools. Checklist:
(1) register as a Skolon partner (skolon.com/partner) and sign their partner
agreement; (2) implement Skolon SSO — they support SAML2 (register DeepGrader
like any IdP via `supabase sso add`) or OAuth2/OIDC; (3) publish the app in
Skolon Library with the app manifest (name, icon, launch URL, screenshots);
(4) roster provisioning comes via Skolon's SS 12000-aligned API — already
supported: set `SS12000_BASE_URL`/`SS12000_TOKEN` (see
`lib/integrations/ss12000.ts` and docs/INTEGRATIONS.md).

## Operational notes

Auto-join gives the `teacher` role — admins promote colleagues in the
database for now. A domain can belong to exactly one school (unique index);
for multi-school huvudmän, use subdomain conventions
(`skola1.kommunen.se`) or leave `sso_domain` unset and onboard manually.
SSO users who arrive before their school has set `sso_domain` land on
/onboarding and can create/join manually — set the domain first to avoid
duplicate schools.
