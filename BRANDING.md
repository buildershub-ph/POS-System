# Builders Hub — Brand Reference

Captured from the official logo provided by the team, for use in future UI/design decisions across this app.

## Logo
- Monogram: bold white "BH" lettermark on a solid blue field, underscored by a short gold/yellow rule.
- Wordmark: "BUILDERS HUB" in bold white sans-serif, same gold underline treatment.
- Logo files (SVG/PNG) should be added to `public/brand/` once available — see note below.

## Color palette
| Role | Approx. hex | Usage |
|---|---|---|
| Primary blue | `#0B4EA2` (cobalt/royal blue) | Backgrounds, primary brand surface |
| Accent gold | `#F2B705` (golden yellow) | Underline accent, highlights, CTAs |
| Foreground | `#FFFFFF` | Text/logo on blue backgrounds |

> Note: hex values are approximated from the shared logo image. Ask the team for exact brand hex codes (or the original logo source files) to lock these in precisely.

## Usage guidance
- Use the primary blue as the dominant brand color for headers/nav in place of any generic default theme color currently in `app/globals.css`.
- Reserve gold strictly as an accent (underlines, active states, badges) — not as a large fill color.
- Maintain high contrast: white text/icons on blue, dark text on light backgrounds.

## TODO
- [ ] Add actual logo asset files (SVG preferred) to `public/brand/`.
- [ ] Confirm exact brand hex codes with the team.
- [ ] Update `app/layout.tsx` metadata / favicon / manifest to use the Builders Hub branding once assets are available.
