# TREND_CONFIRM v7.0 Dashboard — Design Ideas

<response>
<text>
**Approach A: Terminal-Noir / Quantitative Trading Terminal**

- **Design Movement**: Bloomberg Terminal meets modern dark UI — dense, data-first, monochrome with surgical colour signals
- **Core Principles**: Information density over decoration; colour only for signal states (green/amber/red); monospace data, sans-serif labels; zero chrome, maximum data
- **Color Philosophy**: Near-black background (#0a0b0d), cool grey panels, pure white for primary numbers, amber (#f59e0b) for warnings, emerald (#10b981) for positive, red (#ef4444) for danger. Colour is reserved exclusively for signal meaning.
- **Layout Paradigm**: Asymmetric 3-column grid — narrow left sidebar (position state + parameters), wide centre (BTC health + decision flow), right column (momentum scores + re-entry trigger). No hero section.
- **Signature Elements**: Monospace ticker numbers with subtle scanline texture; thin horizontal rule dividers; pill badges for rule states
- **Interaction Philosophy**: Hover reveals tooltips with formula explanations; no animations on data — only on state transitions (signal change)
- **Animation**: Subtle pulse on SELL/BUY signal badge; number counter animation on price updates; no decorative motion
- **Typography System**: JetBrains Mono for all numbers/tickers; Inter for labels; large weight contrast (700 vs 400)
</text>
<probability>0.08</probability>
</response>

<response>
<text>
**Approach B: Brutalist Data Dashboard**

- **Design Movement**: Swiss Grid Brutalism — raw structure, bold typographic hierarchy, visible grid lines as design elements
- **Core Principles**: Grid as aesthetic; oversized numbers; stark contrast; no softening (no rounded corners, no shadows)
- **Color Philosophy**: Off-white (#f5f0e8) background, jet black (#111) text, a single accent — electric orange (#ff4500) for active signals only
- **Layout Paradigm**: Rigid 12-column CSS grid with visible column rules; sections snap to grid; no cards — just bordered rectangles
- **Signature Elements**: Oversized BTC drawdown % as typographic hero; thick border rules; uppercase section labels in tracking-widest
- **Interaction Philosophy**: No hover effects — state is always visible; clicking a rule in the decision flow expands its formula inline
- **Animation**: None — data updates replace values instantly with a brief background flash
- **Typography System**: Space Grotesk Bold (900) for numbers; Space Grotesk Regular for labels; strict type scale
</text>
<probability>0.07</probability>
</response>

<response>
<text>
**Approach C: Dark Precision — Selected**

- **Design Movement**: High-end fintech dark UI — Robinhood/Coinbase Pro meets institutional quant dashboard
- **Core Principles**: Dark depth with luminous data; card-based panels with subtle elevation; colour-coded signal states; fluid micro-interactions
- **Color Philosophy**: Deep navy-black background (oklch 0.10), slightly lighter card surfaces (oklch 0.14), electric blue accent for primary actions, emerald for positive/buy, amber for caution/partial, red for danger/sell. Muted text for labels, bright white for key numbers.
- **Layout Paradigm**: Left sidebar for navigation/status; main area split into a top hero row (signal + BTC health) and a lower 3-column grid (momentum, re-entry, decision flow, parameters)
- **Signature Elements**: Glowing number readouts for key metrics; animated progress bars for drawdown thresholds; colour-coded rule badges in decision flow
- **Interaction Philosophy**: Hover lifts cards with subtle glow; live data pulses on update; decision flow rules highlight the active rule
- **Animation**: Smooth counter animations for price/momentum numbers; pulse ring on active signal badge; progress bar transitions
- **Typography System**: Syne (700/800) for display numbers; Geist for labels and body; strict size scale
</text>
<probability>0.09</probability>
</response>

## Selected: Approach C — Dark Precision

Rationale: A crypto strategy dashboard lives in the same mental space as professional trading terminals. Dark precision delivers the right atmosphere — serious, data-dense, visually clear — while the luminous colour coding makes signal states instantly readable at a glance.
