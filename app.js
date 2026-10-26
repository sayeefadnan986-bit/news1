
const DATA_URL = "./data/news.json";
const $ = (id) => document.getElementById(id);

let allNews = [];
let categories = [];
let activeCategory = "all";
let mode = "latest";
let visibleLimit = 24;
let savedIds = new Set();

try {
  savedIds = new Set(JSON.parse(localStorage.getItem("pulse-saved") || "[]"));
} catch {}

const esc = (value = "") =>
  String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  }[c]));

function getId(item) {
  return item.id || item.url;
}

function relativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "#";
  } catch {
    return "#";
  }
}

function renderCategories() {
  const names = ["all", ...categories];
  $("categoryNav").innerHTML = names.map((name) => {
    const active = activeCategory === name ? "active" : "";
    const label = name === "all" ? "✦ All News" : name;
    return `<button class="category-chip ${active}"
      data-category="${esc(name)}">${esc(label)}</button>`;
  }).join("");
}

function filteredNews() {
  const query = $("searchInput").value.trim().toLowerCase();

  return allNews.filter((item) => {
    const categoryMatch = activeCategory === "all" ||
      item.category === activeCategory;
    const savedMatch = mode !== "saved" || savedIds.has(getId(item));
    const haystack = [
      item.title, item.summary, item.publisher, item.category
    ].join(" ").toLowerCase();

    return categoryMatch && savedMatch && (!query || haystack.includes(query));
  }).sort((a, b) => {
    if (mode === "saved") {
      return new Date(b.published || 0) - new Date(a.published || 0);
    }
    return new Date(b.published || 0) - new Date(a.published || 0);
  });
}

function cardTemplate(item) {
  const id = getId(item);
  const url = safeUrl(item.url);
  const saved = savedIds.has(id);
  const title = esc(item.title || "Untitled story");
  const summary = esc(item.summary || "Open the original source to read this story.");
  const publisher = esc(item.publisher || "News publisher");
  const category = esc(item.category || "News");

  return `<article class="news-card">
    <div class="card-top">
      <span class="tag">${category}</span>
      <button class="save-btn ${saved ? "saved" : ""}"
        data-save="${esc(id)}"
        aria-label="${saved ? "Remove bookmark" : "Bookmark story"}"
        title="${saved ? "Remove bookmark" : "Save story"}">${saved ? "★" : "☆"}</button>
    </div>
    <h3><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${title}</a></h3>
    <p class="summary">${summary}</p>
    <div class="card-bottom">
      <span class="publisher">${publisher}</span>
      <span class="time">${esc(relativeTime(item.published))}</span>
      <a class="read-link" href="${esc(url)}" target="_blank"
        rel="noopener noreferrer">Read original article ↗</a>
    </div>
  </article>`;
}

function renderNews() {
  const items = filteredNews();
  const shown = items.slice(0, visibleLimit);

  $("storyCount").textContent = `${allNews.length.toLocaleString()} stories collected`;
  $("resultCount").textContent = `${items.length.toLocaleString()} results`;
  $("feedTitle").textContent =
    mode === "saved" ? "Saved Stories" :
    activeCategory === "all" ? "Top Stories" : activeCategory;

  $("newsGrid").innerHTML = shown.length
    ? shown.map(cardTemplate).join("")
    : `<div class="empty-state">
        <h3>No stories found</h3>
        <p>Try another category or search term. New stories appear after the next collection run.</p>
      </div>`;

  $("loadMoreBtn").disabled = shown.length >= items.length;
  $("loadMoreBtn").textContent =
    shown.length >= items.length ? "All stories loaded" : "Load more stories";
}

function setMode(nextMode) {
  mode = nextMode;
  $("latestBtn").classList.toggle("active", mode === "latest");
  $("savedBtn").classList.toggle("active", mode === "saved");
  visibleLimit = 24;
  renderNews();
}

async function loadNews({ quiet = false } = {}) {
  if (!quiet) {
    $("statusMessage").className = "status-message";
    $("statusMessage").textContent = "Loading the latest collected stories…";
  }
  $("refreshBtn").disabled = true;

  try {
    const response = await fetch(`${DATA_URL}?v=${Date.now()}`, {
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    allNews = Array.isArray(data.articles) ? data.articles : [];
    categories = Array.isArray(data.categories)
      ? data.categories
      : [...new Set(allNews.map(x => x.category).filter(Boolean))];

    renderCategories();
    renderNews();

    const updated = data.updatedAt ? new Date(data.updatedAt) : null;
    $("updatedAt").textContent = updated && !Number.isNaN(updated.getTime())
      ? `Collection updated ${relativeTime(updated.toISOString())}`
      : "Update time unavailable";

    $("statusMessage").textContent = allNews.length
      ? ""
      : "No stories collected yet. Run the GitHub Actions workflow to populate the feed.";
    $("statusMessage").style.display = allNews.length ? "none" : "block";
  } catch (error) {
    $("statusMessage").className = "status-message error";
    $("statusMessage").textContent =
      "Could not load news data. Check that data/news.json exists and the GitHub Actions collector has run.";
    console.error("Pulse News loading error:", error);
  } finally {
    $("refreshBtn").disabled = false;
  }
}

$("categoryNav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  activeCategory = button.dataset.category;
  visibleLimit = 24;
  renderCategories();
  renderNews();
});

$("newsGrid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-save]");
  if (!button) return;

  const id = button.dataset.save;
  if (savedIds.has(id)) savedIds.delete(id);
  else savedIds.add(id);

  try {
    localStorage.setItem("pulse-saved", JSON.stringify([...savedIds]));
  } catch {}
  renderNews();
});

$("searchInput").addEventListener("input", () => {
  visibleLimit = 24;
  renderNews();
});
$("clearSearch").addEventListener("click", () => {
  $("searchInput").value = "";
  renderNews();
  $("searchInput").focus();
});
$("latestBtn").addEventListener("click", () => setMode("latest"));
$("savedBtn").addEventListener("click", () => setMode("saved"));
$("refreshBtn").addEventListener("click", () => loadNews());
$("loadMoreBtn").addEventListener("click", () => {
  visibleLimit += 24;
  renderNews();
});

$("themeBtn").addEventListener("click", () => {
  document.body.classList.toggle("light");
  const light = document.body.classList.contains("light");
  $("themeBtn").textContent = light ? "☀" : "☾";
  try { localStorage.setItem("pulse-theme", light ? "light" : "dark"); } catch {}
});

try {
  if (localStorage.getItem("pulse-theme") === "light") {
    document.body.classList.add("light");
    $("themeBtn").textContent = "☀";
  }
} catch {}

window.addEventListener("scroll", () => {
  $("backTop").classList.toggle("show", window.scrollY > 500);
});
$("backTop").addEventListener("click", () =>
  window.scrollTo({ top: 0, behavior: "smooth" })
);

loadNews();
