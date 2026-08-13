# CicloBeef Studio

**Transforming Culture**

CicloBeef Studio is a digital art and premium wall-art studio exploring history, society & culture through curated visual collections.

## Production Website

https://ciclobeefstudio.com/

## Release

Target hotfix release: `v0.6.1`

## Commercial Model

CicloBeef Studio currently operates through a curated quotation workflow rather than an automated public checkout.

- Studio Editions
- CicloBeef Signature Frame
- CicloBeef Signature Acrylic
- Collection 001
- Vertical and horizontal formats
- Worldwide quotation workflow
- Ordering through official social channels

## Product Sizes

- 50 × 70 cm / 20 × 28 in
- 60 × 90 cm / 24 × 36 in
- 70 × 100 cm / 28 × 40 in

## Collection 001 Gallery Titles

The Gallery presents the eight Collection 001 visual variants while grouping them under two public artwork titles:

- Aereocrya Dreams — CicloBeef Signature Frame and CicloBeef Signature Acrylic, vertical and horizontal.
- Vesperocrya Dreams — CicloBeef Signature Frame and CicloBeef Signature Acrylic, vertical and horizontal.

Tablet and iPad Gallery controls are expected to remain visible and usable across the 768px to 1024px viewport range.

## Technology Stack

The repository currently uses the following technologies:

- HTML
- CSS
- Vanilla JavaScript
- MkDocs
- Material for MkDocs
- GSAP
- ScrollTrigger
- Sharp
- Node.js
- npm
- Git
- GitHub
- GitHub Actions
- GitHub Pages

## Repository Structure

- `docs/` - Public site source, documentation pages, scripts, styles and production assets.
- `docs/assets/` - Images, social preview assets, CSS extras and JavaScript assets used by the site.
- `docs/integrations/` - Integration documentation currently included in MkDocs navigation.
- `docs/business/`, `docs/technical/`, `docs/audits/`, `docs/ai-log/` - Project documentation and audit records.
- `.github/workflows/` - GitHub Actions workflows for PR validation and manual GitHub Pages deployment.
- `scripts/` - Node.js asset pipeline scripts.
- `overrides/` - MkDocs theme override files.
- `assets-source/` - Source asset workspace used by the local asset pipeline.
- `mkdocs.yml` - MkDocs site configuration.
- `requirements.txt` - Python dependencies used by CI and local MkDocs builds.
- `package.json` - npm scripts and frontend asset dependencies.

## Local Setup

Install Node.js dependencies:

```bash
npm ci
```

Install Python dependencies in a virtual environment:

```bash
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

Build the MkDocs site:

```bash
.venv/bin/python -m mkdocs build --strict
```

Serve the MkDocs site locally:

```bash
.venv/bin/python -m mkdocs serve
```

## Frontend Asset Pipeline

The npm scripts currently defined in `package.json` are:

```bash
npm run vendor:sync
npm run assets:build
npm run build:frontend-assets
```

`npm run build:frontend-assets` runs the vendor synchronization script and then rebuilds Collection 001 frontend assets.

## Validation

Pull request validation installs `requirements.txt` and runs the strict MkDocs build used by CI:

```bash
python -m mkdocs build --strict
```

Local release validation should also run:

```bash
npm ci
npm run build:frontend-assets
.venv/bin/python -m mkdocs build --strict
```

## GitFlow

- `main` contains production release history.
- `develop` contains integrated work prepared for the next release cycle.
- `feature/*` branches are used for isolated feature work.
- `release/*` branches prepare versioned production releases.
- `hotfix/*` branches are created from `main` for controlled production corrections and then synchronized back into `develop`.

## Deployment

Production deployments are manual and tag-based through GitHub Actions.

The deployment workflow uses the `release_tag` input and checks out:

```text
refs/tags/${{ inputs.release_tag }}
```

The generated MkDocs output is published to GitHub Pages through the `gh-pages` branch.

## Custom Domain

Production uses:

```text
ciclobeefstudio.com
```

The GitHub Pages deployment workflow preserves this custom domain by writing the Pages `CNAME` during deployment.

## Status

Active production project.

## Maintainer

CicloBeef Studio.
