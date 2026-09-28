# Skolon — partneransökan (utkast)

> Organisatoriskt steg som måste utföras av bolaget. Ansökan görs via
> skolon.com/partner. Tekniska förberedelser i koden är klara: SSO via SAML
> (docs/SSO.md) och roster via SS 12000 (lib/integrations/ss12000.ts).

## Uppgifter att ha till hands

Bolagsuppgifter: [bolagsnamn, org.nr, adress, webbplats]. Kontaktperson för
partnerskap: [namn, e-post, telefon]. Tjänstebeskrivning (kort): "AI-stödd
rättning av handskrivna matematikprov med lärargranskning — kursplanenativ
bedömning (Lgr22/Gy25), formativa elevrapporter och klassanalys." Målgrupp:
matematiklärare i grundskola och gymnasium. Prismodell: [per lärare/skola/
kommun, belopp]. Dataskydd: PUB-avtal enligt mall (docs/DPA-TEMPLATE.md),
EU-datalagring, RLS per skola, åtkomstlogg.

## App-manifest till Skolon Library

Namn: DeepGrader. Ikon: [512×512 PNG]. Start-URL:
`https://[app-domän]/login`. Skärmdumpar: [översikt, granskningsvy,
elevrapport, klassanalys]. Beskrivning (SV): se tjänstebeskrivningen ovan,
utökad med: "Läraren granskar och godkänner varje bedömning — ingen poäng
blir slutgiltig utan lärarbeslut. Varje rättning förbättrar systemet via
lärarens korrigeringar."

## E-postutkast

**Till:** partner@skolon.com
**Ämne:** Partneransökan — DeepGrader (AI-rättning av matematikprov)

Hej,

Vi vill ansluta DeepGrader till Skolon Library och ansöker härmed om
partnerskap.

DeepGrader rättar handskrivna matematikprov med AI och obligatorisk
lärargranskning, kopplat till Lgr22/Gy25. Tjänsten stödjer SSO via SAML och
elevlisteprovisionering enligt SS 12000, så anslutning till Skolons plattform
kan ske utan specialanpassningar.

Bolagsuppgifter: [bolagsnamn], org.nr [XXXXXX-XXXX].
Kontakt: [namn, e-post, telefon].

Vi tar gärna ett möte för att gå igenom teknisk anslutning och avtalsvillkor.

Med vänliga hälsningar,
[Namn, titel]
