const state = {
  bookmarks: [],
  query: ""
};

const listElement = document.getElementById("bookmarksList");
const emptyStateElement = document.getElementById("emptyState");
const searchInput = document.getElementById("searchInput");
const refreshButton = document.getElementById("refreshButton");

function formatDate(dateString) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(dateString));
  } catch (error) {
    return dateString;
  }
}

function filterBookmarks() {
  const query = state.query.trim().toLowerCase();
  if (!query) {
    return state.bookmarks;
  }

  return state.bookmarks.filter((bookmark) => {
    const haystack = [
      bookmark.text,
      bookmark.preview,
      ...(bookmark.tags || [])
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });
}

async function loadBookmarks() {
  state.bookmarks = await getBookmarks();
  render();
}

function buildCard(bookmark) {
  const card = document.createElement("article");
  card.className = "bookmark-card";

  const meta = document.createElement("div");
  meta.className = "bookmark-meta";
  meta.innerHTML = `
    <span>${formatDate(bookmark.createdAt)}</span>
    <span>${bookmark.tags.length} tag${bookmark.tags.length === 1 ? "" : "s"}</span>
  `;

  const preview = document.createElement("p");
  preview.className = "bookmark-preview";
  preview.textContent = bookmark.preview || bookmark.text.slice(0, 180);

  const tagRow = document.createElement("div");
  tagRow.className = "tag-row";
  (bookmark.tags || []).forEach((tag) => {
    const tagChip = document.createElement("span");
    tagChip.className = "tag";
    tagChip.textContent = tag;
    tagRow.appendChild(tagChip);
  });

  const tagInput = document.createElement("input");
  tagInput.className = "tag-input";
  tagInput.type = "text";
  tagInput.placeholder = "comma,separated,tags";
  tagInput.value = (bookmark.tags || []).join(", ");
  tagInput.setAttribute("aria-label", "Edit tags");

  const saveTagsButton = document.createElement("button");
  saveTagsButton.className = "action-button primary";
  saveTagsButton.type = "button";
  saveTagsButton.textContent = "Save Tags";
  saveTagsButton.addEventListener("click", async () => {
    const tags = tagInput.value.split(",").map((tag) => tag.trim()).filter(Boolean);
    await updateBookmarkTags(bookmark.id, tags);
    await loadBookmarks();
  });

  const copyButton = document.createElement("button");
  copyButton.className = "action-button";
  copyButton.type = "button";
  copyButton.textContent = "Copy";
  copyButton.addEventListener("click", async () => {
    await navigator.clipboard.writeText(bookmark.text);
    copyButton.textContent = "Copied";
    window.setTimeout(() => {
      copyButton.textContent = "Copy";
    }, 1200);
  });

  const deleteButton = document.createElement("button");
  deleteButton.className = "danger-button";
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", async () => {
    await removeBookmark(bookmark.id);
    await loadBookmarks();
  });

  const actions = document.createElement("div");
  actions.className = "bookmark-actions";
  actions.append(saveTagsButton, copyButton, deleteButton);

  card.append(meta, preview, tagRow, tagInput, actions);
  return card;
}

function render() {
  const filtered = filterBookmarks();
  listElement.replaceChildren(...filtered.map(buildCard));
  emptyStateElement.hidden = filtered.length > 0;
}

searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});

refreshButton.addEventListener("click", loadBookmarks);

loadBookmarks();
