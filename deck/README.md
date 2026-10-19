# Haven pitch deck

Two versions of the same 10-part story:

| File | What it is |
|---|---|
| `Haven-Pitch.pptx` | 16:9 PowerPoint deck: Morph transitions, auto-playing entrance animations, speaker notes on every slide |
| `index.html` | Single-page scrolling pitch site with motion graphics. This is the deck URL: https://vnmoorthy.github.io/haven/deck/ |
| `build_deck.py` | Rebuilds the `.pptx` (and its image assets in `assets/`) from scratch |

Slides: 1 Title · 2 Problem · 3 Solution · 4 Meet the team · 5 How it works · 6 Live demo moments · 7 Safety & trust by design · 8 Sponsor stack · 9 Business model & traction · 10 Vision & ask

## Presenting the PowerPoint

- Open `Haven-Pitch.pptx` in PowerPoint (Microsoft 365 or 2019+ for Morph; older versions and Keynote fall back to a fade).
- **F5** (Windows) or **Cmd+Shift+Enter** (Mac) to start from the beginning. **Shift+F5** / **Cmd+Enter** to start from the current slide.
- **Right arrow / Space / click** goes to the next slide, **Left arrow** goes back. Animations play on their own after each transition, so you never click to reveal content.
- **Alt+F5** (Windows) or **Option+Cmd+Enter** (Mac) opens Presenter View with the speaker notes (about 30 seconds per slide, so roughly 5 minutes in total).
- **B** blacks out the screen, **W** whites it out, and typing a number then **Enter** jumps to that slide.
- Slide 5 has a glowing dot that loops around the operating loop for as long as the slide is up.

## Presenting the web version

Open `index.html` in a browser, or the GitHub Pages URL above.

| Key | Action |
|---|---|
| Down / Right / Page Down / Space | Next section |
| Up / Left / Page Up / Shift+Space | Previous section |
| Home / End | First / last section |

The dots on the right edge jump to any section. Press **F11** (or **Ctrl+Cmd+F** on Mac) for full screen.

## Regenerating the deck

```bash
pip install python-pptx Pillow lxml
python3 deck/build_deck.py
```

The script is idempotent: it overwrites `deck/Haven-Pitch.pptx` every time.

**Real screenshots.** Put PNGs in `docs/screenshots/` and re-run the script. They replace the stylized mock UIs automatically:

| File | Slide |
|---|---|
| `mission-control.png` | 3 · Solution |
| `incident-room.png` | 6 · Live demo |
| `audit.png` | 7 · Safety & trust |

Any aspect ratio works. Each image is cropped to fill its frame, keeping the top-left corner (where the app's sidebar and header are). If a file is missing, the slide shows a drawn mock instead of a broken image. The web version loads the same files from `../docs/screenshots/`.

Optional environment variables: `HAVEN_SHOTS=/path/to/pngs` to use another screenshot folder, and `HAVEN_DECK_OUT=/path/out.pptx` to write somewhere else.

To check a build: `python3 -c "from pptx import Presentation; print(len(Presentation('deck/Haven-Pitch.pptx').slides))"` should print `10`. To preview it as images: `soffice --headless --convert-to pdf deck/Haven-Pitch.pptx && pdftoppm -jpeg -r 80 Haven-Pitch.pdf slide`. LibreOffice shows gradient text as solid violet and doesn't play Morph or animations; PowerPoint does.

## Design notes

- Palette: background `#05060a`, glass panels, violet `#8b5cf6` to cyan `#22d3ee` gradient, accents rose `#f43f5e`, emerald `#10b981`, amber `#f59e0b`.
- The `.pptx` uses Arial so text fits the same way on every machine. The brand font Inter is used on the web.
- Morph: the background, glow orbs, logo and footer have the same `!!` names on every slide, so PowerPoint glides them between slides.
