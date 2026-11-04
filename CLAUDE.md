# Instructions for Claude and other agents

## Name

This project is **Encyclopedia Dynamica**. Never call it "Atlas" or "the Atlas" in code, file names, comments, commit messages or pull requests. The owner has an unrelated project with software called Atlas, and the two must never be confused.

## The owner

Marc (GitHub: Harmelsson) has no coding experience. Claude writes the code and explains every choice in plain language. Pull request descriptions should say what changed and how Marc can see it, without jargon.

## Content rules

The project vision document is the source of truth for goals, design and rules. In short:

1. Never add a claim without a source the reader can verify.
2. Separate observation (what was found or written) from interpretation (what it means).
3. Attribute every interpretation to the person or school who holds it.
4. Prefer primary sources and original data over summaries.
5. Record the method behind dates and claims.
6. When unsure, say so and mark the entry as uncertain.
7. Never quietly resolve a disagreement. Show it.
8. Never add a claim that has not been checked.

## Data rules

- Natural Earth is the base map. Every historical border is drawn by us from cited sources.
- Cliopatria is a private drafting aid only. Never commit Cliopatria data, or anything derived from it, to this repository.

## Technology

- A web app that runs in the browser, published by GitHub Pages from the `main` branch root.
- MapLibre for the map.
- Data in simple files at first, moving later to PostgreSQL with PostGIS.
- Keep it buildable without a build step for as long as possible, so the published files are the files in the repository.
