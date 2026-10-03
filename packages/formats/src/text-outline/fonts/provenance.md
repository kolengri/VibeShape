# Bundled sketch text font

- Immutable ID: `noto-sans-regular-2.008-v1`
- Family / face: Noto Sans / Regular, face index 0, static hinted TrueType
- Upstream: [notofonts/noto-fonts](https://github.com/notofonts/noto-fonts)
- Upstream commit: `ffebf8c1ee449e544955a7e813c54f9b73848eac`
- [Pinned source font](https://raw.githubusercontent.com/notofonts/noto-fonts/ffebf8c1ee449e544955a7e813c54f9b73848eac/hinted/ttf/NotoSans/NotoSans-Regular.ttf)
- Original byte length: 569,208
- SHA-256: `b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5`
- [Pinned upstream license](https://raw.githubusercontent.com/notofonts/noto-fonts/ffebf8c1ee449e544955a7e813c54f9b73848eac/LICENSE), reproduced unchanged in [OFL.txt](OFL.txt)
- License SHA-256: `0dab92d0544f7b233403f14b84a663bdbfa746982eda629e7f4f9ffe1b036feb`

Copyright 2018 The Noto Project Authors. The font is distributed under the SIL Open Font License
1.1. Its bytes are unmodified, with no subsetting, renaming or font-program conversion. The font
retains its own license; the surrounding VibeShape source is GPL-3.0-or-later. Distribution of the
font must retain the full copyright and license text. Future font changes require a new immutable
ID and digest; they cannot reinterpret saved text using this face.

Measured face metrics are 1,000 units per em, OS/2 capital height 714, x-height 536, ascender 1,069,
descender -293 and revision 2.008. Capital height sets text scale; round-letter overshoot and ink
descenders remain part of the original outlines. The face has 3,748 glyphs and includes the basic
Latin, Greek and Cyrillic fixtures exercised by the text-outline tests.

The outline reader is [OpenType.js 2.0.0](https://github.com/opentypejs/opentype.js/releases/tag/v2.0.0),
published under MIT with no runtime dependencies. Its public browser module parses the original TTF
bytes. Its unchanged MIT notice is retained in [LICENSE.opentype.txt](../LICENSE.opentype.txt).
VibeShape uses direct Unicode-scalar glyph lookup and supported pair kerning. It deliberately
does not run GSUB, synthesize missing glyphs or claim contextual shaping. OpenType.js 2.0.0 does not
support the contextual substitution format encountered by this face's general text-shaping API;
the saved layout policy describes the narrower algorithm actually used.
