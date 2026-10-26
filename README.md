
# Pulse News

A responsive, multi-category RSS news reader built with HTML, CSS,
JavaScript, Python and GitHub Actions.

## Features

- 20 news categories
- 10 publisher domains configured per category
- Automated Google News RSS searches
- Scheduled collection using GitHub Actions
- Deduplicated news archive with retention limits
- Search and category filters
- Bookmarks saved in the browser
- Dark and light themes
- Responsive mobile-friendly design
- Direct links to original publishers

## Setup

1. Create a GitHub repository named `pulse-rss-news`.
2. Upload all project files, preserving their folder structure.
3. Open Settings > Actions > General.
4. Enable Read and write permissions for workflows.
5. Open Actions > Collect RSS News.
6. Select Run workflow to perform the first collection.
7. Wait for the workflow to finish and check `data/news.json`.
8. Open Settings > Pages.
9. Set the deployment source to Deploy from a branch.
10. Select `main` and `/(root)`, then save.

## Automatic updates

The workflow is scheduled at minutes 17 and 47 of each UTC hour.
GitHub may delay scheduled workflows. Updates are not guaranteed to
arrive at an exact time.

## Important notes

- A configured publisher may not return stories for every search.
- Google News RSS can change its availability or results.
- Saved stories are stored in the current browser only.
- The original publisher controls access to full articles.
- This project does not bypass paywalls or copy full articles.
- Never commit API keys or other secrets to a public repository.

## Credits

Created by Sayeef Adnan.
