---
name: project-discovery
description: Interactive interview process to understand what the user wants to build before any code is written
trigger: When starting a new project or when /new-project is invoked
---

# Project Discovery — Interview Skill

## Übersicht
Führe ein strukturiertes Interview durch um zu verstehen was der User bauen möchte. Stelle Fragen eine nach der anderen. Nutze Multiple-Choice wenn möglich. Erkläre technische Konzepte in einfacher Sprache.

## Ablauf

### Phase 1: Vision (Was und Warum)
Stelle diese Fragen EINE NACH DER ANDEREN:

1. **Projekttyp**: "Was möchtest du bauen?"
   - Web App (interaktive Anwendung im Browser)
   - Website (informativer Webauftritt)
   - Mobile App (Handy-App für iOS/Android)
   - API/Backend (Server der Daten verarbeitet)
   - CMS (System zum Verwalten von Inhalten)
   - E-Commerce (Online-Shop)
   - Anderes: ___

2. **Projektname**: "Wie soll das Projekt heißen?"

3. **Beschreibung**: "Beschreib in 2-3 Sätzen was es machen soll."

4. **Zielgruppe**: "Wer wird das benutzen?"
   - Privatpersonen
   - Unternehmen/Business
   - Internes Team
   - Öffentlich (jeder)

5. **Vorbild**: "Gibt es eine bestehende App/Website die ähnlich ist?"

### Phase 2: Features (Was genau)

6. **Kernfeatures**: "Was sind die 3-5 wichtigsten Dinge die es können muss?"

7. **User-Accounts**: "Braucht es Login/Registrierung?"
   - Ja, mit Email + Passwort
   - Ja, mit Social Login (Google, GitHub, etc.)
   - Ja, beides
   - Nein, kein Login nötig

8. **Daten**: "Welche Art von Daten werden gespeichert?"
   - User-Profile
   - Texte/Artikel
   - Bilder/Medien
   - Produkte/Bestellungen
   - Andere: ___

9. **Bezahlung**: "Braucht es eine Zahlungsfunktion?"
   - Ja, einmalige Zahlungen
   - Ja, Abonnements/Subscriptions
   - Nein

10. **Sprache**: "In welcher Sprache soll die UI sein?"
    - Deutsch
    - Englisch
    - Mehrsprachig
    - Andere: ___

### Phase 3: Technik (Wie)

11. **Design**: "Hast du Design-Vorstellungen?"
    - Modern/minimalistisch
    - Bunt/verspielt
    - Corporate/professionell
    - Ich habe Figma/Sketch Designs
    - Keine Präferenz — mach einen Vorschlag

12. **Mobile**: "Wie wichtig ist Mobile?"
    - Mobile-first (Handy ist wichtiger als Desktop)
    - Beides gleich wichtig
    - Desktop-first (Handy ist Bonus)
    - Brauche eine native App (App Store)

13. **Deployment**: "Wo soll es laufen?"
    - Vercel (einfach, kostenloser Start)
    - Netlify (ähnlich wie Vercel)
    - Eigener Server / VPS
    - Egal — mach einen Vorschlag

14. **Bestehender Code**: "Gibt es bestehenden Code den wir übernehmen sollen?"

15. **Budget/Zeit**: "Gibt es ein Budget oder eine Deadline?"

### Phase 4: Extras (basierend auf bisherigen Antworten)

Stelle weitere Fragen basierend auf den bisherigen Antworten:
- Wenn Web App: "Braucht es Echtzeit-Features (Chat, Live-Updates)?"
- Wenn E-Commerce: "Wie viele Produkte ungefähr? Braucht es Varianten?"
- Wenn CMS: "Wer soll Inhalte bearbeiten können?"
- Wenn Mobile App: "iOS, Android oder beides?"
- Wenn Login: "Braucht es verschiedene Rollen (Admin, User, Editor)?"
- Wenn Datenbank: "Wie viele User erwartest du am Anfang? In einem Jahr?"

16. "Soll ich ein GitHub-Repository erstellen?"
17. "Soll ich Preview Deployments einrichten? (Test-Link bei jedem Feature)"

### Phase 5: Empfehlung

1. Fasse die Anforderungen zusammen (in einfacher Sprache)
2. Empfehle einen Tech-Stack mit Begründung:
   - Frontend Framework + warum
   - Backend/API + warum
   - Datenbank + warum
   - Hosting + warum
   - Weitere Tools + warum
3. Zeige was im kostenlosen Tier möglich ist vs. was kostet
4. Warte auf explizites OK

### Phase 6: Handoff

Übergib an den Scaffolding-Skill mit allen gesammelten Infos.

## Regeln
- MUST: Eine Frage pro Nachricht — nicht überfordern
- MUST: Multiple-Choice bevorzugen wo möglich
- MUST: Technische Begriffe in einfacher Sprache erklären
- MUST: Bei jeder Empfehlung erklären WARUM
- NEVER: Annahmen treffen ohne zu fragen
- NEVER: Mehr als 2 Fragen auf einmal stellen
