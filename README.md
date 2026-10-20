# DEM Viewer — PH Mountains

Interactive 3D terrain viewer for nine Philippine volcanoes and lakes.
Served as plain static files — no backend, no build step.

**Live locally:**

```bash
python3 -m http.server 8123
# open http://localhost:8123
```

**Hosting:** pushed to GitHub and served from Settings → Pages (`.nojekyll`
is already in the repo root). GitHub limits: site < 1 GB (this build is
~0.97 GB) and no file > 100 MB (largest: Taal buildings GLB, 70 MB).

## The 9 datasets

Mount Mayon, Mount Kanlaon, Mount Isarog, Mount Bud Dajo, Mount Pinatubo,
Mount Taal, Mount Banahaw, Mount Hibok-Hibok, and Lake Buhi.

## Structure

```
index.html / main.js / stream.js   viewer app
siteinfo.js                        shared "About this site" notes modal
vendor/                            vendored Three.js + addons
data/
├── datasets.json                  dataset switcher registry
├── site_info.json                 per-site notes (prose, facts, references)
├── manifest_<name>.json           one manifest per dataset
└── stream/<name>/
    ├── tileset.json               streaming tile index
    ├── elev.json                  256x256 click-readout elevation grid
    ├── L0/whole.glb + .webp       base terrain
    ├── L1/r{r}c{c}.glb + .webp    refined tiles
    └── L2/r{r}c{c}.glb + .webp    detail tiles
data/osm/<name>_buildings_lite.glb aligned OSM buildings (GLB)
```

## About the sites

Eight volcanoes and one lake, spanning three of the Philippines' volcanic
arcs (Luzon, Negros, Mindanao). Elevations are summit heights; the terrain
you see is true-scale (1.0) Copernicus DEM GLO-30.

### Mount Mayon — Albay, Bicol

Active stratovolcano on the **Bicol Volcanic Arc**, and the most active
volcano in the Philippines with 52+ eruptions in 500 years.[^1] It is
among the most symmetrical volcanic cones on Earth — the "perfect cone" that
rises 2,421 m from Albay Gulf.[^2] The VEI 4 eruption of 1814 buried the
town of Cagsawa and killed roughly 1,200 people; only the church bell
tower survived.[^1] It was the Philippines' first national park (1938), and
its caldera is the core of the UNESCO Albay Biosphere Reserve.[^2] In
pre-colonial Bicolano tradition it is the abode of **Daragang Magayon**
and the supreme god Gugurang.[^1] Activity continues: PHIVOLCS raised the
alert level to 3 after a magmatic eruption on 6 January 2026.[^3]

### Mount Kanlaon — Negros Occidental / Negros Oriental, Visayas

Active andesitic stratovolcano on the **Negros Volcanic Belt**, and the
highest peak in the Visayas at 2,465 m — also the highest mountain on
Negros Island and the 42nd-highest island peak on Earth.[^4] It has
erupted more than 40 times since 1819 and is the most active volcano in
the Visayas; eruptions are usually phreatic, throwing ash and steam from
the summit Lugud crater.[^5] The name means "place of Laon", after the
pre-colonial Visayan goddess of creation and agriculture.[^6] Its
southwestern flank carries the **La Castellana debris avalanche** — at
13 km³ over a 33 km run-out, the largest known debris flow in the
Philippines.[^5] A 2024–2026 unrest sequence has produced a VEI 3
eruption, 87,000 evacuated, and further moderately explosive eruptions
through 2026.[^7]

### Mount Isarog — Camarines Sur, Bicol

Active stratovolcano on the Bicol Volcanic Arc, 2,000 m high with a
2,500 m-wide summit crater breached east and drained by the Rangas
River.[^8] A Holocene sector collapse of its northwestern flank sent the
**Tinambac debris avalanche** all the way into San Miguel Bay.[^8] Its
last eruption was in the 12th century CE — a potsherd found under the
ash proves people already lived at Goa at the time.[^9] It shows gas
seepages, warm springs and steaming vents today.[^8] The summit is the
meeting point of six municipalities and Naga City.[^8] It is an ultra-
prominent peak, and home to endemic species including the Isarog shrew
rat, the Isarog cloud frog and the Isarog forest skink.[^10]

### Mount Bud Dajo — Sulu, Bangsamoro

A 620 m **cinder cone** on Jolo island, part of the Zamboanga–Sulu
volcanic arc, and the second-highest point in Sulu.[^11] The summit
crater is 0.5 km across and breached to the southwest, and the cone's
base spans 9.5 km.[^12] The volcano is extinct — its last eruption date
is unknown, and PHIVOLCS monitoring surveys in 1993 and 1997 found
nothing unusual.[^11] It has been a sacred mountain to the Tausug people
since before Spanish contact, and became Mount Dajo National Park in
1938.[^11] It is also remembered as the site of the 1906 First Battle of
Bud Dajo.[^13]

### Mount Pinatubo — Zambales / Tarlac / Pampanga, Central Luzon

Active stratovolcano in the Zambales Mountains, now 1,486 m — it stood at
1,745 m before 15 June 1991, when it produced a **VEI 6 eruption**, the
second-largest terrestrial eruption of the 20th century.[^14] It ejected
about 10 km³ of magma and a 35 km ash column, put more particulate into
the stratosphere than any eruption since Krakatoa, and cooled global
temperatures by roughly 0.5 °C across 1991–1993.[^14] It happened to
coincide with Typhoon Yunya, whose rain and wind drove the ash into
communities already buried by pyroclastic flows.[^15] The 2.5 km caldera
now holds Lake Pinatubo, drained by hand in 2001 after fears of a wall
collapse.[^16] The Aeta people of the surrounding slopes hold ancestral
domain titles over parts of the mountain.[^17] Last eruption: a weak
phreatic explosion on 30 November 2021.[^18]

### Mount Taal — Batangas, CALABARZON

A 25–30 km flooded caldera, the second most active volcano in the
Philippines with 39 confirmed historical eruptions, and one of the
Smithsonian's "Decade Volcanoes" for its deadly proximity to populated
land.[^19] Volcano Island sits in the middle of Taal Lake, and its 2 km
Main Crater holds a lake with Vulcan Point, a small rocky islet that was
one of the largest third-order islands in the world.[^20] The 1754 VEI 5
eruption was its largest; the 1911 eruption killed about 1,100 people,
obliterated the crater floor and created the crater lake.[^21] The
overall recorded death toll is around 6,000.[^19] Volcano Island is
permanently off-limits — a Permanent Danger Zone.[^22] Last eruption:
8 October 2026.[^23]

### Mount Banahaw — Laguna / Quezon, CALABARZON

A three-peaked **active complex volcano** on the Luzon Volcanic Arc,
2,170 m — the highest mountain in Laguna, in Quezon, and in the whole
CALABARZON region.[^24] Its summit holds a 1.5 × 3.5 km, 210 m-deep
caldera, breached on the southern rim by the 1730 eruption; a lake
occupied the crater before that, and the resulting mudflow destroyed the
town of Sariaya below the mountain.[^25] It is a sacred mountain and a
long-standing pilgrimage destination, and its springs are drawn from for
"holy water".[^25] The surrounding Makiling–Banahaw Watershed supplies
steam for power generation.[^26] Most of it lies in the Mounts
Banahaw–San Cristobal Protected Landscape (10,901 ha); climbing has
been suspended since 2004, with some sections reopened in 2019.[^27]
Four endemic rodents live here, including the Banahaw tree mouse.[^28]

### Mount Hibok-Hibok — Camiguin, Northern Mindanao

An active stratovolcano on **Camiguin island** — the Philippines' only
volcanic island — 1,332 m high with a 10 km base, also known as
Catarman Volcano.[^29] It has erupted four times in modern history. The
1871 flank eruption built the cone of Mount Vulcan, the youngest
volcano on the island.[^30] The 1948–51 sequence was the deadly one: the
1951 eruption on 4 December killed over 3,000 people, and Camiguin's
population fell from 69,000 to about 34,000 through emigration.[^31] It
has six hot springs and three craters, and the nearby White Island is a
popular dive.[^29] Together with Mount Timpoong it forms a natural
monument that became an ASEAN Heritage Park in 2015.[^32]

### Lake Buhi — Camarines Sur, Bicol

Not a volcano but a volcanic accident: a **1,707 ha lake** (17.07 km²,
8 m average depth, 120 m surface elevation) formed in 1641 when an
earthquake caused one flank of Mount Iriga — also called Mount Asog — to
collapse, the landslide creating a natural dam across the local streams.[^33]
It is famous for the **sinarapan** (*Mistichthys luzonensis*), the
world's smallest commercially harvested fish.[^34] The lake also feeds the
National Power Corporation's hydro plant (about 2.8 MW) and irrigates at
least 100 km² of the Riconada towns downstream.[^35] The surrounding
forest holds five endemic bird species.[^34]

## Data sources & licenses

- **Terrain:** Copernicus DEM GLO-30 via OpenTopography (open data).
- **Imagery:** Copernicus Sentinel-2 quarterly mosaics (Copernicus open
  access).
- **Buildings:** OpenStreetMap via Overpass API — **ODbL**. Respect
  fair-use (bulk work should use regional extracts, e.g. Geofabrik).
- Buildings are shown at **5x height exaggeration**; terrain is true
  scale (1.0).

## Viewer features

Dataset switcher (9), fly/orbit camera, click-to-read elevation + lat/lon,
distance-based terrain refinement, buildings toggle, elevation-grid readout,
mobile layout.

## Site notes

The "About the sites" prose above is also served by the website. It lives in
`data/site_info.json`, keyed by dataset id (the manifest `name` field):

```json
"mtmayon": {
  "name": "Mount Mayon",
  "region": "Albay, Bicol",
  "kind": "Volcano",
  "summary": "Active stratovolcano on the **Bicol Volcanic Arc** …[^1]",
  "facts": [{ "label": "Summit elevation", "value": "2,421 m" }],
  "refs": [{ "n": 1, "label": "\"Mayon\", Wikipedia", "url": "https://…" }]
}
```

Two places expose it, both through the shared modal in `siteinfo.js`:

- **Landing page** — a "Read the notes" button on each card, so the write-up
  is readable before entering the 3D view.
- **Viewer** — an "About \<site\>" button in the control panel, plus the
  shareable deep link `?m=manifest_mtmayon.json&info=1`, which opens the
  notes directly and is restored on reload.

The `name` field is also the display name: the dataset switcher and the
landing-page cards use it, falling back to a name derived from the dataset
id (`mtmayon` → `Mount Mayon`) for datasets with no notes. That fallback
cannot know where a name breaks into words, which is why `site_info.json`
spells out "Mount Bud Dajo" and "Mount Hibok-Hibok".

Editing the text means editing `data/site_info.json`; no rebuild is needed.
`site_info.json` is hand-maintained on purpose — unlike `datasets.json`, it
is not regenerated automatically, so authored prose survives a refresh.
Datasets with no entry simply show no notes button.

## References

[^1]: "Mayon", Wikipedia — <https://en.wikipedia.org/wiki/Mount_Mayon>
[^2]: Mayon Volcano, PHIVOLCS — <https://volcano.si.edu/volcano.cfm?vn=273030>
[^3]: "PHIVOLCS: Kanlaon Volcano experienced 'explosive eruption'", GMA News, 10 Jan 2026 — <https://www.gmanetwork.com/news/sciencetech/weather/solano/939331/phivolcs-kanlaon-volcano-experienced-explosive-eruption/story/>
[^4]: "Kanlaon", Wikipedia — <https://en.wikipedia.org/wiki/Mount_Kanlaon>
[^5]: Kanlaon Volcano, PHIVOLCS — <https://volcano.si.edu/volcano.cfm?vn=272020>
[^6]: Daita et al. (2024), "Geologically young block-and-ash flow deposits of Isarog Volcano" — <https://doi.org/10.13140/RG.2.2.19763.95529>
[^7]: "Kanlaon Volcano erupts, Alert Level raised to 3", Philstar, 9 Dec 2024 — <https://www.philstar.com/news/2024/12/09/2424793/kanlaon-volcano-erupts-alert-level-raised-3>
[^8]: "Isarog", Wikipedia — <https://en.wikipedia.org/wiki/Mount_Isarog>
[^9]: "800-Year-Old Eruption: Pre-Hispanic Bicolanos witnessed Isarog fury", Bicol Mail, 13 Dec 2024 — <https://bicolmail.com/2024/12/13/800-year-old-eruption-pre-hispanic-bicolanos-witnessed-isarog-fury/>
[^10]: Kennerley (2019), *Rhynchomys isarogensis*, IUCN Red List — <https://www.iucnredlist.org/species/19712/22438209>
[^11]: "Bud Dajo", Wikipedia — <https://en.wikipedia.org/wiki/Bud_Dajo>
[^12]: "Jolo", Global Volcanism Program — <https://volcano.si.edu/volcano.cfm?vn=273075>
[^13]: Charbonneau (2021), *Civilizational Imperatives*, Ateneo de Manila UP — <https://books.google.com/books?id=1UyFEAAAQBAJ>
[^14]: "Pinatubo", Wikipedia — <https://en.wikipedia.org/wiki/Mount_Pinatubo>
[^15]: "The Cataclysmic 1991 Eruption of Mount Pinatubo, Philippines", USGS — <https://pubs.usgs.gov/publication/fs143>
[^16]: "Filipinos return as volcano lake drains", BBC News, 7 Sep 2001 — <https://news.bbc.co.uk/2/hi/asia-pacific/1531448.stm>
[^17]: "Aetas granted first ancestral domain title on Mt. Pinatubo", Inquirer, 14 Jan 2010 — <https://newsinfo.inquirer.net/2010/01/14/174182/americas/aetas-receive-title-to-domain-at-mt-pinatubo>
[^18]: "PHIVOLCS confirms Mount Pinatubo phreatic eruption", ABS-CBN News, 30 Nov 2021 — <https://news.abs-cbn.com/news/regional-news/national/8976269/phivolcs-confirms-mt-pinatubo-phreatic-eruption>
[^19]: "Taal Volcano", Wikipedia — <https://en.wikipedia.org/wiki/Mount_Taal>
[^20]: "Taal Volcano Main Crater Lake and Vulcan Point", Wikipedia — <https://en.wikipedia.org/wiki/Taal_Volcano_Main_Crater_Lake>
[^21]: "Report of the 1911 eruption of Taal Volcano", PHIVOLCS (via Newhall & Punongbayan, 1996) — <https://pubs.usgs.gov/publication/fs144>
[^22]: Taal Volcano, PHIVOLCS — <https://volcano.si.edu/volcano.cfm?vn=273083>
[^23]: "Taal Volcano", Wikipedia (last eruption 8 Oct 2026) — <https://en.wikipedia.org/wiki/Mount_Taal>
[^24]: "Banahaw", Wikipedia — <https://en.wikipedia.org/wiki/Mount_Banahaw>
[^25]: "Mount Banahaw", PinoyMountaineer, 1 Jan 2009 — <https://pinoymountaineer.com/2009/01/mount-banahaw/>
[^26]: "Makiling-Banahaw Watershed", National Power Corporation — <https://www.napocor.gov.ph/About-Us/Our-Business/Makiling-Banahaw-Watershed>
[^27]: "Mt. Banahaw still closed to trekkers — DENR", Philstar, 1 Jun 2022 — <https://www.philstar.com/news/2022/06/01/2191140/mt-banahaw-still-closed-trekkers-denr>
[^28]: Balete et al. (2007), "Two new species of Rhynchomys from Luzon", *Journal of Mammalogy* 88(2) — <https://doi.org/10.1644/06-MAMM-A-090R.1>
[^29]: "Mount Hibok-Hibok", Wikipedia — <https://en.wikipedia.org/wiki/Mount_Hibok-Hibok>
[^30]: Becker (1901), *Report on the Geology of the Philippine Islands*, US Government Printing Office — <https://archive.org/details/reportongeologyo00beckuoft>
[^31]: "Hibok-Hibok Volcano", Global Volcanism Program — <https://volcano.si.edu/volcano.cfm?vn=272020>
[^32]: "Camiguin's Timpoong, Hibok-Hibok declared ASEAN Heritage Park", Inquirer, 16 Mar 2016 — <https://newsinfo.inquirer.net/2016/03/16/1357209/life-environment-and-biology/camiguins-timpoong-hibok-hibok-declared-asean-heritage-park>
[^33]: "Lake Buhi", Wikipedia — <https://en.wikipedia.org/wiki/Lake_Buhi>
[^34]: "Rediscovering Lake Buhi: Home of the World's Smallest Edible Fish", Haribon Foundation — <https://haribonfoundation.org/2006/02/rediscovering-lake-buhi-home-of-the-worlds-smallest-edible-fish/>
[^35]: "Lake Buhi", World Lakes Database, International Lake Environment Committee (archived) — <https://web.archive.org/web/20090419040814/http://www.ilec.net/db/databases/ILCDatabase/Lakes/tabid/158/ArticleID/196/language/Default.aspx>
