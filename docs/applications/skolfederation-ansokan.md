# Skolfederation — medlemsansökan (utkast)

> Organisatoriskt steg som måste utföras av bolaget. Fyll i platshållarna
> [inom klamrar] och skicka enligt anvisningarna på skolfederation.se
> (Internetstiftelsen). Tekniska förberedelser i koden är klara — se
> docs/SSO.md.

## Uppgifter att ha till hands

Bolagsnamn och org.nr: [DeepGrader-bolaget AB, XXXXXX-XXXX]. Firmatecknare
för avtalet: [namn]. Teknisk kontakt: [namn, e-post] och administrativ
kontakt: [namn, e-post]. Tjänstens namn: DeepGrader. Entitetskategori:
tjänsteleverantör (SP). SP-metadata-URL:
`https://[projekt-ref].supabase.co/auth/v1/sso/saml/metadata`.
Attributbehov (minimering): `eduPersonPrincipalName`, visningsnamn
(`displayName`/`urn:oid:2.16.840.1.113730.3.1.241`) och e-post — inget mer.

## E-postutkast

**Till:** info@skolfederation.se
**Ämne:** Medlemsansökan tjänsteleverantör — DeepGrader

Hej,

Vi ansöker om medlemskap i Skolfederation som tjänsteleverantör.

DeepGrader är en AI-stödd tjänst för rättning av handskrivna matematikprov
med obligatorisk lärargranskning, byggd för svenska skolhuvudmän (Lgr22/Gy25).
Tjänsten är multitenant med radbaserad åtkomstkontroll per skola, all
persistent data lagras inom EU och personuppgiftsbiträdesavtal tecknas med
respektive huvudman.

Vi önskar ansluta vår SAML-SP till federationens metadata. Vår metadata finns
på [SP-metadata-URL]. Vi begär attributen eduPersonPrincipalName, visningsnamn
och e-postadress, i enlighet med dataminimeringsprincipen.

Bolagsuppgifter: [bolagsnamn], org.nr [XXXXXX-XXXX], [adress].
Teknisk kontakt: [namn, e-post, telefon].
Administrativ kontakt/firmatecknare: [namn, e-post].

Tacksamma för ansökningshandlingar och prisuppgift för medlemskap.

Med vänliga hälsningar,
[Namn, titel]

## Efter godkänt medlemskap

Publicera SP-metadata i federationens metadataregister, verifiera
attributsläpp mot en pilotkommuns IdP, registrera IdP:n i Supabase
(`supabase sso add`, docs/SSO.md) och sätt skolans SSO-domän i `/settings`.
