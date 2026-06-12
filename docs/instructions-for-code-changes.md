## Terminal openen

Een terminal is het venster waarin je opdrachten typt, zoals `git status` of `npm run dev`.

Open het project in Visual Studio Code. Klik bovenin op **Terminal** en daarna op **Nieuw**. Onderaan in VS Code opent dan een terminalvenster. Controleer dat daar PowerShell geopend is voordat je de commands uit deze handleiding gebruikt.

## Let op: desktop-app niet starten tijdens codewijzigingen

Als je bezig bent met code aanpassen, open de app dan niet via de normale desktop-snelkoppeling/startknop.

Je kunt zien dat er nog lokale wijzigingen zijn als VS Code links bij bestandsnamen een kleurtje, bolletje of markering toont. Controleer bij twijfel altijd:

```powershell
git status
```

Voordat je de app normaal via de desktop start, moet je de wijzigingen eerst:

- toevoegen en committen, zie `Commit maken`
- of weggooien, zie `Troubleshooting`

Als je nog bezig bent en nog niet wilt committen of weggooien, start de app dan tijdelijk als development-versie:

```powershell
npm run dev
```

Open daarna in de browser:

```text
http://localhost:3000
```

## Belangrijke regel

Werk bij voorkeur altijd in deze volgorde:

```powershell
git pull
# wijziging maken
git status
git add .
git commit -m "korte beschrijving"
git push
```


## Voor je begint met wijzigen

Haal altijd eerst de nieuwste versie binnen:

```powershell
git pull
```

## Wijzigingen maken met Claude Code

Als Claude Code wordt gebruikt om code aan te passen, geef dan eerst deze opdracht:

```text
Bestudeer eerst de volledige logica rond wat ik wil aanpassen. Lees de relevante bestanden, componenten, API routes, helpers en tests. Maak nog geen codewijzigingen. Leg eerst uit welke onderdelen betrokken zijn en hoe de bestaande logica nu werkt.
```

Als Claude Code daarna voorstelt om logica aan te passen, vraag dan eerst:

```text
Zeg eerst precies wat je gaat aanpassen, waarom dat nodig is, en wat dit betekent voor de bestaande logica. Noem ook welke risico's of bijwerkingen er kunnen zijn. Pas daarna pas de code aan.
```

Belangrijk:

- Laat Claude Code niet direct grote wijzigingen maken zonder uitleg.
- Vraag altijd welke bestaande flow geraakt wordt.
- Vraag bij logica-wijzigingen altijd om eerst `npm run lint` en waar zinvol `npm run build` te draaien.
- Als je de uitleg niet snapt, niet pushen. Eerst navragen.


Daarna:
Gebruik `git add .` alleen als je zeker weet dat alle getoonde wijzigingen mee moeten.

## Commit maken

Maak een commit met een korte duidelijke tekst:

```powershell
git commit -m "Update planning layout"
```

Push daarna:

```powershell
git push
```


## Troubleshooting

Gebruik alleen de stappen hieronder als je zeker weet wat je wilt bereiken. Sommige commands gooien lokale wijzigingen weg.


### Probleem: een wijziging in een bestand moet weg

Als je een niet-gecommitte wijziging in een bestand wilt weggooien:

```powershell
git restore pad/naar/bestand
```

Voorbeeld:

```powershell
git restore app/planning/page.tsx
```

Als het bestand al staged was, doe eerst:

```powershell
git restore --staged pad/naar/bestand
```

Daarna:

```powershell
git restore pad/naar/bestand
```

### Probleem: alle niet-gecommitte wijzigingen moeten weg

Let op: dit gooit lokale wijzigingen weg.

```powershell
git restore --staged .
git restore .
```

Als er nieuwe bestanden zijn aangemaakt die Git nog niet kent, kijk eerst wat verwijderd zou worden:

```powershell
git clean -fdn
```

Als de lijst klopt, verwijder ze echt:

```powershell
git clean -fd
```

### Probleem: vergeten te pullen, push geeft merge/conflict gedoe

Gebruik dit alleen als de lokale wijzigingen op de office PC weg mogen en de PC exact gelijk moet worden aan GitHub `main`.

1. Check eerst de status:

```powershell
git status
```

2. Als Git zegt dat er een merge bezig is:

```powershell
git merge --abort
```

3. Als Git zegt dat er een rebase bezig is:

```powershell
git rebase --abort
```

4. Haal de nieuwste GitHub-info op:

```powershell
git fetch origin
```

5. Zet de PC exact gelijk aan GitHub `main`:

```powershell
git reset --hard origin/main
```

6. Kijk of er nieuwe losse bestanden verwijderd zouden worden:

```powershell
git clean -fdn
```

7. Als de lijst klopt, verwijder ze:

```powershell
git clean -fd
```

8. Controleer:

```powershell
git status
```

Je wilt zien:

```text
On branch main
Your branch is up to date with 'origin/main'.
nothing to commit, working tree clean
```

Daarna is de office PC weer schoon en gelijk met GitHub.

## Wanneer niet pushen

Push niet als:

- je niet zeker weet wat Claude Code heeft aangepast
- `git diff` wijzigingen laat zien die je niet herkent
- `git pull` een conflict meldt
- `npm run lint` faalt na codewijzigingen
- je niet zeker weet of de wijziging direct op `main` mag komen

Vraag dan eerst hulp voordat je verder gaat.
