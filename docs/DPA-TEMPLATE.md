# Personuppgiftsbiträdesavtal (PUB-avtal) — mall

> Mall för avtal mellan skolhuvudman och DeepGrader. Ska granskas av jurist
> innan användning. Baserad på GDPR art. 28.3.

## Parter

**Personuppgiftsansvarig** ("den Ansvarige"): [Huvudmannens namn],
org.nr [xxxxxx-xxxx], [adress].

**Personuppgiftsbiträde** ("Biträdet"): [DeepGrader-bolagets namn],
org.nr [xxxxxx-xxxx], [adress].

Detta avtal utgör bilaga till huvudavtalet om tillhandahållande av tjänsten
DeepGrader ("Tjänsten") och gäller så länge Biträdet behandlar personuppgifter
för den Ansvariges räkning.

## 1. Behandlingens föremål och varaktighet

Biträdet behandlar personuppgifter i syfte att tillhandahålla AI-stödd
rättning av matematikprov med lärargranskning. Behandlingen pågår under
huvudavtalets giltighetstid och upphör senast vid avtalets utgång, varvid
uppgifterna raderas eller återlämnas enligt punkt 9.

## 2. Behandlingens art och ändamål

Insamling, lagring, transkribering och automatiserad bedömning av elevers
handskrivna provlösningar; sammanställning av formativa rapporter; hantering
av lärarkonton; samt, om den Ansvarige aktiverar det, synkronisering av
elevlistor från den Ansvariges lärplattform.

## 3. Kategorier av registrerade och personuppgifter

Registrerade: elever och lärare hos den Ansvarige. Personuppgifter:
elevidentifierare (den Ansvarige instrueras att använda pseudonyma koder),
fotografier/inskanningar av handskrivna provlösningar, AI-transkriptioner och
bedömningar, lärarkommentarer, elevlistedata (namn, e-post, klass) vid
aktiverad synkronisering, samt lärares namn och e-post. Inga särskilda
kategorier av personuppgifter behandlas avsiktligt.

## 4. Den Ansvariges instruktioner

Biträdet behandlar personuppgifter endast enligt dokumenterade instruktioner
från den Ansvarige, inbegripet detta avtal och Tjänstens inställningar.
Biträdet informerar omedelbart den Ansvarige om en instruktion enligt
Biträdets mening strider mot GDPR.

## 5. Konfidentialitet

Biträdet säkerställer att personer med behörighet att behandla
personuppgifterna har åtagit sig konfidentialitet.

## 6. Säkerhetsåtgärder (art. 32)

Biträdet vidtar lämpliga tekniska och organisatoriska åtgärder, inklusive:
radbaserad åtkomstkontroll per skola i databasen, autentisering av samtliga
användare, kryptering under överföring, EU-baserad lagring (se punkt 8),
hashade och tidsbegränsade delningskoder för vårdnadshavarportalen, samt
loggning av bedömningsjobb. En sammanfattning av åtgärderna finns i Tjänstens
dokumentation och uppdateras löpande.

## 7. Underbiträden

Den Ansvarige lämnar ett allmänt förhandstillstånd till de underbiträden som
anges i Bilaga 1 (Supabase, Vercel, Anthropic, Google, Inngest). Biträdet
informerar den Ansvarige minst 30 dagar innan nya underbiträden anlitas; den
Ansvarige har rätt att invända. Biträdet ålägger varje underbiträde samma
skyldigheter som i detta avtal och ansvarar fullt ut för underbiträdens
fullgörande.

## 8. Tredjelandsöverföringar

Persistenta personuppgifter lagras inom EU/EES. I den mån AI-modelltjänster
innebär överföring till tredjeland sker den med stöd av giltiga
överföringsmekanismer (t.ex. EU-kommissionens standardavtalsklausuler eller
adekvansbeslut) och med leverantörsvillkor som utesluter användning av
uppgifterna för modellträning.

## 9. Bistånd, incidenter, radering och granskning

Biträdet bistår den Ansvarige med att besvara registrerades begäranden
(registerutdrag, radering m.m. — Tjänsten har inbyggda export- och
raderingsfunktioner), med konsekvensbedömningar och med anmälan av
personuppgiftsincidenter. Biträdet underrättar den Ansvarige utan onödigt
dröjsmål, senast inom 48 timmar, efter att ha fått kännedom om en incident.
Vid avtalets upphörande raderar Biträdet samtliga personuppgifter inom 30
dagar, om inte unionsrätt eller svensk rätt kräver fortsatt lagring. Biträdet
ger den Ansvarige tillgång till den information som krävs för att visa
efterlevnad och möjliggör revisioner.

## Bilaga 1 — Godkända underbiträden

| Underbiträde | Tjänst | Region |
|---|---|---|
| Supabase | Databas, autentisering, fillagring | EU (Stockholm) |
| Vercel | Applikationsdrift | EU-funktioner |
| Anthropic | AI-bedömningsmodell (API, ej träning) | Se punkt 8 |
| Google | AI-transkription/extraktion (API, ej träning); ev. Classroom-synk | Se punkt 8 |
| Inngest | Jobborkestrering (endast metadata) | EU |

## Underskrifter

| Den Ansvarige | Biträdet |
|---|---|
| Ort/datum: | Ort/datum: |
| Namn: | Namn: |
| Befattning: | Befattning: |
