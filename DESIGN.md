# YT-DLP GUI — Complete Design System Specification

> Recreate this design from this document alone. All values are exact. Colors use Shadcn-style **HSL channel triplets** (no `hsl()` wrapper in variables); consume as `hsl(var(--token))` or `hsl(var(--token) / alpha)`.

There are **two surfaces** sharing one design language:

| Surface | Files | Role |
|---------|-------|------|
| Electron desktop app | `index.html`, `styles.css`, `renderer.js` | Primary product UI |
| Marketing website | `website/index.html`, `website/styles.css`, `website/script.js` | Landing page mirroring the app |

**Design language:** Shadcn/ui dark zinc base + six live accent themes. Flat near-black backgrounds. Inter typography. Lucide-style outline icons. Soft card shadows. No purple-on-white gradients, no cream/serif look, no neon glow-as-theme (glow only on specific accents like sniffer badge / pain cards).

---

## 1. Brand identity

| Property | Value |
|----------|-------|
| Product name | **YT-DLP GUI** (exact casing; hyphenated) |
| Tagline (hero) | “Download media like a pro. Without the command line.” |
| Voice | Direct, editor-focused, anti-CLI / anti-sketchy-web-converter |
| Logo mark | Lucide YouTube icon: rounded play-button rectangle + triangle, stroke `currentColor`, stroke-width `2`, viewBox `0 0 24 24` |
| SVG path | `<path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><path d="m10 15 5-3-5-3z"/>` |
| Logo color | Always `hsl(var(--primary))` on the SVG |
| Wordmark | “YT-DLP GUI” beside icon, weight 600 |
| Theme color / OG | `#0a0a0a` |
| Favicon | `website/assets/icon.png` / `build/icon.png` |

Logo size contexts:
- App sidebar: 24×24 SVG + 1rem / 600 wordmark
- Site nav: 22×22 SVG + 0.95rem / 600
- Site hero: 28×28 SVG inside a 56×56 circular radial glow badge

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

### 2.2 Website overrides / extras (`website/styles.css` `:root`)

Same as app except:

```css
--card: 0 0% 5.5%;                   /* slightly lighter #0e0e0e */
--destructive: 0 84.2% 60.2%;        /* brighter #ef4444 */
--section-gap: 6rem;                 /* → 5rem @960px → 3.5rem @600px */
--container: 1120px;
--nav-height: 64px;                  /* → 56px @600px */
```

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

Website theme persistence key: `localStorage['ytdlp-gui-theme']`.

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

Pain cards always use red (ignore accent theme): `--pain-accent: 0 84.2% 60.2%`.

---

## 3. Typography

### Fonts

| Context | Stack |
|---------|-------|
| UI | `'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` |
| Code / terminal | `'Consolas', 'Courier New', monospace` |

Google Fonts:
- App: `Inter:wght@400;500;600`
- Site: `Inter:wght@400;500;600;700`

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

| Element | Size | Weight | Letter-spacing / notes |
|---------|------|--------|------------------------|
| Body | `1rem`, lh `1.6` | 400 | — |
| Section label | `0.75rem` uppercase | 600 | `0.08em`, color **primary** |
| Section title | `clamp(1.75rem, 4vw, 2.5rem)` | 700 | `-0.03em`, lh `1.15`, mb `1rem` |
| Section subtitle | `1.125rem` | 400 | muted, max-width `640px`, lh `1.7` |
| Hero h1 | `clamp(2.25rem, 5vw, 3.25rem)` | 700 | `-0.04em`, lh `1.1`, mb `1.25rem` |
| Hero lead | `1.125rem` | 400 | muted, max-width `520px`, lh `1.7`, mb `2rem` |
| Feature h3 | `1.75rem` (→ `1.5rem` tablet, `1.35rem` mobile) | 700 | `-0.03em` |
| Nav links | `0.875rem` | 500 | muted → foreground on hover/active |
| Nav logo | `0.95rem` | 600 | — |

---

## 4. Spacing, radius, shadows, borders

### Radius scale

| Expression | Computed | Use |
|------------|----------|-----|
| `var(--radius)` | 8px | Cards, nav items, panels |
| `calc(var(--radius) - 2px)` | 6px | Buttons, inputs, theme options, pain icons |
| `calc(var(--radius) - 4px)` | 4px | Thumbnails, mode images |
| `calc(var(--radius) * 1.25)` | 10px | Pain cards |
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
| Card (site) | `0 1px 3px 0 rgb(0 0 0 / 0.1)` |
| Weather | `0 4px 12px rgba(0,0,0,0.2)` → hover `0 8px 24px rgba(0,0,0,0.3)` |
| Modal | `0 20px 40px -15px rgba(0,0,0,0.7)` |
| App mockup | `0 25px 50px -12px rgba(0,0,0,0.5)` |
| Thumbnail hover | `0 4px 12px rgba(0,0,0,0.5)` |
| Autocomplete | `0 10px 25px -5px rgba(0,0,0,0.5)` |
| Pain card | inset `0 1px 0 hsl(pain/0.06)` + `0 4px 24px rgba(0,0,0,0.35)` |
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
| `modalScaleIn` | scale `0.95→1` (app) / `0.96→1` (site mockup) + opacity, `0.5–0.6s` expo |
| `pulseLogo` | scale 1↔1.05 + primary glow `0 0 20px primary/0.2`, `2s` infinite ease-in-out |
| `pulseIndicator` | opacity 0.4↔1, `1s` alternate |
| `spin` | 360° linear `0.8s` (spinners 24px / small 16px) |
| `sniffer-glow` | blue box-shadow pulse `2s` alternate |
| `snifferSlideIn` | opacity + `translateY(6px) scale(0.98→1)`, `0.2s` |
| Weather | spin `20s` linear; float `4s`; rain `1.5s`; pulse `2s` |
| Site `reveal` | start opacity 0 + `translateY(16px)`; `.visible` → rest; `0.6s` expo; IntersectionObserver threshold `0.12`, rootMargin bottom `-40px` |
| `progressPulse` | mock fill width 73%↔78%, `2s` ease-in-out |
| FAQ | `max-height 0→400px` `0.3s`; chevron rotate 180° `0.2s` |
| Primary btn (site) | hover `translateY(-1px)` |
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

**11 nav buttons** (order matters):

1. Video (play-in-rect icon)
2. Audio (music note + discs)
3. Instagram (camera)
4. Subtitles (message)
5. Video Clipper (scissors/lasso)
6. Video Divider (scissors)
7. Video to GIF (image)
8. Music Finder (headphones)
9. Browser (globe)
10. Recents (clock)
11. Settings (gear)

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
    h1.greeting-title "Welcome back!" — 2rem/700/-0.03em
    p.greeting-subtitle "What are we downloading today?" — 1rem muted
  .weather-card (min-width 250px)
```

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
Single card: URL input (+ quality/format selects) + full-width primary “Start Download”. Greeting + weather above.

### Subtitles
Card with URL, language select, format (VTT/SRT), download button.

### Video Clipper
- Black 16:9 player, max-height ~280px
- Range bar height 12px muted pill; fill primary/30
- Handles 16×16 primary + white 2px border; playhead 4×20 primary
- In/out time inputs in monospace cards

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

## B1. Page architecture (section order)

1. Skip link → fixed nav
2. `#hero` — two-column hero + app mockup
3. `#what-is` — extract/overview (definition + 3 cards)
4. `#pain` — “Sound familiar?” 6 pain cards
5. Solution bridge (no id) — centered one-liner
6. `#features` — alternating feature rows (Video, Audio, Instagram, Subtitles, Clipper, Divider, Music Finder, Recents/Settings)
7. `#personas` — three persona bands
8. `#opensource` — open source grid + CTAs
9. `#compare` — comparison table
10. `#formats` — format picker cards
11. `#themes` — large theme picker
12. `#how-it-works` — 3 steps + terminal mock
13. `#architecture` — developer stack cards
14. `#faq` — accordion
15. `#download-section` — final CTA
16. Footer

Smooth scroll; `scroll-padding-top: calc(nav-height + 1rem)`.

## B2. Container & section rhythm

```css
.container { max-width: 1120px; margin: 0 auto; padding: 0 1.5rem; } /* 1rem @600px */
.section { padding: var(--section-gap) 0; } /* 6rem / 5rem / 3.5rem */
```

Section header pattern (every major section):
1. `.section-label` — uppercase primary micro-label
2. `.section-title` — clamp heading
3. `.section-subtitle` — muted supporting sentence, max 640px

## B3. Fixed navigation

```
.site-nav
  position fixed; top 0; full width; height 64px; z-index 1000
  bg: background / 0.8; backdrop-filter blur(12px)
  border-bottom 1px solid border
  .nav-inner (container): flex space-between align center gap 1rem
    .nav-logo (icon 22 + wordmark)
    .nav-links: Overview, Features, For You, Open Source, Compare, FAQ
    .nav-actions: 6 theme dots (14px) + .btn.primary "Download" + hamburger (hidden desktop)
```

Nav link: padding `0.375rem 0.75rem`, muted, radius; hover/active → foreground + secondary bg.

Theme dots: 14×14 circle; swatches as in theme table; hover scale 1.15; active → `border: 2px solid foreground`.

Mobile `@960px`: hide desktop theme dots + Download; show hamburger; links become vertical overlay menu; include mobile Download + theme picker inside menu.

## B4. Buttons (website)

```css
.btn {
  inline-flex; center; gap 0.5rem;
  height 2.5rem; padding 0 1.25rem;
  radius 6px; font 0.875rem/500;
  border 1px solid transparent;
  transition color/bg/border/transform 0.15s;
}
.btn.primary { primary bg + primary-foreground; }
.btn.primary:hover { primary/0.9; translateY(-1px); }
.btn.secondary { secondary bg + border; hover → accent; }
.btn.ghost { transparent + muted + border; hover → foreground + secondary; }
.btn-lg { height 2.75rem; padding 0 1.5rem; font-size 0.9375rem; }
```

Icons in CTAs: Lucide 18×18, stroke 2, gap 0.5rem from label.

## B5. Hero (first viewport)

**Layout:** 2-col grid, gap `4rem`, align center. Padding top `nav-height + 4rem`, bottom `5rem`. Overflow hidden.

**Atmosphere:** `::before` absolute radial blob — top `-20%`, right `-10%`, size `600×600`, `radial-gradient(circle, primary/0.08 → transparent 70%)`. No flat single-color-only page; blob provides atmosphere. No cards in hero. No floating badges/overlays on the mockup.

**Left column (`.hero-content.reveal`):**
1. `.hero-logo` — 56×56 circle, radial `primary/0.15`, primary icon 28×28, `pulseLogo`, mb 1.5rem
2. Brand is hero-level via logo mark + product name in nav + H1 that does not overpower product context
3. H1: “Download media like a pro. Without the command line.”
4. Lead paragraph (exact marketing copy in HTML)
5. CTA group: primary “Download for Windows” (download icon) + secondary “View source on GitHub” (GitHub icon), gap 0.75rem, mb 2rem
6. Trust chips (pill, secondary bg, border, 0.75rem/500 muted): `MIT License` · `No ads` · `Auto-installs yt-dlp + ffmpeg` · `v1.7.0`

**Right column (`.hero-visual.reveal`):** App mockup (see B6).

@960px: grid → 1 col. @600px: CTAs full-width min-height 44px; mockup sidebar hidden. @380px: hero logo 48×48.

## B6. App mockup (hero visual)

Outer: border, radius 12px, shadow `0 25px 50px -12px rgba(0,0,0,0.5)`, background token, `modalScaleIn` 0.6s.

```
.mockup-body (flex, min-height 380px)
  .mockup-sidebar (180px, border-right, pad 1rem 0.75rem)
    logo row (0.8rem/600, icon 18 primary)
    nav items: Video (active), Audio, Instagram, Subtitles, Clipper
      — 0.75rem/500, pad 0.4rem 0.625rem, icon 14 opacity 0.7
      — active: secondary bg + foreground
  .mockup-main (flex 1, pad 1.25rem, col gap 1rem)
    greeting: h3 1.25rem/700 "Welcome back!"; p 0.8rem muted
    .mockup-card (border, radius, pad 1rem, flex 1)
      h4 "Download Video" 0.9rem/600
      desc 0.7rem muted
      fake input 2rem height, 0.7rem muted text
      .mockup-btn full width 2rem primary "Start Download" 0.75rem/500
    .mockup-progress
      labels 0.65rem space-between "Downloading..." / "73%"
      track 5px muted pill; fill primary width 73% + progressPulse
```

This mockup must visually match the real Electron Video tab at ~75% scale.

## B7. Overview (`#what-is`)

- Class `extract-section`: top+bottom borders, bg `card/0.35`
- Definition lead: 1.0625rem muted, lh 1.75, max-width 720px; links underline primary
- 3-col `.extract-grid` gap 1.25rem; each `.extract-card.card` pad 1.25rem
  - Cards: “Best for video editors”, “YT-DLP GUI vs web downloaders”, “YT-DLP GUI vs yt-dlp CLI”
- Last updated line 0.8rem muted

## B8. Pain grid (`#pain`)

Label “The problem” / title “Sound familiar?” / subtitle about editing walls.

**Grid:** 3 columns, gap 1rem, margin-top 3rem → 2 col @960 → 1 col @600.

**Each `.pain-card`:**
- min-height 210px, radius 10px, overflow hidden, position relative
- Border: `pain-accent / 0.18` (always red, not theme)
- Background: `linear-gradient(145deg, card → hsl(0 30% 6%) 55% → hsl(0 40% 5%))`
- `::before`: radial ellipse at 85% 75%, pain-accent/0.12
- Hover: border /0.45, `translateY(-3px)`, stronger red-tinted shadow
- Art image: absolute right/bottom `-4%`, width ~68% max 200px, masked fade to left (`mask-image: linear-gradient(to left, black 65%, transparent)`)
- Body: relative z-index 1, pad `1.375rem 1.5rem`, max-width 78%
- Icon box: 38×38, radius 6px, bg pain/0.12, border pain/0.28, color pain, soft glow
- H3: 1.05rem/600/-0.02em; P: 0.8125rem muted lh 1.55

**Six cards (order):**

| Art file | Title | Icon concept |
|----------|-------|--------------|
| `pain-cli.svg` | CLI intimidation | terminal chevron |
| `pain-web.svg` | Web converter roulette | warning triangle |
| `pain-codec.svg` | Wrong codec, broken timeline | stacked rects / X |
| `pain-waste.svg` | Full-video waste | clock |
| `pain-subtitles.svg` | Subtitle scavenger hunt | message |
| `pain-deps.svg` | Dependency hell | settings gear |

Pain SVGs: dark red illustrative art, `#ef4444` fills at varying opacity; some SMIL blink animations. Size attribution 280×200.

## B9. Solution bridge

- Centered, padding `4rem 0`, top+bottom borders
- Background: `linear-gradient(180deg, card/0.5 → transparent)`
- H2: clamp 1.5–2rem / 700 / -0.03em
- P: 1.0625rem muted, max-width 680px, centered

Copy: “One desktop app. Every format you need. Zero terminal.”

## B10. Features (`#features`)

Intro block mb 4rem. Then alternating `.feature-row`:

```
.feature-row
  grid 1fr 1fr; gap 3rem; align center; mb 5rem
  .feature-copy
    .feature-tag (primary uppercase 0.75rem/600, letter-spacing 0.06em, icon 14)
    h3 1.75rem/700
    p muted
    ul.feature-list — checkmarks stroke 2.5 primary, 0.9rem text
  .feature-visual
    border, radius 12px, pad 1.5rem, card bg
    — contains mini app card mock OR clipper demo OR mode grid
.feature-row.reverse → copy order 2, visual order 1
```

Feature rows in order (copy left / visual right alternating with reverse):
1. Video — Premiere-ready up to 4K — download card mock
2. Audio (reverse) — format grid MP3/WAV(selected primary)/M4A/FLAC
3. Instagram — reel URL card
4. Subtitles (reverse) — monospace cue block on secondary bg
5. Clipper — YouTube iframe + interactive range handles (see B10a)
6. Divider (reverse) — 2×2 mode tiles, Fast Split selected with primary border
7. Music Finder — detected song row with ACRCloud badge
8. Recents + Settings (reverse) — tabbed mock with recents list / settings switches

### B10a. Clipper mock

- `.clipper-mock` wraps video box + hint + range + times
- Video box: 16:9 black, iframe embed, rounded
- Range track: height ~12px muted pill; fill primary/30 between handles
- Handles: circular primary + white border, draggable; start/end roles
- Times row: In / Clip duration badge / Out / Total — small muted labels

## B11. Personas (`#personas`)

Three `.persona-band` stacked:
- Pad `3rem`, radius 12px, border, mb 1.5rem
- H3 + P + `.persona-tags` row of pill tags
- Audiences: video editors / social creators / power users (CLI refugees)

## B12. Open source (`#opensource`)

- Background: `linear-gradient(135deg, primary/0.06 → card → background)`
- Grid of points with check icons + dual CTAs (GitHub + Download)

## B13. Compare table (`#compare`)

- Wrapper overflow-x auto
- Table: full width; th/td pad + border-bottom
- Middle column highlighted (YT-DLP GUI): `highlight-col` with primary tint on header + cells
- Rows compare vs web converters vs CLI across privacy, quality, Premiere-ready, ads, etc.

## B14. Formats / Themes / How it works / Architecture

**Formats:** grid of format cards with name, use-case blurb, primary accent on recommended.

**Themes:** large picker grid of 6 theme options (same names/swatches as tokens); clicking sets `data-theme` live.

**How it works:** 3-col `.steps-grid` gap 1.5rem; each step has circular number badge (40×40 primary bg, primary-foreground, weight 700) + title + text. Below: `.terminal-mock` with uppercase header + Consolas body using log-info/success/warn colors. Max-width 600px centered.

**Architecture:** cards describing Electron main/preload/renderer separation.

## B15. FAQ

- List gap 0.75rem
- Item: border + radius, overflow hidden
- Question button: full width, flex space-between, pad `1.25rem 1.5rem`, card bg, 0.95rem/500; hover secondary; chevron rotates 180 when `.open`
- Answer: max-height 0 → 400px; inner pad `0 1.5rem 1.25rem`, 0.9rem muted
- Accordion: opening one closes others (script)

## B16. Final CTA

- Centered, pad `5rem 0`
- Background: `linear-gradient(180deg, transparent → primary/0.05 50% → transparent)`
- Border-top
- H2 clamp 1.75–2.5rem; muted lead max 560px
- Dual CTAs centered + monospace `.code-snippet` (card bg, border, pad `1rem 1.5rem`, 0.85rem):
  `git clone https://github.com/birol-dev/YT-DLP-GUI-.git && npm install && npm start`

## B17. Footer

- Pad `3rem 0 2rem`, border-top
- Grid `2fr 1fr 1fr` gap 2rem (stacks on mobile)
- Brand column: logo + muted blurb max 320px
- Link columns: uppercase 0.8rem/600 muted headers; links 0.875rem at foreground/0.8 → primary on hover
- Bottom bar: border-top, flex space-between, 0.8rem muted + disclaimer max 560px

## B18. Website breakpoints

| Breakpoint | Key changes |
|------------|-------------|
| `960px` | Grids → 1 col; hamburger nav; hide desktop theme dots & Download; pain → 2 col; section-gap `5rem`; feature rows stack |
| `600px` | section-gap `3.5rem`; nav `56px`; container pad `1rem`; CTAs full-width ≥44px; pain → 1 col; mockup sidebar hidden; theme picker 3-col |
| `380px` | Theme picker 2-col; hero logo 48×48 |

Touch targets ≥ 44px for mobile nav toggle and primary download buttons.

---

## 6. Iconography rules

- **System:** Lucide-style inline SVG only
- Attributes: `fill="none" stroke="currentColor" stroke-width="2"` (checks use `2.5`), `stroke-linecap="round" stroke-linejoin="round"`, `viewBox="0 0 24 24"`
- No emoji in production UI (Music Finder marketing mock may show a music note glyph in a muted square as placeholder art)
- Sizes: nav 18, logo 24/22/28, feature tags 14, list checks 16, pain icons 18

---

## 7. Assets inventory

| Path | Role |
|------|------|
| `assets/fast_split.png` | Divider mode thumb |
| `assets/precise_split.png` | Divider mode thumb |
| `assets/equal_chunks.png` | Divider mode thumb |
| `assets/spatial_split.png` | Divider mode thumb |
| `build/icon.png` | Electron app icon |
| `website/assets/icon.png` | Favicon, apple-touch, OG |
| `website/assets/pain/pain-{cli,web,codec,waste,subtitles,deps}.svg` | Pain card art |

---

## 8. Interaction state matrix

| Control | Hover | Focus | Active / selected | Notes |
|---------|-------|-------|-------------------|-------|
| Nav btn (app) | accent fill | — | secondary fill; icon opacity 1 | SVG default 0.7 |
| Nav link (site) | secondary + foreground | — | same as hover when scrolled-to | sticky active |
| Primary btn | primary/0.9 (+ lift site) | — | — | — |
| Secondary / ghost | accent or secondary | — | — | — |
| Input / select | — | ring border + 1px ring | — | transparent bg |
| Theme option / dot | accent / scale 1.15 | — | ring / foreground border | — |
| Recent thumb | scale 1.04 + shadow | — | grabbing | — |
| Weather | lift −2px | — | — | — |
| Drop zone | primary border + lift | — | `.dragover` same | — |
| Switch | — | — | track primary; thumb slides | — |
| Pain card | lift −3px + red border | — | — | red always |
| FAQ | secondary bg | — | open expands | accordion |
| Feature visual cards | subtle border emphasis | — | selected tiles primary border | — |

---

## 9. Do / don’t (visual fidelity)

**Do:**
- Use HSL channel CSS variables exactly as listed
- Keep default theme near-black zinc with white/silver primary
- Keep Inter + tight negative letter-spacing on large headings
- Keep section labels uppercase + primary-colored
- Recreate the hero as one composition: brand mark, one headline, one lead, one CTA group, one full-bleed-feeling mockup (edge-to-edge within column, not a floating inset collage)
- Keep pain cards permanently red-accented regardless of theme

**Don’t:**
- Don’t introduce Inter/Roboto as the *only* identity without the zinc token system
- Don’t use purple-indigo gradient marketing tropes as the default theme
- Don’t put stats strips, schedule chips, or floating promo badges on the hero
- Don’t turn the hero mockup into a rounded media card floating in whitespace with labels on top
- Don’t use cards in the hero (trust chips are pills, not cards; mockup is a product window)
- Don’t lighten the app to a cream/warm paper look

---

## 10. Recreation checklist for an AI agent

1. Port `:root` tokens + all six `[data-theme]` blocks verbatim.
2. Load Inter (400–700) and set global body/reset rules.
3. Build **app shell**: 240px sidebar + padded content + resizable terminal dock.
4. Implement primitives: card, btn primary, inputs/selects, switch, progress, theme chips.
5. Build greeting + weather header; wire tab panes for all 11 nav items.
6. Layer specialty UIs: clipper range, divider drop zone + 4 modes, browser sniffer, modals.
7. Build **website**: fixed blurred nav → hero (blob + mockup) → extract → pain → bridge → feature rows → personas → opensource → compare → formats → themes → steps → architecture → FAQ → final CTA → footer.
8. Add reveal IntersectionObserver, theme persistence, FAQ accordion, mobile nav at 960px.
9. Verify theme swapping only changes primary/ring/primary-foreground everywhere (except pain cards).
10. Pixel-check: hero mockup matches Video tab; trust chips present; section-label uppercase primary; radius scale consistent.

---

## 11. Source of truth

Authoritative implementation files (prefer reading these if available):

- `styles.css` — Electron tokens + components (~1800 lines)
- `index.html` — Electron markup (many secondary buttons use inline styles)
- `website/styles.css` — Marketing system (~2300 lines)
- `website/index.html` — Full section copy + structure
- `website/script.js` — Theme, FAQ, reveal, mobile nav

When this document and the CSS disagree, **CSS wins**.
