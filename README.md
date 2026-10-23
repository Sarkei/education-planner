# education-planner

Dieses Repository enthält derzeit ausschließlich das unveränderte Gerüst der
GitLab-CI-Vorlage für .NET-Core-Konsolenanwendungen (`dotnet new console`):
eine `Program.cs`, die `Hello World!` ausgibt, ein Projektfile
`dotnetcore.csproj`, eine GitLab-Pipeline und eine Gitpod-Konfiguration.
Eigene Fachlogik ist nicht vorhanden – der Name des Repositories legt einen
Lern- bzw. Bildungsplaner nahe, im Code ist davon nichts umgesetzt.
Der Import erfolgte am 2026-10-23 aus Google Drive ("Import aus Google Drive"),
danach wurden README und `.gitignore` ergänzt.

## Funktionen

Aus dem Code belegbar ist ausschließlich:

- **Konsolenausgabe**: `Program.Main` schreibt genau eine Zeile, `Hello World!`,
  nach stdout (`Program.cs`). Es gibt keine Argumentauswertung – der Parameter
  `args` wird nicht verwendet.
- **Keine Ein-/Ausgabe**: keine Konsoleneingabe, kein Dateizugriff, keine
  Datenbank, kein Netzwerkzugriff.
- **Keine Datenmodelle**: außer der Klasse `Program` existiert kein Typ.
- **Build-Pipeline**: `.gitlab-ci.yml` definiert die Stages `build`, `test` und
  `deploy`; `deploy` ist ein Platzhalter (`echo "Define your deployment script!"`).
- **Automatisierte Dev-Umgebung**: `.gitpod.yml` baut das Projekt beim Start
  (`init: dotnet build`) und führt es anschließend aus (`command: dotnet run`).

## Technik

- **Projektformat**: SDK-Style-Projekt, `Microsoft.NET.Sdk`, keine Solution-Datei.
- **Ausgabetyp**: `Exe` (Konsolenanwendung).
- **Zielframework**: `net7.0`.
- **Abhängigkeiten**: keine – das csproj enthält weder `PackageReference` noch
  `ProjectReference`; es gibt keine `packages.config` und kein `package.json`.
- **Namespace**: `dotnetcore`.
- **CI-Image**: `mcr.microsoft.com/dotnet/sdk:7.0`.
- **Sprache im Repo**: C# (laut GitHub-Sprachstatistik die einzige Sprache).
- **Lizenz**: MIT, Copyright-Hinweis im Lizenztext nennt GitLab B.V. (2019–present).

## Projektstruktur

```
education-planner/
├── Program.cs            Einstiegspunkt, gibt "Hello World!" aus
├── dotnetcore.csproj      Projektfile: Exe, net7.0, keine Pakete
├── README.md             diese Datei
├── CONTRIBUTING.md       DCO-/Lizenzhinweis und Code of Conduct (GitLab-Vorlage)
├── LICENSE               MIT-Lizenztext, Copyright GitLab B.V.
├── .gitlab-ci.yml        Pipeline: restore, build, test, deploy-Platzhalter
├── .gitpod.yml           Gitpod-Image, Init-Build, Start via dotnet run
├── .gitignore            .NET-Artefakte, Obsidian-, Syncthing- und Dump-Regeln
└── .gitattributes        Zeilenenden: * text=auto
```

Es gibt keine Unterverzeichnisse, keine Testprojekte und keine Dokumentation
über die genannten Dateien hinaus.

## Start

Voraussetzung ist ein .NET-SDK, das `net7.0` bauen kann. Alle Befehle beziehen
sich auf das Repository-Wurzelverzeichnis.

```bash
# Abhängigkeiten wiederherstellen (Option aus der CI)
dotnet restore --packages .nuget

# Bauen (so nutzt es auch die CI, nach dem Restore)
dotnet build --no-restore

# Starten (so konfiguriert in .gitpod.yml)
dotnet run
```

Erwartete Ausgabe von `dotnet run`: `Hello World!`

`dotnet test --no-restore` ist in der Pipeline als Job `tests` definiert, im
Repository existiert jedoch kein Testprojekt, das dieser Befehl ausführen könnte.

## Konfiguration

Eine `.env.example` existiert im Repository nicht; es werden keine Umgebungs-
variablen aus einer `.env` gelesen und es sind keine Secrets hinterlegt.

Konfigurierbar sind nur die Variablen der CI-Datei `.gitlab-ci.yml` (Namen):

- `OBJECTS_DIRECTORY`
- `NUGET_PACKAGES_DIRECTORY`
- `SOURCE_CODE_PATH`

## Hinweise

- Der Inhalt ist die GitLab-Vorlage "dotNET-Core"; README, `CONTRIBUTING.md` und
  `LICENSE` stammen aus dieser Vorlage und beziehen sich auf GitLab B.V. bzw.
  auf GitLab als Plattform, obwohl das Repository auf GitHub liegt.
- `SOURCE_CODE_PATH` steht auf `*/*/`, was auf eine Struktur mit zwei
  Verzeichnisebenen zielt. Das Projekt liegt flach im Wurzelverzeichnis, die
  Cache-Pfade der Pipeline greifen daher voraussichtlich nicht.
- `net7.0` ist nicht mehr im Support; ein Update des Zielframeworks und des
  CI-Images wäre vor weiterer Entwicklung sinnvoll.
- Die `.gitignore` enthält Blöcke zu Obsidian, Syncthing und Datenbank-Dumps,
  die zu diesem Projekt keinen Bezug haben.
- Das Repository hat keine Beschreibung und keinen Git-Tag; die Historie umfasst
  drei Commits (Import, README/.gitignore, Aufräumen der `.gitignore`).
- Vor dem Ausbau zu einem tatsächlichen Planer fehlen Datenmodell, Persistenz,
  Tests und eine Beschreibung der geplanten Funktionen.
