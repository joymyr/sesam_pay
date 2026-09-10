# Sesam Pay for Homey Pro 🚗🅿️

Unngå servicetillegg på parkering! Automatisk overvåking og gebyrfri betaling innen 48-timersfristen.

---

### 💰 Bakgrunn
Ved automatisk trekk i apper som Sesam Sesam og EasyPark legges det til et servicetillegg på **15 %** (min. 5 kr, maks 50 kr per parkering) på anlegg med automatisk skiltgjenkjenning.

Betaler du derimot direkte på [sesam-sesam.com](https://sesam-sesam.com/) innen **48 timer** etter at parkeringen er avsluttet, slipper du servicetillegget helt! Utfordringen er å huske denne 48-timersfristen før det utstedes faktura med ekstra gebyrer.

### ✨ Funksjoner
- **Automatisk overvåking:** Sjekker jevnlig om registrerte kjøretøy har ubetalt parkering.
- **Tidlige varsler:** Sendes automatisk til Homey Tidslinje, push-varsel, Slack eller e-post så snart du har parkert.
- **Fristpåminnelse:** Gir beskjed når det gjenstår under 12 timer av 48-timersfristen.
- **1-klikks kopiering av betalingslenke:** Kopierer direkte betalingslenke til utklippstavlen for trygg betaling med BankID i Chrome eller Safari.
- **Rike Flow-kort:**
  - **Triggere:** *Ubetalt parkering oppdaget*, *Betalingsfrist utløper snart*, *Parkering er betalt* (både for spesifikk bil og generelt for alle kjøretøy).
  - **Betingelser:** *Har/Har ikke ubetalt parkering*, *Minst ett/Ingen kjøretøy har ubetalt parkering*.
  - **Handlinger:** *Sjekk ubetalte parkeringer nå*, *Sjekk alle kjøretøy nå*, *Send betalingsvarsel til Tidslinjen*.

---

### 🛠 Installasjon & Utvikling

```bash
# Bygg Typescript
npm run build

# Kjør appen lokalt på Homey Pro
homey app run

# Installer appen permanent
homey app install
```
