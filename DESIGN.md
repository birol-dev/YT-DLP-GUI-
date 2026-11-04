# YT-DLP GUI — Complete Design System Specification

> Recreate this design from this document alone. All values are exact. Colors use Shadcn-style **HSL channel triplets** (no `hsl()` wrapper in variables); consume as `hsl(var(--token))` or `hsl(var(--token) / alpha)`.

There are **two surfaces** sharing one design language:

| Surface | Files | Role |
|---------|-------|------|
| Electron desktop app | `index.html`, `styles.css`, `renderer/*.js` | Primary product UI |
| Marketing website | `website/index.html`, `website/styles.css`, `website/script.js` | Landing page in the birol.tech house style (Part B) |

**App design language (Part A):** Shadcn/ui dark zinc base + six live accent themes. Flat near-black backgrounds. Inter typography. Lucide-style outline icons. Soft card shadows. No purple-on-white gradients, no cream/serif look, no neon glow-as-theme (glow only on specific accents like the sniffer badge).

**Website design language (Part B):** the birol.tech family instead. Thin Newsreader headlines with one faded phrase, Geist sans, black / charcoal / paper chapters, pills for every control, and real app screenshots as the only colour. The two surfaces share the product name, logo mark and Lucide-style icons, not tokens.

---

## 1. Brand identity

| Property | Value |
|----------|-------|
| Product name | **YT-DLP GUI** (exact casing; hyphenated) |
| Tagline (site hero) | “Paste a link. Get a Premiere‑ready file.” |
| Voice | Direct, editor-focused, anti-CLI / anti-sketchy-web-converter |
| Logo mark | Lucide YouTube icon: rounded play-button rectangle + triangle, stroke `currentColor`, stroke-width `2`, viewBox `0 0 24 24` |
| SVG path | `<path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><path d="m10 15 5-3-5-3z"/>` |
| Logo color | App: always `hsl(var(--primary))` on the SVG. Site: `currentColor` (ink) |
| Wordmark | “YT-DLP GUI” beside icon, weight 600 (app) / 500 (site) |
| Theme color / OG | App `#0a0a0a`; site `#000000`, OG card `website/assets/og-image.jpg` |
| Favicon | `website/assets/favicon-32.png`, `website/assets/icon.png` / `build/icon.png` |

Logo size contexts:
- App sidebar: 24×24 SVG + 1rem / 600 wordmark
- Site header: 18×18 SVG (stroke 1.75) + wordmark

---

## 2. Design tokens (CSS variables)

### 2.1 Base tokens — Electron app (`styles.css` `:root`)

```css
:root {
  --background: 0 0% 3.9%;           /* #0a0a0a */
  --foreground: 0 0% 98%;            /* #fafafa */
  --card: 0 0% 3.9%;                 /* #0a0a0a */
  --card-foreground: 0 0% 98%;
  --popover: 0 0% 3.9%;
  --popover-foreground: 0 0% 98%;
  --primary: 0 0% 98%;               /* Sleek Silver default */
  --primary-foreground: 0 0% 9%;     /* #171717 */
  --secondary: 0 0% 14.9%;           /* #262626 */
  --secondary-foreground: 0 0% 98%;
  --muted: 0 0% 14.9%;
  --muted-foreground: 0 0% 63.9%;    /* #a3a3a3 */
  --accent: 0 0% 14.9%;
  --accent-foreground: 0 0% 98%;
  --destructive: 0 62.8% 30.6%;      /* dark red */
  --destructive-foreground: 0 0% 98%;
  --border: 0 0% 14.9%;
  --input: 0 0% 14.9%;
  --ring: 0 0% 83.1%;                /* #d4d4d4 */
  --radius: 0.5rem;                  /* 8px */
}
```

### 2.2 Website tokens

The website has its own token set (fonts, tones, radius, spacing) and does not use these HSL tokens. See Part B, sections B3 and B4.

### 2.3 Accent themes

Applied as `data-theme="..."` on `<html>`. Default = attribute absent or `default`. Themes **only** override `--primary`, `--primary-foreground`, and `--ring`.

| ID | Display name | Swatch hex | `--primary` | `--primary-foreground` | `--ring` |
|----|--------------|------------|-------------|------------------------|----------|
| *(none)* / `default` | Sleek Silver | `#f8f9fa` | `0 0% 98%` | `0 0% 9%` | `0 0% 83.1%` |
| `youtube` | YouTube Red | `#ef4444` | `0 84.2% 60.2%` | `0 0% 98%` | same as primary |
| `neon` | Cyan Spark | `#06b6d4` | `191.2 91.2% 45.1%` | `0 0% 98%` | same |
| `emerald` | Emerald Green | `#10b981` | `142.1 70.6% 45.3%` | `0 0% 98%` | same |
| `purple` | Velvet Purple | `#8b5cf6` | `263.4 82.2% 62.2%` | `0 0% 98%` | same |
| `amber` | Amber Gold | `#f59e0b` | `47.9 95.8% 51.2%` | `0 0% 9%` | same |

Accent themes exist only in the app. The website has no theme picker.

### 2.4 Hardcoded semantic colors (not tokens)

| Role | Value | Usage |
|------|-------|-------|
| Success | `#22c55e` | Logs, completed deps |
| Error | `#ef4444` | Logs, destructive text |
| Info | `#3b82f6` | Logs, sniffer gradient end |
| Warn | `#eab308` | Logs, extracting state |
| Modal scrim | `rgba(3, 3, 3, 0.85)` | Overlays |
| Video black | `#000` / `#0c0c0c` | Players, browser placeholder |
| White | `#fff` | Slider thumbs, switch knobs |

Alert surfaces (cookies / channel hints):
- Success: bg `hsl(142 76% 36% / 0.12)`, border `/0.35`, text `hsl(142 70% 72%)`
- Warning: bg `hsl(38 92% 50% / 0.12)`, border `/0.35`, text `hsl(38 92% 72%)`
- Error: bg `hsl(0 84% 60% / 0.12)`, border `/0.35`, text `hsl(0 84% 75%)`

---

## 3. Typography

### Fonts

| Context | Stack |
|---------|-------|
| UI | `'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` |
| Code / terminal | `'Consolas', 'Courier New', monospace` |

Google Fonts:
- App: `Inter:wght@400;500;600`
- Site: Newsreader + Geist + Geist Mono (see B3)

Global: `-webkit-font-smoothing: antialiased`. Reset: `* { box-sizing: border-box; margin: 0; padding: 0; }`.

### App type scale

| Element | Size | Weight | Letter-spacing | Color |
|---------|------|--------|----------------|-------|
| Body | `0.875rem` (14px) | 400 | — | foreground |
| Labels / nav / inputs | `0.875rem` | 500 | — | — |
| Logo wordmark | `1rem` | 600 | — | foreground |
| Card title | `1.5rem` | 600 | `-0.025em`, lh `1` | foreground |
| Card description | `0.875rem` | 400 | — | muted-foreground |
| Greeting title | `2rem` | 700 | `-0.03em` | foreground |
| Greeting subtitle | `1rem` | 400 | — | muted-foreground |
| Settings section title | `1rem` | 600 | `-0.01em` | — |
| Weather temp | `1.5rem` | 700 | `-0.02em`, lh `1.1` | — |
| Terminal header | `0.75rem` | 600 | `0.05em` uppercase | muted |
| Badge | `0.65rem` | 600 | — | — |
| Help / progress | `0.75rem` | 400–500 | — | muted |
| Dependency modal title | `1.35rem` | 600 | `-0.02em` | — |
| Onboarding title | `1.5rem` | 700 | `-0.025em` | — |

### Website type scale

See Part B, section B5.

---

## 4. Spacing, radius, shadows, borders

### Radius scale

| Expression | Computed | Use |
|------------|----------|-----|
| `var(--radius)` | 8px | Cards, nav items, panels |
| `calc(var(--radius) - 2px)` | 6px | Buttons, inputs, theme options |
| `calc(var(--radius) - 4px)` | 4px | Thumbnails, mode images |
| `calc(var(--radius) * 1.5)` | 12px | Modals, mockups, feature visuals |
| `9999px` | pill | Badges, switches, progress tracks, trust chips |
| `50%` | circle | Theme dots, weather icon, hero logo, step numbers |

### Borders

- Default: `1px solid hsl(var(--border))`
- Focus: `border-color: hsl(var(--ring))` + `box-shadow: 0 0 0 1px hsl(var(--ring))`
- Dashed drop zones: `2px dashed hsl(var(--border))`
- Active selection ring: `box-shadow: 0 0 0 1px hsl(var(--primary))` or border primary

### Shadows

| Name | Value |
|------|-------|
| Card (app) | `0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)` |
| Weather | `0 4px 12px rgba(0,0,0,0.2)` → hover `0 8px 24px rgba(0,0,0,0.3)` |
| Modal | `0 20px 40px -15px rgba(0,0,0,0.7)` |
| Thumbnail hover | `0 4px 12px rgba(0,0,0,0.5)` |
| Autocomplete | `0 10px 25px -5px rgba(0,0,0,0.5)` |
| Sniffer badge | `0 4px 12px rgba(59,130,246,0.3)` |

### Scrollbars (app)

Track transparent; thumb `hsl(muted)`, 8px wide, radius 4px; hover → muted-foreground.

---

## 5. Motion system

Signature easing: **`cubic-bezier(0.16, 1, 0.3, 1)`** (expo-out) for modals, reveals, weather lifts.

| Name | Spec |
|------|------|
| `fadeIn` | opacity 0→1 + `translateY(2px→0)`, `0.2s` ease-in-out (tabs) |
| Greeting fade | same pattern, `0.4s` ease-out |
| `modalScaleIn` | scale `0.95→1` + opacity, `0.5s` expo |
| `pulseLogo` | scale 1↔1.05 + primary glow `0 0 20px primary/0.2`, `2s` infinite ease-in-out |
| `pulseIndicator` | opacity 0.4↔1, `1s` alternate |
| `spin` | 360° linear `0.8s` (spinners 24px / small 16px) |
| `sniffer-glow` | blue box-shadow pulse `2s` alternate |
| `snifferSlideIn` | opacity + `translateY(6px) scale(0.98→1)`, `0.2s` |
| Weather | spin `20s` linear; float `4s`; rain `1.5s`; pulse `2s` |
| Site `reveal` | opacity 0 + `translateY(24px)` → `.is-in`; `0.9s` `--ease-out`; threshold `0.08`, rootMargin bottom `-8%`; off under reduced motion (see B8) |
| Nav / controls | most transitions `0.15s ease` |

---

# PART A — Electron desktop app

## A1. Global shell layout

```
┌─ sidebar 240px ─────────┬─ content (flex:1) ─────────────────────────┐
│ logo (pad 1.5rem 1.25rem)│ padding: 2rem; gap: 1.5rem; overflow:hidden │
│ nav (pad 0 0.75rem)      │ ┌─ content-wrapper (flex:1, col, overflow)─┐ │
│ gap 0.25rem between btns │ │ tab-content (scrollable)                 │ │
│                          │ │ progress bar (optional)                  │ │
│                          │ │ status terminal (default 160px, resize)  │ │
│                          │ └──────────────────────────────────────────┘ │
└──────────────────────────┴──────────────────────────────────────────────┘
```

- `body`: `height: 100vh; overflow: hidden; font-size: 0.875rem; background/foreground from tokens`
- `.app-container`: `display: flex; height: 100%`
- `.sidebar`: width `240px`, background = background token, `border-right: 1px solid border`, flex column
- No mobile sidebar collapse (desktop-first Electron)

## A2. Sidebar navigation

**Logo row:** flex, align center, gap `0.75rem`, padding `1.5rem 1.25rem`, weight 600, size 1rem. Lucide YouTube 24×24.

**12 nav buttons** (order matters):

1. Video (play-in-rect icon)
2. Audio (music note + discs)
3. Instagram (camera)
4. Subtitles (message)
5. Video Clipper (scissors/lasso)
6. Twitch VODs (Twitch glitch speech-bubble)
7. Video Divider (scissors)
8. Video to GIF (image)
9. Music Finder (headphones)
10. Browser (globe)
11. Recents (clock)
12. Settings (gear)

**`.nav-btn`:**
- Transparent bg, no border, muted-foreground text
- `padding: 0.5rem 0.75rem`, `font-size: 0.875rem`, weight 500
- `border-radius: var(--radius)`, flex, gap `0.75rem`, `transition: all 0.15s ease`
- SVG: 18×18, opacity `0.7`
- Hover: accent bg + accent-foreground
- Active: secondary bg + foreground; SVG opacity `1`

## A3. Content area & tabs

- `.content`: flex column, padding `2rem`, gap `1.5rem`, overflow hidden
- `.tab-content`: `display: none`; `.active` → `display: block` + `fadeIn`
- Non-fullscreen tabs: `padding-bottom: 1.5rem; padding-right: 4px`

## A4. Greeting + weather header

Shown on Video / Audio / Instagram tabs.

```
.tab-header-greeting
  justify space-between, align center, mb 2rem, gap 1.5rem, fadeIn 0.4s
  .greeting-left
    h1.greeting-title — 2rem/700/-0.03em
    p.greeting-subtitle — 1rem muted
  .weather-card (min-width 250px)
```

The markup ships “Welcome back!” / “What are we downloading today?” as placeholders. At runtime `renderer/weather.js` replaces them with a random title and subtitle from the time-of-day, day-of-week, and anytime pools in `renderer/greetings.js` (titles may include the user's name), never repeating the previous pick.

**Weather card:**
- Card bg, border, radius, padding `1rem 1.25rem`, flex, gap `1rem`
- Shadow `0 4px 12px rgba(0,0,0,0.2)`
- Hover: `translateY(-2px)`, border primary/0.4, deeper shadow
- Icon circle 42×42, muted/40 bg, radius 50%; hover → primary color + scale 1.08
- Temp 1.5rem/700; location + time rows with small muted icons

## A5. Card primitive (Shadcn structure)

```
.card → border, radius, soft shadow, flex column, card bg
  .card-header → padding 1.5rem / bottom 1rem
    .card-title → 1.5rem/600/-0.025em, mb 0.375rem
    .card-description → 0.875rem muted
  .card-content → padding 1.5rem, padding-top 0
  .card-footer → padding 1.5rem, padding-top 0, flex align center
```

## A6. Form controls & buttons

**Form group:** mb `1rem`; label block, mb `0.5rem`, weight 500, 0.875rem

**Text / password / select:**
- Width 100%, height `2.25rem`, padding `0.5rem 0.75rem`
- Transparent bg, `1px solid input`, radius 6px, 0.875rem
- Focus: ring border + `box-shadow: 0 0 0 1px hsl(var(--ring))`
- Select: custom chevron SVG data-URI (stroke `hsl(0,0%,63.9%)`), position right `0.5rem`, size `1rem`, `padding-right: 2rem`, `appearance: none`
- Options: background = background token

**`.btn` base:**
- inline-flex center, height `2.25rem`, padding `0 1rem`
- radius 6px, font 0.875rem/500, inherit family
- transition color/bg/shadow `0.15s`

**`.btn.primary`:** primary bg + primary-foreground, no border; hover primary/0.9

**Secondary pattern** (often inline, not a class): secondary bg, secondary-foreground, `1px solid border`

**Destructive reset:** bg `destructive/0.15`, text `#ef4444`, border `destructive/0.3`

**`.w-full`:** width 100%

## A7. Switch

- Track: 36×20, pill, muted → primary when checked
- Thumb `::before`: 14×14 circle, left/bottom 3px, foreground color; checked → `translateX(16px)` + primary-foreground
- Transition `0.2s`
- Layout: flex with title (500) + description (muted, smaller) beside track

## A8. Progress bar

- Labels: flex space-between, 0.75rem muted
- Track: height 6px, muted bg, pill
- Fill: primary, width transition `0.2s cubic-bezier(0.4, 0, 0.2, 1)`
- Substatus: `0.6875rem`, ellipsis

## A9. Status terminal (docked bottom)

- Default height `160px`, flex column
- Top 4px drag resizer; hover → primary/50 bg
- Header: padding `0.75rem 1rem`, border-bottom, uppercase tracking-wider, 0.75rem/600
- Body: Consolas, padding `1rem`, muted-foreground, line-height 1.5
- Log colors: success green, error red, info blue, warn yellow
- Often uses utility class `bg-muted/50`

## A10. Recents list

- Item: flex, border, radius, padding `0.75rem`, gap `1rem`; hover muted/30
- Thumbnail: `120×68`, radius 4px, object-cover; hover scale `1.04`, primary border, deep shadow; grab cursor when draggable
- URL: 0.875rem/500, ellipsis, underline on hover
- Meta: 0.75rem muted
- Badge: pill, secondary bg, 0.65rem/600

## A11. Tab content patterns (functional UI)

### Video / Audio / Instagram
Single card: URL input (+ “Max Quality” select on Video, “Format” select on Instagram) + full-width primary “Start Download”. Container / audio format come from Settings. Greeting + weather above.

### Subtitles
Card with URL, language select, and two buttons side by side: primary “Download Selected” + secondary “Download All”.

### Video Clipper
- Black 16:9 player, max-height ~280px
- Range bar height 12px muted pill; fill primary/30
- Handles 16×16 primary + white 2px border; playhead 4×20 primary
- In/out time inputs in monospace cards

### Twitch VODs
- Same URL row + 16:9 preview player + in/out range timeline as the Clipper, with chapter ticks on the timeline
- Chapter chips under the timeline jump the selection to a chapter
- Download options: Resolution, Container, and Parallel Connections selects, plus switches for frame-accurate cut and metadata/chapter embedding
- Selection summary above a primary “Download Video” button and a secondary “Download Audio Only” button (both 2.75rem tall)

### Video Divider
- Dashed drop zone, padding `3rem 2rem`; hover/dragover → primary border + primary/5 bg + lift `-2px`; icon scales 1.1
- Mode cards: 4-col grid (2 @768), 16:9 thumbs from assets:
  - `assets/fast_split.png`
  - `assets/precise_split.png`
  - `assets/equal_chunks.png`
  - `assets/spatial_split.png`
- Active mode: primary ring; image zoom 1.05 on hover (0.4s)
- Workspace: two columns flex `1.25` / `1`, gap 1.5rem; stacks @900px
- Spatial checkboxes: card-like; checked = primary border + primary/5

### GIF / Music Finder
Similar card + drop-zone patterns; Music Finder has slider controls and result list rows.

### Browser + sniffer
- Toolbar: card bg, top radius only, shadow; address input secondary/50 → bg on focus
- Icon square buttons 2.25rem, secondary bg
- Sniffer badge: gradient `primary → #3b82f6`, pill, glow animation
- Sidebar panel ~300px with `snifferSlideIn`
- Placeholder bg `#0c0c0c`

### Settings
- Sections separated by border-bottom, padding/margin 1.5rem
- Theme picker: flex-wrap chips (`.theme-option`) with 8px color dots
- Active theme option: secondary bg + ring border + ring shadow
- Grid of path inputs with browse buttons; switches for behaviors
- Reset / destructive actions at bottom

## A12. Modals (dependency, onboarding, media preview)

- Full-viewport fixed overlay: `rgba(3,3,3,0.85)` + `backdrop-filter: blur(12px)`
- Opacity transition `0.4s` expo
- Card: width ~440px (dep) / 480–500px (onboarding) / 720px (preview); padding `2.5rem`; radius 12px; heavy shadow; `modalScaleIn` 0.5s
- Logo circle 72×72 with radial `primary/0.15` + `pulseLogo`
- Dependency row states: pending (opacity 0.5), downloading (primary pulse), extracting (yellow), completed (green), error (red)
- Onboarding: step pills — muted → active primary/15 text + primary/40 border + soft glow; city autocomplete under input, max-height 180px

## A13. App responsive breakpoints

| Breakpoint | Behavior |
|------------|----------|
| `max-width: 900px` | Divider workspace → column |
| `max-width: 768px` | Divider modes → 2 columns |
| `max-width: 640px` | Settings grid → column; spatial grid → 2 cols |

---

# PART B — Marketing website

The site (`website/`) is static HTML, one stylesheet and one small script. There is no build step. It is part of the birol.tech family (birol.tech, SkillExtract, StockFinder AI, AutoCrop Pro, ManimGUI), not the app's Shadcn look. That means thin serif headlines, a small sans, chapters told apart by tone, pills for every control, and colour coming only from the product screenshots. The app's six accent themes are not used on the site.

## B1. Principles

- One idea per section and one headline per idea. A headline is a plain phrase plus one `.fade` phrase.
- The copy answers a first-time visitor's questions in this order: what is it, will it keep working, is it safe, is it full quality, will it open in my editor, is it free.
- Show the real product: recordings and screenshots of the app, never drawn mockups.
- No card borders. Panels stand apart by tone. Shadows go only on floating things (header, demo window, card screenshots).
- Sentence case everywhere, labels and buttons included. Keep it short: one sentence per card, one line per tool.
- Every claim must be true in the app (formats, auto-updates, cookies, playlists, platforms). Check the code before changing copy.

## B2. Page architecture (`index.html`)

| # | Section | Tone | Content |
|---|---------|------|---------|
| — | `.site-header` | floating pill | Brand · Features / How it works / FAQ · GitHub icon · Download (releases/latest) |
| 1 | `.hero#top` | black | h1 “Paste a link. *Get a Premiere‑ready file.*” · lead · Download for Windows + View on GitHub · meta line · demo video with three chapter buttons |
| 2 | `.statement` | black | “Sketchy converter sites, or a terminal full of flags. *There’s a calmer way.*” plus the yt-dlp command it replaces |
| 3 | `#features` (01) | charcoal | “Everything an editor *reaches for.*” · 2×2 bento (Premiere-ready, Clipper, Twitch VODs, drag to timeline) · eight-tool list |
| 4 | Why it’s different (02) + `#how-it-works` (03) | paper | Three reasons (It keeps working / Nothing shady / Full quality), then three steps (Install, Paste, Drag) |
| 5 | `#faq` (04) | black | Sticky heading on the left, nine `<details>` on the right |
| 6 | `.cta#download` | charcoal | “Your next clip is *one paste away.*” · Download + Star on GitHub · version line |
| 7 | `.site-footer` | black | Brand, links, “Made by Birol” → birol.tech, disclaimer, demo footage credit, license |

Secondary pages `pricing.html`, `privacy.html` and `404.html` share the header and footer and use `.page` (+ `.prose`) on black. `404.html` uses absolute asset paths because it can be served at any depth. Machine-readable copies: `llms.txt`, `pricing.md`.

## B3. Tokens (`website/styles.css` `:root`)

| Token | Value |
|-------|-------|
| `--font-serif` | `'Newsreader', 'Iowan Old Style', Georgia, serif` |
| `--font-sans` | `'Geist', ui-sans-serif, system-ui, sans-serif` |
| `--font-mono` | `'Geist Mono', ui-monospace, Consolas, monospace` |
| `--radius-panel` / `--radius-card` / `--radius-inner` | `32px` / `24px` / `12px` (controls are always `999px` pills) |
| `--shadow-float` | `0 40px 90px -40px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.07)` |
| `--ease-out` | `cubic-bezier(.22, 1, .36, 1)` |
| `--page-margin` | `clamp(16px, 4.5vw, 64px)` |
| `--wrap` / `--wrap-wide` | `1180px` / `1320px` (plus page margins) |
| `--space-group` / `-block` / `-item` / `-chapter` | `clamp(16px,2vw,24px)` / `clamp(40px,5vw,64px)` / `clamp(72px,8vw,120px)` / `clamp(96px,12vw,176px)` |
| `--text-display-xl` / `-l` / `-s` | `clamp(2.6rem, min(6.4vw,10svh), 6.5rem)` / `clamp(2.1rem,4.4vw,4.4rem)` / `clamp(1.35rem,1.7vw,1.7rem)` |

Google Fonts: `Geist:wght@400;500`, `Geist Mono:wght@400`, `Newsreader:ital,opsz,wght@0,6..72,200..400;1,6..72,200..400`.

## B4. Tones

Each section sets `data-tone`. Components read only these variables, so the same markup works on any tone.

| Variable | `black` | `charcoal` | `paper` |
|----------|---------|------------|---------|
| `--surface` | `#000000` | `#1c1c1c` | `#f4f4f4` |
| `--panel` | `#141414` | `#262626` | `#ebebe8` |
| `--ink` | `#ffffff` | `#f4f4f4` | `#141414` |
| `--muted` | `#b6b6b6` | `#b6b6b6` | `#5c5c5c` |
| `--fade` | `#8a8a8a` | `#8f8f8f` | `#8a8a8a` |
| `--hairline` | `#262626` | `#333333` | `#dcdcd8` |
| `--solid-bg` / `--solid-ink` | `#fff` / `#000` | `#f4f4f4` / `#141414` | `#141414` / `#f4f4f4` |

Page rhythm: black → black → charcoal → paper → black → charcoal → black. Only one paper chapter.

## B5. Type

| Element | Font | Size | Weight | Notes |
|---------|------|------|--------|-------|
| Hero h1 | serif | `clamp(2.6rem, min(6vw, 8.6svh), 6.25rem)` | 250 | lh .96, `-0.035em`, max 22ch, `.fade` on its own line (inline under 760px) |
| `.display-xl` | serif | `--text-display-xl` | 250 | Final CTA, 404 |
| `.display-l` | serif | `--text-display-l` | 250 | Section titles, max 16ch |
| `.display-s` | serif | `--text-display-s` | 300 | Card titles, step titles |
| `.reasons h3` | serif | `clamp(2rem, 3.4vw, 3.4rem)` | 250 | `-0.035em` |
| `.number` | serif | `clamp(3.5rem, 7.5vw, 7.5rem)` | 200 | Pricing `$0` |
| `.lead` | sans | `clamp(1.05rem, 1.3vw, 1.2rem)` | 400 | muted, max 34ch, balanced |
| Body | sans | 16px, lh 1.55 | 400 | — |
| Card / tool text | sans | 15px / 14px | 400 | muted |
| `.label`, `.meta`, `.caption` | sans | 13px | 400 | muted / fade |
| `code`, `.cli` | mono | .92em / 14px | 400 | — |

## B6. Components

- **Header** (`.site-header > .nav`): fixed 12px from the top, max 880px pill, `rgba(20,20,20,.62)` with `blur(18px)` and an inset hairline. `.nav-links` sit centered between auto margins. On pages without links, `.brand + .nav-actions` pushes the actions right. The script sets `aria-current` on the link for the section in view.
- **Pills**: `.pill` 48px high, 22px side padding, 15px/500. `.pill-solid` uses solid-bg/solid-ink with a 6px halo on hover. `.pill-ghost` has an inset hairline and fills with panel on hover. `.pill-sm` is 38px. Pressing scales to .97. Icons are 18px with an 8px gap.
- **Section label** (`.label`): `<num> <name> ———— <aside>`. 13px muted, number in ink, a 1px hairline fills the space.
- **Demo window** (`.window`): radius 24px (14px on phones), `#0a0a0a`, `--shadow-float`, aspect 1480/800. Holds `video#demo-video` (muted, loop, playsinline, poster) and `.demo-toggle`, a 44px glass pause button that shows on hover, when paused and always on phones.
- **Chapters** (`.chapters`): three `button.chapter[data-at]` under the window. A 2px `.chapter-bar` fills with `transform: scaleX(var(--p))`. The active chapter is ink, the others fade.
- **CLI pill** (`.cli`): mono command on panel. It scrolls sideways on desktop and wraps on phones.
- **Bento cards** (`.card`): panel background, radius 32px, `clamp(24px,3vw,40px)` padding with none at the bottom. `.card-media` is a `<picture>` (webp, 800/1480 `srcset`) that bleeds off the right and bottom edge with a 12px top-left radius and `--shadow-float`, and rises 6px on card hover. The `.tag` “New” chip uses solid colours.
- **Tool list** (`.tools`): 4 columns, hairline rows, icon + name + one line.
- **Reasons** (`.reasons`): 3 columns split by left hairlines, a serif h3 with a faded second word and a muted 16px line (max 32ch). Under 760px they stack with top hairlines.
- **Steps** (`.steps`): 3 columns, each with a 1px ink top rule, a faded number, a serif title and a muted line.
- **FAQ** (`.faq-grid`): two columns with a sticky `.faq-head`. Items are native `<details>`/`<summary>` with a plus icon that turns 45° when open. No script needed.
- **Final CTA** (`.cta`): centered column, `.display-xl` h2 max 12ch, actions, version meta.
- **Footer**: brand, inline links (GitHub, Changelog, Pricing, Privacy, llms.txt), “Made by Birol ↗”, then fine print.

## B7. Media (`website/assets/`)

| File | Use |
|------|-----|
| `media/demo.mp4`, `media/demo-poster.webp` | Hero recording of the real app: paste and download, Clipper, then GIF and Divider. Chapter start times (0, 7.22, 16.23 s) live in the chapter buttons' `data-at` |
| `media/{download,clipper,twitch,recents}-{800,1480}.webp` | Bento screenshots |
| `og-image.jpg` | 1200×630 social card: headline plus a tilted Video tab screenshot |
| `favicon-32.png`, `icon.png` | Favicons. The app also reads these (`src/main/folders.js`, `test/hardening-sweep.test.js`), so keep the paths |

The footage inside the recordings comes from Blender open movies (Big Buck Bunny, Sintel, Spring, Tears of Steel), CC BY, credited in the footer. Replace captures with new real app captures. Don't use drawn UI.

## B8. Script (`website/script.js`)

- `initReveal()`: `.reveal` blocks fade up once as they enter (IntersectionObserver adds `.is-in`). This only happens when `<html>` has `.js` and motion is allowed. Otherwise everything is visible.
- `initDemo()`: the video plays only while at least 25% of it is visible. The chapter bars update every frame, clicking a chapter seeks and plays, and the toggle pauses or plays and updates its `aria-label`. With reduced motion the video starts paused.
- `initNav()`: sets `aria-current` on the header link for the section in view.

## B9. Breakpoints

| Breakpoint | Changes |
|------------|---------|
| `960px` | Tools → 2 columns; FAQ → 1 column (head no longer sticky) |
| `760px` | Nav links hidden; hero `.fade` inline; bento, steps and reasons → 1 column; chapter labels 12px; demo toggle always visible; window radius 14px; CLI wraps |
| `480px` | Tools → 1 column; action pills full width on the homepage and 404 (not on the prose pages); nav GitHub icon hidden |

Check at 1440 and 390 for no horizontal scroll and a hero headline that never breaks inside “Premiere‑ready” (it uses a non-breaking hyphen).

## B10. Metadata

- JSON-LD `@graph` in `index.html`: WebSite, WebPage, Person (Birol Softa), SoftwareApplication (version, price 0) and FAQPage. The FAQPage must match the visible FAQ, so change both together.
- On each release, update the version in the SoftwareApplication JSON-LD, the CTA meta line, `llms.txt`, `pricing.md`, `pricing.html` and `sitemap.xml` `lastmod`.
- Analytics: Cloudflare Web Analytics beacon (no cookies). The privacy page says so. Don't add anything that stores data in the browser.

---

## 6. Iconography rules

- **System:** Lucide-style inline SVG only
- Attributes: `fill="none" stroke="currentColor" stroke-width="2"` (checks use `2.5`), `stroke-linecap="round" stroke-linejoin="round"`, `viewBox="0 0 24 24"`
- No emoji in production UI
- App sizes: nav 18, logo 24, list checks 16
- Website: one inline `<svg>` sprite of `<symbol>`s per page, used via `<use href="#i-…">`; `.i` is 18px with stroke-width `1.75` (brand mark 22px)

---

## 7. Assets inventory

| Path | Role |
|------|------|
| `assets/fast_split.png` | Divider mode thumb |
| `assets/precise_split.png` | Divider mode thumb |
| `assets/equal_chunks.png` | Divider mode thumb |
| `assets/spatial_split.png` | Divider mode thumb |
| `build/icon.png` | Electron app icon |
| `website/assets/favicon-32.png`, `website/assets/icon.png` | Site favicons (the app reads these paths too) |
| `website/assets/og-image.jpg` | Social card |
| `website/assets/media/` | Hero demo video, poster and bento screenshots (see B7) |

---

## 8. Interaction state matrix

| Control | Hover | Focus | Active / selected | Notes |
|---------|-------|-------|-------------------|-------|
| Nav btn (app) | accent fill | — | secondary fill; icon opacity 1 | SVG default 0.7 |
| Primary btn | primary/0.9 | — | — | — |
| Secondary / ghost | accent or secondary | — | — | — |
| Input / select | — | ring border + 1px ring | — | transparent bg |
| Theme option / dot | accent / scale 1.15 | — | ring / foreground border | — |
| Recent thumb | scale 1.04 + shadow | — | grabbing | — |
| Weather | lift −2px | — | — | — |
| Drop zone | primary border + lift | — | `.dragover` same | — |
| Switch | — | — | track primary; thumb slides | — |

Website states (pills, nav links, chapters, bento cards, FAQ) are listed with their components in B6.

---

## 9. Do / don’t (app visual fidelity)

**Do:**
- Use HSL channel CSS variables exactly as listed
- Keep default theme near-black zinc with white/silver primary
- Keep Inter + tight negative letter-spacing on large headings

**Don’t:**
- Don’t introduce Inter/Roboto as the *only* identity without the zinc token system
- Don’t use purple-indigo gradient marketing tropes as the default theme
- Don’t lighten the app to a cream/warm paper look (the paper tone belongs to the website only)

**Website:** follow B1. Don’t bring the app's accent colours, card borders or uppercase labels onto the site, and don’t add stats strips, comparison tables or drawn mockups.

---

## 10. Recreation checklist for an AI agent

1. Port `:root` tokens + all six `[data-theme]` blocks verbatim.
2. Load Inter (400–700) and set global body/reset rules.
3. Build **app shell**: 240px sidebar + padded content + resizable terminal dock.
4. Implement primitives: card, btn primary, inputs/selects, switch, progress, theme chips.
5. Build greeting + weather header; wire tab panes for all 12 nav items.
6. Layer specialty UIs: clipper and Twitch range timelines, divider drop zone + 4 modes, browser sniffer, modals.
7. Verify theme swapping only changes primary/ring/primary-foreground everywhere.
8. Build the **website** from Part B: tones and tokens → floating header → hero with demo video and chapters → statement → features bento + tools → reasons + steps → FAQ → final CTA → footer.
9. Add the three site scripts (reveal, demo, nav) and check 1440 and 390 widths for overflow.

---

## 11. Source of truth

Authoritative implementation files (prefer reading these if available):

- `styles.css` — Electron tokens + components (~2700 lines)
- `index.html` — Electron markup (many secondary buttons use inline styles)
- `website/styles.css` — Website tokens, tones and components (~1250 lines)
- `website/index.html` — Section copy, structure and JSON-LD
- `website/script.js` — Reveal, hero demo playback and chapters, header link state

When this document and the CSS disagree, **CSS wins**.
